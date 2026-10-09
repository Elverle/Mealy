---
title: Fixtures di Test e Seed Idempotente (fixtures-and-seed)
type: entity
created: 2026-09-17
updated: 2026-10-09
tags: [fixtures, seed, database, testing, offline, household, aliases, ingredients, deploy]
---

## File e Responsabilità

- **Percorsi file**:
  - `fixtures/recipes.json`: file JSON con 18 ricette casalinghe italiane predefinite.
  - `fixtures/ingredient-aliases.json`: dizionario di sinonimi e varianti di ingredienti mappati sui loro nomi canonici: **35 voci** dalla Feature 6 (24 fino alla Feature 5).
  - `fixtures/index.ts`: modulo TypeScript che carica, valida ed esporta le costanti delle fixtures e la funzione loader `fixtureRecipesAsDomain`.
  - `lib/db/seed-core.ts`: logica transazionale idempotente di popolamento database (`seedDatabase`) e, dalla Feature 6, `seedIngredientAliases`.
  - `lib/db/seed.ts`: script eseguibile da riga di comando via `pnpm db:seed`.
  - `lib/db/seed-aliases.ts` (Feature 6): script eseguibile via `pnpm db:seed:aliases`, che inserisce **solo** gli alias.
- **Scopo**: Garantire l'autonomia dello sviluppo e del testing offline secondo i principi vincolanti del progetto (`CLAUDE.md § Stack`). Fornisce sia un dataset culinario credibile per inizializzare il database di sviluppo, sia strutture dati in memoria pronte all'uso per i test unitari di planner e lista spesa senza richiedere connessioni di rete né chiamate LLM.

## Corpus di Fixtures Normalizzate

I dati statici sono conformi alle stringenti regole di dominio:

### 1. Ricette Casalinghe (`fixtures/recipes.json`)
Contiene 18 ricette rappresentative della cucina casalinga italiana (primi piatti, secondi, contorni, piatti unici) con caratteristiche diversificate:
- **Validazione**: validato a runtime da `FixtureFileSchema` in `fixtures/index.ts` (richiede tra 15 e 20 ricette).
- **Normalizzazione ingredienti**:
  - `canonical_name`: singolare, minuscolo, senza aggettivi di preparazione (es. `pomodoro`, `pasta`, `petto di pollo`).
  - `unit`: ristretto ai soli 4 valori ammessi (`g`, `ml`, `pz`, `qb`).
  - `category`: suddiviso sui 9 reparti fissi del supermercato (`ortofrutta`, `pane`, `macelleria`, `pescheria`, `banco-frigo`, `dispensa`, `surgelati`, `bevande`, `altro`).
  - `qty`: `null` per ingredienti a sentimento con unità `qb` (es. sale, pepe, basilico).
- **Metadati ricetta**: indicazione realistica di `meal_types` (`pranzo`, `cena`), `diet_flags` (rispettando le relazioni di inclusione transitiva), `appliances_required`, `servings_base`, `prep_minutes` e passaggi ordinati in `steps`.
- **Determinismo**: tutte le ricette hanno UUID fissi e una data di creazione convenzionale `FIXTURE_CREATED_AT = new Date('2026-01-01T00:00:00Z')`.

### 2. Alias Ingredienti (`fixtures/ingredient-aliases.json`)
Dizionario di 24 mappature per il consolidamento dei sinonimi nella spesa (es. "cipolle rosse" → "cipolla", "spaghetti" → "pasta", "latte intero" → "latte"). Validato a runtime da `IngredientAliasesFileSchema` (minimo 15 record).

> **Nota (Feature 6)**: la frase sopra è la descrizione originale della Feature 2 e diverge dal file. I tre esempi non sono voci di `fixtures/ingredient-aliases.json`: le voci reali sono, per esempio, `cipolle → cipolla`, `cipolla dorata → cipolla`, `pelati → pomodoro pelato`, `olio evo → olio extravergine di oliva`; `latte intero` e `pasta di semola` sono nomi canonici delle ricette fixture, non alias. Le voci sono 35, non più 24.

#### Voci aggiunte dalla Feature 6

Undici voci, scelte tra le varianti viste nelle risposte reali dei modelli (decisione U1 dei requirements):

| Alias | Nome canonico |
|---|---|
| `olio di oliva`, `olio extravergine d'oliva`, `olio extra vergine di oliva` | `olio extravergine di oliva` |
| `ceci`, `ceci cotti` | `ceci lessati` |
| `couscous`, `cous cous` | `couscous di grano` |
| `paprika` | `paprika dolce` |
| `pasta` | `pasta di semola` |
| `lenticchie` | `lenticchia` |
| `pomodorini` | `pomodorino` |

La voce `lenticchie secche → lenticchia`, prevista dal piano, **non** è stata aggiunta: nelle risposte registrate sono due prodotti diversi (innesto R5 della review architetturale). La stessa review annota che restano distinti per scelta nomi come `cipolla rossa`, `lenticchie rosse`, `paprika affumicata`, `pasta corta`.

Regole imposte dai test (`tests/fixtures-data/recipes-fixtures.test.ts`): le voci sono 35; nessun `canonical_name` delle ricette fixture è un alias; alias e nomi canonici sono già normalizzati (`normalizeCanonicalName`), un alias non coincide con il proprio canonico e **non esistono catene** (nessun nome canonico è a sua volta un alias). L'ultima regola conta perché il consolidamento risolve un solo passo ([[shopping-list]]).

Dalla Feature 6 la tabella `ingredient_aliases` è letta dal codice applicativo: `listIngredientAliases` di [[shopping-repo]], chiamata dal servizio della lista della spesa per fondere i nomi e per dedurre il reparto di un articolo a mano ([[shopping-service]]). Gli alias si risolvono **solo** lì: ricette, preferenze e planner confrontano ancora il nome canonico esatto.

## Loader Tipizzato in Memoria (`fixtureRecipesAsDomain`)

La funzione esportata da `fixtures/index.ts`:

```ts
export function fixtureRecipesAsDomain(householdId: string = DEFAULT_HOUSEHOLD_ID): Recipe[]
```

Trasforma le 18 ricette fixtures nel tipo completo di dominio `Recipe` associandole all'household desiderato:
- Assegna `household_id` (default `DEFAULT_HOUSEHOLD_ID`).
- Imposta `source: 'manual'`.
- Imposta `macros_est: null` e `prefs: null`.
- Assegna il corretto `recipe_id` a ogni elemento dell'array `ingredients`.
- Valida ciascun record tramite `RecipeSchema.parse()`.

Questa funzione permette ai moduli applicativi (quali il planner settimanale, la generazione della lista spesa o gli algoritmi di bilanciamento) di eseguire test unitari velocissimi in memoria, senza necessità di configurare o azzerare il database relazionale.

## Seed Idempotente del Database (`seedDatabase`)

Il seeding del database viene eseguito tramite:
```bash
pnpm db:seed
```
Lo script (`lib/db/seed.ts`) carica le variabili d'ambiente (`.env.local` / `.env`), importa dinamicamente il client DB e invoca `seedDatabase()` da `lib/db/seed-core.ts`.

### Fasi Operative Idempotenti:
1. **Verifica Household**: controlla se esiste il record con `DEFAULT_HOUSEHOLD_ID` (`00000000-0000-0000-0000-000000000001`). Se assente, lo crea invocando `ensureDefaultHousehold()` da [[household-repo]].
2. **Inserimento Ricette**:
   - Per ciascuna delle 18 ricette, verifica preventivamente se esiste già un record con lo stesso UUID (`getRecipeById`) o lo stesso slug (`getRecipeBySlug`).
   - Se presente, la ricetta viene saltata incrementando il contatore `recipesSkipped`.
   - Se assente, viene inserita in modo atomico assieme ai suoi ingredienti tramite `insertRecipe` da [[recipe-repo]], incrementando `recipesInserted`.
3. **Inserimento Alias Ingredienti**:
   - Esegue una `INSERT` batch sulla tabella `ingredient_aliases` con clausola:
     ```sql
     ON CONFLICT DO NOTHING
     ```
   - Gli alias già presenti non generano errori di chiave duplicata.
   - Dalla Feature 6 questa fase è la funzione esportata `seedIngredientAliases(db)`, che `seedDatabase` chiama (v. "Seed dei Soli Alias").
4. **Report di Esecuzione**:
   Restituisce l'interfaccia `SeedReport`:
   ```ts
   export interface SeedReport {
     household: 'created' | 'existing';
     recipesInserted: number;
     recipesSkipped: number;
     aliasesInserted: number;
   }
   ```
   Lo script stampa a console il riassunto dell'operazione e chiude la connessione con `client.end()`.

Grazie a questa strategia a prova di riesecuzione, il comando `pnpm db:seed` può essere lanciato in qualsiasi momento (all'avvio di un container dev, dopo una migrazione o in pipeline CI) senza rischiare corruzione o duplicazione di dati.

`pnpm db:seed` resta un comando **di sviluppo**: inserisce anche l'household di default e le 18 ricette di esempio. In produzione non va usato (v. sotto).

## Seed dei Soli Alias (Feature 6)

```ts
export async function seedIngredientAliases(executor: DbExecutor = db): Promise<number>;
```

```bash
pnpm db:seed:aliases
```

- **`seedIngredientAliases`** (`lib/db/seed-core.ts`): lo stesso `insert … onConflictDoNothing` che prima era scritto dentro `seedDatabase`; restituisce quanti alias ha inserito. Accetta un `executor`, quindi può girare dentro una transazione. Non tocca household né ricette.
- **`lib/db/seed-aliases.ts`**: script sul modello di `lib/db/seed.ts`. Carica `.env.local` e `.env`, importa dinamicamente il client e la funzione, stampa `Alias completati — inseriti: N`, imposta `process.exitCode = 1` in caso d'errore e chiude sempre la connessione.
- **Perché esiste** (innesto R4 della review architetturale): fino alla Feature 5 gli alias arrivavano nel DB solo con `pnpm db:seed`. Dalla Feature 6 la lista della spesa li legge: senza alias in produzione la lista funzionerebbe senza fondere nulla (`olio extravergine d'oliva` e `olio extravergine di oliva` su due righe), e nessun test se ne accorgerebbe, perché i test inseriscono alias propri. Eseguire `pnpm db:seed` in produzione metterebbe invece le ricette di esempio nella libreria vera.
- **Contratto per la Feature 7 (deploy)**: il deploy esegue `pnpm db:migrate` e poi `pnpm db:seed:aliases`; **mai** `pnpm db:seed`. La regola è scritta anche tra i comandi di `CLAUDE.md`.

### Limite noto
`seedIngredientAliases` **inserisce soltanto**: con `onConflictDoNothing` una voce il cui nome canonico viene corretto nel file, o una voce tolta dal file, non cambia un database già popolato. Il comando è idempotente ma non allinea. Da decidere prima della Feature 7.

## Test

- `tests/fixtures-data/recipes-fixtures.test.ts`: validazione delle fixture e le regole sugli alias descritte sopra.
- `tests/db/seed.test.ts` (DB reale): seed idempotente, presenza di ogni alias del file e, dalla Feature 6, `seedIngredientAliases` idempotente (la seconda chiamata inserisce 0 voci) e **senza ricette**: il numero di ricette fixture nel DB non cambia e il repository delle ricette non viene mai chiamato (`getRecipeById` e `insertRecipe` sotto `vi.spyOn`).

## Vedi anche

- [[recipe-repo]] — Metodi `insertRecipe`, `getRecipeById`, `getRecipeBySlug`
- [[household-repo]] — Inizializzazione nucleo di default `ensureDefaultHousehold`
- [[domain-types]] — Schemi `FixtureRecipeSchema`, `FixtureFileSchema`, `IngredientAliasSchema`
- [[e1-motore-ricette]] — Architettura complessiva del motore ricette
- [[database-schema]] — Tabelle `recipes`, `recipe_ingredients`, `ingredient_aliases`
- [[shopping-list]] — Risoluzione degli alias nel consolidamento della spesa (Feature 6)
- [[shopping-repo]] — `listIngredientAliases`, lettura della tabella (Feature 6)
- [[e4-lista-spesa]] — Panoramica della Feature 6
