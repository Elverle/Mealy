---
title: Pacchetto Iniziale di Ricette — File del Pacchetto e loadRecipePack (recipe-pack)
type: entity
created: 2026-10-26
updated: 2026-10-27
tags: [recipes, recipe-pack, fixtures, diet-flags, ingredients, startup, instrumentation, transaction, advisory-lock, pg-trgm, feature-10, feature-11]
---

## File e Responsabilità

- **Percorsi file**:
  - `fixtures/recipe-pack.json`: il pacchetto, `{ "recipes": [ … ] }`, 200 ricette nel formato di `GeneratedRecipeSchema` con i tetti di `SavedRecipeInputSchema`. Lo scrive `pnpm recipes:pack build` ([[recipe-pack-tools]]).
  - `fixtures/recipe-pack-ingredients.json`: la tabella degli ingredienti, `{ "ingredients": [ … ] }`, 263 voci tutte rivedute, una per riga.
  - `fixtures/recipe-pack.ts`: valida i due file con gli schemi all'import ed esporta `RECIPE_PACK_RECIPES`, `RECIPE_PACK_INGREDIENTS` e `RECIPE_PACK_CREATED_AT`.
  - `lib/recipes/pack/load.ts`: `loadRecipePack`, il caricatore. È l'unico modulo di `lib/recipes/pack/` che importa `@/lib/db` e l'unico che entra nel bundle dell'app.
  - `instrumentation.ts`: lo chiama all'avvio in produzione ([[db-bootstrap]]).
- **Scopo**: dare a ogni installazione una libreria di partenza di 200 ricette, così il primo piano esce senza chiamare il modello e due piani di fila non ruotano sulle stesse ricette ([[f10-pacchetto-ricette]]).
- **Dove entra**: in produzione all'avvio dell'app; in sviluppo solo con `pnpm recipes:pack load`. `pnpm db:seed` non lo carica, e i test non lo caricano mai sul DB condiviso, solo su un household usa-e-getta (spec FR-4.2).

## I File del Pacchetto

### `fixtures/recipe-pack.json`

Ogni ricetta ha almeno una portata, diete ricavate per regola dalla tabella (`deriveDietFlags`, [[diet-rules]]), etichette coerenti con le regole derivate (`deriveStyleTags`, [[courses]]) e `category` di ogni ingrediente uguale a quella della tabella. Non contiene link, indici del dataset né il nome del sito d'origine. Le ricette sono in ordine primi, secondi, piatti unici, contorni (gruppi di selezione da 50, 50, 40 e 60) e, dentro un gruppo, nell'ordine della revisione dei titoli.

`RecipePackFileSchema` (`{ recipes: SavedRecipeInput[] }`) non controlla l'unicità dei titoli, per non importare `normalizeTitle` in `types.ts` e creare un ciclo (requirements P3): la controllano `build` e il test del file.

Composizione del file committato, quote dei gruppi contro portate effettive e statistiche: [[f10-pacchetto-ricette]].

### `fixtures/recipe-pack-ingredients.json`

Una voce per nome canonico normalizzato (`PackIngredientFactSchema`):

| Campo | Significato |
|---|---|
| `name` | Nome canonico normalizzato, unico nel file (`PackIngredientsFileSchema` rifiuta i doppioni: `Lo stesso ingrediente compare più di una volta.`) |
| `category` | Reparto della spesa, uno dei 9 di `CategorySchema` |
| `carne`, `pesce`, `latticini`, `uova`, `miele`, `glutine` | Cosa contiene, anche in tracce o come derivato (brodi, sughi, dado, formaggi stagionati, pasta all'uovo) |
| `reviewed` | `true` dopo la revisione dell'utente; nel file committato tutte le voci lo sono |

La bozza la scrive il modello, prudente per scelta («nel dubbio rispondi true», [[llm-adapter]]); l'utente la corregge e la approva. `build` la riscrive tenendo solo i nomi usati dal pacchetto. La tabella serve solo agli strumenti e ai test: l'app legge i reparti e le diete già scritti nelle ricette.

### `fixtures/recipe-pack.ts`

```ts
export const RECIPE_PACK_CREATED_AT: Date = new Date('2026-01-01T00:00:00Z');
export const RECIPE_PACK_RECIPES: GeneratedRecipe[];      // RecipePackFileSchema.parse(...)
export const RECIPE_PACK_INGREDIENTS: PackIngredientFact[]; // PackIngredientsFileSchema.parse(...)
```

I JSON entrano con `import` (`resolveJsonModule`), come gli alias: il pacchetto è nell'immagine di produzione e validato a ogni avvio. Gli strumenti invece leggono i file con `fs`, perché `ingredients` e `build` li riscrivono e un `import` resterebbe fisso al caricamento del modulo (requirements P10).

## `loadRecipePack(deps?)`

```ts
export interface LoadRecipePackDeps {
  householdId?: string;                       // default: singleton, creato se manca
  recipes?: readonly GeneratedRecipe[];       // default: RECIPE_PACK_RECIPES
  insert?: typeof insertGeneratedRecipe;      // default: insertGeneratedRecipe (iniettabile per i test)
  logger?: Pick<Console, 'log'>;              // default: console
}

export interface RecipePackLoadReport {
  inserted: number;  // inserite da questa esecuzione
  skipped: number;   // titolo già in libreria, uguale o simile
}
```

Passi:

1. **Pacchetto vuoto**: scrive `[pack] ricette del pacchetto inserite: 0, già presenti o simili: 0` e restituisce zeri, senza transazione e senza creare l'household (requirements P12). Era il caso del codice prima della chiusura, con i file iniziali vuoti.
2. **Household**: `deps.householdId ?? (await ensureDefaultHousehold()).id` ([[household-repo]]). Le ricette vanno al singleton anche prima dell'onboarding, che non cambia: dipende da `onboarded_at`.
3. **Una transazione** (`db.transaction`):
   - `acquireRecipeGenerationLock(tx)`: il caricamento si serializza con una generazione eventualmente in corso ([[recipe-repo]], [[plan-concurrency-pattern]]);
   - `listRecipeTitles(tx, householdId)` senza limite, normalizzati con `normalizeTitle`, nell'insieme `known`;
   - per ogni ricetta, nell'ordine del file: si salta se il titolo normalizzato è in `known`; altrimenti si salta se `findSimilarRecipeTitle(tx, householdId, title)` trova un titolo simile (`pg_trgm`, > 0,6), anche tra le ricette del pacchetto appena inserite; altrimenti `insert(tx, householdId, recipe, { source: 'manual', createdAt: RECIPE_PACK_CREATED_AT })` e il titolo entra in `known`.
4. **Log**: `[pack] ricette del pacchetto inserite: <n>, già presenti o simili: <m>`, scritto dal caricatore, così avvio e `load` stampano la stessa riga (requirements P20).

È lo stesso schema di `generateAndStoreRecipes` (transazione, lock, titoli noti aggiornati dopo ogni inserimento, [[recipe-generation]]). Le ricette già in libreria, del pacchetto o no, **non si toccano**: voti, preferite, blocchi e usi restano. Un errore annulla l'intera transazione e risale al chiamante: il caricamento è tutto o niente.

### Scrittura con `insertGeneratedRecipe`

`insertGeneratedRecipe` (`lib/recipes/store.ts`) è il punto unico di scrittura delle ricette: slug univoco, `normalizeCourses`, `deriveStyleTags`, riga di preferenze di default ([[recipe-proposal-service]]). La Feature 10 le aggiunge un parametro facoltativo:

```ts
export interface InsertGeneratedRecipeOptions {
  source?: RecipeSource;  // default 'llm'; il pacchetto usa 'manual' (spec D9)
  createdAt?: Date;       // default adesso; il pacchetto usa RECIPE_PACK_CREATED_AT (review R2)
}
```

- **`source: 'manual'`**: il valore esiste già in `RecipeSourceSchema`; uno nuovo (`'pack'`) non lo leggerebbe nessuno e cambierebbe un elenco chiuso (spec D9).
- **`created_at` fisso**: come `FIXTURE_CREATED_AT` delle ricette d'esempio. La Libreria ordina per preferite, poi `created_at` decrescente, poi titolo ([[library-service]]): le ricette dell'utente restano in cima e il pacchetto segue in ordine alfabetico. Senza data fissa i 60 contorni, ultimi del file, sarebbero stati i più recenti e avrebbero aperto la Libreria. Lo stesso vale per i titoli "recenti" che `generate.ts` mette nel prompt.

## Avvio in Produzione

In `register()` di `instrumentation.ts`, solo con `NEXT_RUNTIME === 'nodejs'` e `DB_BOOTSTRAP_ON_START === 'true'`, dopo `runDbBootstrap` e la riga `[bootstrap] …`:

```ts
try {
  const { loadRecipePack } = await import('./lib/recipes/pack/load');
  await loadRecipePack();
} catch (err) {
  console.error('[pack] caricamento interrotto', err);
}
```

- **Atteso**: il server non accetta richieste prima, quindi il primo piano vede già il pacchetto (spec FR-3.1). L'healthcheck dell'app concede 60 s di `start_period`.
- **Non fatale**: un errore, anche nell'import, scrive `[pack] caricamento interrotto` con l'errore e **non** chiama `process.exit`. Nessuna ricetta del pacchetto entra e il caricamento si ritenta al riavvio successivo (`docs/DEPLOY.md §9`). Un errore di `runDbBootstrap` continua invece a fermare l'avvio.
- **Prima della classificazione** della Feature 8, che parte subito dopo in background. Le ricette del pacchetto hanno sempre una portata, quindi la classificazione non le prende mai ([[recipe-classification]]).
- **Import dinamico**: il modulo, e con lui il pacchetto (circa 600 KB di JSON nel file committato; il piano ne stimava 700), si carica solo nel bootstrap di produzione.

Idempotenza: al secondo avvio tutti i titoli sono già noti e la riga dice `inserite: 0`; lo smoke lo controlla ([[deploy-scripts]]). Su una libreria con ricette proprie (il Raspberry ne aveva 26) le ricette del pacchetto simili a quelle già presenti si saltano e `N + M = 200` (`docs/DEPLOY.md §5`). Esempio visto nelle prove, su un database con le ricette d'esempio: *Pasta e ceci cremosa* saltata perché simile a *Pasta e ceci*.

## `pnpm recipes:pack load`

Stessa funzione e stessa regola, sul DB di `DATABASE_URL`: serve a provare il pacchetto in sviluppo, dove le 18 ricette d'esempio contano come già presenti per i titoli simili. Il comando chiude la connessione alla fine ([[recipe-pack-tools]]).

## Limiti

- **Nessun segno di "pacchetto caricato"**: il caricamento decide solo per titolo. Quando la V2 permetterà di cancellare le ricette, una ricetta del pacchetto cancellata tornerà al riavvio: prima servirà una tabella che segni il caricamento (spec §6).
- **Le ricette già caricate non si aggiornano**: una versione nuova del file aggiunge solo i titoli nuovi; una correzione a una ricetta esistente (testo, quantità, diete) non raggiunge le installazioni che l'hanno già.
- **Similarità offline e `pg_trgm`**: `build` usa `areTitlesSimilar`, il caricatore `pg_trgm`. Il test sul pacchetto vero (sotto) rende visibile ogni differenza.
- **Ricontrollo a ogni avvio** delle ricette saltate per somiglianza: non entrano in `known` e costano una query di similarità a ogni riavvio. Trascurabile (review R7).
- **Solo il singleton**: l'avvio carica nell'household di default; altri household (solo nei test) passano `householdId`.

## Test

- `tests/recipes/pack/load.test.ts` (DB reale, household usa-e-getta, saltato se Postgres non risponde):
  - libreria vuota → tutte le ricette entrano, con origine `manual`, la data fissa, portate ed etichette derivate e la riga di preferenze;
  - secondo caricamento → 0 inserite;
  - titolo già presente che differisce solo per maiuscole e punteggiatura → saltato;
  - titolo simile già presente → saltato;
  - errore a metà (`insert` iniettato che fallisce) → nessuna ricetta scritta e nessuna riga di log;
  - pacchetto vuoto → nessuna scrittura, riga con gli zeri;
  - **il pacchetto vero in una libreria vuota**: nessun titolo saltato, e in caso contrario l'elenco dei titoli (review R1). Limite di 30 s.
- `tests/recipes/store.test.ts`: `insertGeneratedRecipe` scrive `'llm'` di default, la `source` passata e la `createdAt` passata.
- `tests/instrumentation.test.ts` (modulo mockato): caricamento una volta, senza argomenti, dopo il bootstrap e prima della classificazione; un errore scritto nel log senza uscire, e la classificazione parte lo stesso; nessun caricamento se il bootstrap fallisce.
- `tests/fixtures-data/recipe-pack.test.ts`: le invarianti dei due file (spec FR-2.2) e il conteggio del pacchetto completo.
- `scripts/smoke-prod.sh`: ricette nel DB = ricette del pacchetto dopo il primo avvio, `inserite: 0` e stesso conteggio dopo il riavvio ([[deploy-scripts]]).

## Vedi anche

- [[f10-pacchetto-ricette]] — Panoramica della Feature 10
- [[recipe-pack-tools]] — Come si prepara il pacchetto
- [[diet-rules]] — Diete dalla tabella degli ingredienti
- [[db-bootstrap]] — Hook di avvio e ordine dei passi
- [[recipe-repo]] — `listRecipeTitles`, `findSimilarRecipeTitle`, `acquireRecipeGenerationLock`
- [[recipe-proposal-service]] — `insertGeneratedRecipe`
- [[library-service]] — Ordine della Libreria e data di creazione
- [[fixtures-and-seed]] — Le altre fixture: ricette d'esempio e alias
- [[f11-composizione-pasto]] — Feature 11: i 60 contorni nel piano, etichetta `piatto-unico` tolta dal file
