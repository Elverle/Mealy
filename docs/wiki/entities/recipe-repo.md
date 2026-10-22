---
title: Repository Ricette (recipe-repo)
type: entity
created: 2026-09-15
updated: 2026-10-21
tags: [database, repository, recipes, ingredients, preferences, drizzle, transactions, trigram, advisory-lock, executor, row-lock, courses, classification]
---

## File e Responsabilità

- **Percorso file**: `lib/db/repositories/recipe-repo.ts`
- **Scopo**: Incapsulare la logica di persistenza per le ricette della libreria permanente, gestendo in modo atomico le entità figlie (`recipe_ingredients` e `recipe_prefs`), l'esecuzione flessibile dentro transazioni esterne (`DbExecutor`), la deduplicazione basata su trigrammi PostgreSQL e la serializzazione della concorrenza tramite advisory lock.

## Tipi, Costanti ed Esecutori

### `DbExecutor`
Definisce l'interfaccia per invocare le query sia direttamente sul client del database sia all'interno di una transazione Drizzle aperta da un servizio chiamante:
```ts
type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | DbTransaction;
```
Permette a moduli coordinatori come [[recipe-generation]] e [[plan-service]] di raggruppare più operazioni nel medesimo blocco `db.transaction(tx => ...)`.

Dalla Feature 4 (proposta P4 della review architetturale) la definizione vive in `lib/db/index.ts`, accanto a `db` e `Database`, perché la usano anche [[plan-repo]], [[household-repo]] e `lib/prefs/`. `recipe-repo.ts` la **riesporta** (`export type { DbExecutor } from '../index'`) per compatibilità con gli import esistenti.

### Tipi di Input e Modello Composito
- `InsertRecipeInput`: dati anagrafici della ricetta (`title`, `slug`, `steps`, `meal_types`, `tags`, `diet_flags`, `appliances_required`, `servings_base`, `prep_minutes`, `kcal_est`, `source`, ecc.). Dalla Feature 8 anche `courses?: Course[]`, facoltativo: `insertRecipeWith` scrive `[]` (ricetta non classificata) se manca. Il repository scrive le portate così come arrivano; ordine canonico e regole derivate li applicano i chiamanti (`insertGeneratedRecipe`, seed, [[courses]]).
- `InsertIngredientInput`: lista ingredienti associati. **Restringimento forte dei tipi (Fix-P2)**:
  - `unit: Unit`: non una stringa generica, ma ristretto rigidamente ai valori ammessi `['g', 'ml', 'pz', 'qb']`.
  - `category: Category`: non una stringa generica, ma ristretto rigidamente ai 9 reparti spesa da [[domain-types]].
- `InsertRecipePrefInput`: preferenze opzionali (`rating`, `favorite`, `blocked`, `times_used`, `last_used_at`).
- `RecipeWithDetails`: tipo composito validato da Zod che unisce la `Recipe` con l'array tipato di `Ingredient[]` e l'oggetto `RecipePref | null`.
- `RecipePrefValues` (Feature 5): `{ rating: number | null; favorite: boolean; blocked: boolean }`, i tre campi che l'utente può modificare.

### Costanti di Deduplicazione
- `TITLE_SIMILARITY_THRESHOLD = 0.6`: soglia minima per il coefficiente `similarity()` di PostgreSQL `pg_trgm`. Se una ricetta candidata supera tale soglia rispetto a un titolo già esistente nel nucleo, viene considerata duplicata.

## Metodi Esportati

### `insertRecipeWith(executor, recipeData, ingredientsData, prefData): Promise<RecipeWithDetails>`
Inserisce in modo flessibile ricetta, ingredienti e preferenze utilizzando l'esecutore fornito (`DbExecutor`):
1. Genera un UUID per la ricetta se non fornito esplicitamente.
2. Esegue la `INSERT` in `recipes`.
3. Inserisce in batch gli ingredienti in `recipe_ingredients` associando il `recipe_id` e convertendo `qty` in formato numerico/stringa per PostgreSQL.
4. Inserisce la riga in `recipe_prefs` per inizializzare le preferenze o i contatori d'uso.
5. Formatta e valida l'oggetto restituito tramite `RecipeSchema.parse()`.
Non apre autonomamente transazioni: spetta al chiamante decidere se eseguire la chiamata dentro una transazione condivisa.

### `insertRecipe(recipeData, ingredientsData, prefData): Promise<RecipeWithDetails>`
Wrapper di comodo per inserimenti standalone: apre una propria transazione `db.transaction` e delega l'operazione a `insertRecipeWith(tx, ...)`. In caso di errore esegue il rollback automatico.

### `listRecipeTitles(executor, householdId, options?): Promise<string[]>`
Estrae la lista dei soli titoli delle ricette appartenenti all'household, ordinati dal più recente al più vecchio (`created_at DESC`):
- Supporta opzioni per filtrare per tipologia di pasto (`options.mealType`) e limitare il numero di risultati (`options.limit`).
- Utilizzato dal servizio di generazione per raccogliere i titoli recenti (fino a 150) da iniettare nel prompt negativo dell'LLM.
- Dalla Feature 9 anche da `saveProposedRecipe` ([[recipe-proposal-service]]), dentro la transazione e dopo il lock, senza opzioni: tutti i titoli dell'household, per rifiutare un titolo normalizzato già presente (`recipe_duplicate`).

### `listRecipeTitleRefs(executor, householdId): Promise<{ id: string; title: string }[]>` (Feature 9)
Id e titolo di tutte le ricette dell'household, dalla più recente (`created_at DESC`), bloccate comprese. La usa `proposeRecipe` ([[recipe-proposal-service]]) per valorizzare `duplicate_of` con l'id della ricetta che ha lo stesso titolo normalizzato: `listRecipeTitles` restituisce solo i titoli, e caricare la libreria intera con gli ingredienti per un confronto di titoli sarebbe sprecato (requirements P7 della Feature 9). È l'unica modifica della Feature 9 al repository.

### `findSimilarRecipeTitle(executor, householdId, title, threshold = TITLE_SIMILARITY_THRESHOLD): Promise<string | null>`
Esegue una query ad alte prestazioni basata sull'estensione PostgreSQL `pg_trgm` e sull'indice GIN su `recipes.title`:
```sql
SELECT title FROM recipes
WHERE household_id = $1 AND similarity(title, $2) > $3
ORDER BY similarity(title, $2) DESC
LIMIT 1;
```
Restituisce il titolo del duplicato più affine se la similarità supera la soglia specificata, altrimenti `null`.

### `slugExists(executor, slug): Promise<boolean>`
Controlla se lo slug indicato esiste già all'interno dell'intera tabella `recipes` (a livello globale su tutti i nuclei familiari), consentendo al generatore di slug di risolvere collisioni.

### `acquireRecipeGenerationLock(executor): Promise<void>`
Acquisisce un lock di sessione a livello di transazione:
```sql
SELECT pg_advisory_xact_lock(hashtext('mealy:recipes:generate'));
```
**Regola vincolante**: deve essere invocato unicamente all'interno di una transazione database attiva. Il lock garantisce che due generazioni simultanee non entrino in conflitto e viene rilasciato automaticamente dal database alla chiusura della transazione. Dalla Feature 9 lo prende anche `saveProposedRecipe` ([[recipe-proposal-service]]): salvataggi di ricette chieste e generazioni a lotti si serializzano sullo stesso lock, e due salvataggi sovrapposti dello stesso titolo ne producono uno solo.

### `getRecipeById(id: string): Promise<RecipeWithDetails | null>`
Recupera una singola ricetta dato il suo UUID, eseguendo la join automatica con `ingredients` e `prefs` tramite l'API relazionale di Drizzle (`db.query.recipes.findFirst`).

### `getRecipeBySlug(slug: string): Promise<RecipeWithDetails | null>`
Recupera la ricetta dato il suo identificatore univoco leggibile `slug`. Utilizzato per routing e visualizzazione dettagli.

### `deleteRecipe(id: string): Promise<boolean>`
Rimuove la ricetta per ID. I record collegati in `recipe_ingredients` e `recipe_prefs` vengono eliminati contestualmente grazie al vincolo `ON DELETE CASCADE`.

### `listRecipesWith(executor, filter?: { household_id?: string }): Promise<RecipeWithDetails[]>` (Feature 4)
Estrae tutte le ricette memorizzate con l'esecutore fornito, con filtro opzionale per nucleo (`household_id`), ordinate per `created_at DESC` con ingredienti e preferenze inclusi. Introdotta dalla proposta R2 della review architetturale di F4: [[plan-service]] rilegge la libreria **dentro** la transazione del piano, dopo il lock, per rifare la selezione sullo stato aggiornato ([[plan-concurrency-pattern]]).

### `listRecipes(filter?: { household_id?: string }): Promise<RecipeWithDetails[]>`
Come `listRecipesWith(db, filter)`; comportamento invariato.

### `toRecipeWithDetails(row): RecipeWithDetails` (Feature 4)
Converte una riga di `db.query.recipes` con `ingredients` e `prefs` in `RecipeWithDetails`. È la funzione interna `formatRecipe` delle feature precedenti, rinominata ed esportata senza cambiarne il comportamento: [[plan-repo]] la usa per le ricette annidate negli slot del piano.

## Scrittura delle Preferenze sulla Ricetta (Feature 5)

Quattro funzioni aggiunte in coda al file, tutte con `executor` come primo argomento; nessuna funzione esistente è cambiata. Le usa `updateRecipePref` in `lib/prefs/service.ts` ([[prefs-service]]), dentro una sola transazione e in quest'ordine.

| Funzione | Comportamento |
|---|---|
| `recipeBelongsToHousehold(executor, recipeId, householdId)` | `true` se la ricetta esiste **e** appartiene all'household; `false` per un altro household o un id inesistente |
| `ensureRecipePrefRow(executor, recipeId)` | `insert … on conflict (recipe_id) do nothing`: crea la riga di default se manca, senza toccare una riga esistente |
| `lockRecipePref(executor, recipeId)` | `SELECT … FOR UPDATE` sulla riga di `recipe_prefs`; `null` se assente. **Solo dentro una transazione** |
| `writeRecipePref(executor, recipeId, values)` | Upsert di `rating`, `favorite`, `blocked`; restituisce la riga validata con `RecipePrefSchema`. **Non tocca** `times_used` né `last_used_at` |

- `ensureRecipePrefRow` prima di `lockRecipePref` è un fix della code review: senza riga `FOR UPDATE` non blocca nulla, e due prime scritture concorrenti sulla stessa ricetta potevano perdere un aggiornamento. `insertRecipeWith` crea sempre la riga, quindi il caso riguarda le ricette la cui riga manca per altre vie.
- La divisione dei campi evita aggiornamenti persi tra giudizi e uso: `writeRecipePref` scrive solo i tre campi di giudizio, `incrementRecipeUsage` ([[plan-repo]]) solo `times_used` e `last_used_at`.
- `lockRecipePref` blocca una riga sola e `updateRecipePref` non prende l'advisory lock dei piani: non può formarsi un ciclo di attese con la conferma del piano (osservazione della review architetturale di F5).

Test: `tests/db/recipe-pref-repo.test.ts` (DB reale): appartenenza all'household, riga letta in transazione e `null` se manca, creazione della riga di default e riga esistente intatta, scrittura che conserva `times_used` e `last_used_at`, creazione della riga se assente.

### Nota sul costo di `listRecipes` (Feature 5)
Dalla Feature 5 `listRecipes` è chiamata anche a ogni visita della Libreria, a ogni apertura del dettaglio e a ogni giudizio su un ingrediente ([[library-service]], [[prefs-service]]), non più solo da generazione, *Ripeti* e swap. Restituisce e valida con Zod tutte le ricette dell'household con ingredienti e preferenze: il costo cresce in modo lineare con la libreria (misure e rimedio in [[e2-libreria-preferenze]]). `getRecipeById` non ha `executor` e non controlla l'household; il dettaglio della Libreria non la usa e cerca la ricetta nella libreria dell'household già letta, che gli serve comunque per i conteggi d'impatto.

### Nuovo chiamante di `listRecipesWith` (Feature 6)
`addManualShoppingItem` ([[shopping-service]]) legge l'intera libreria dell'household con `listRecipesWith(tx, { household_id })`, dentro la transazione che tiene il lock dei piani, per dedurre il reparto di un articolo aggiunto a mano. È un'altra lettura completa, una per articolo aggiunto; il rimedio annotato in testa a `lib/shopping/service.ts` è lo stesso della Feature 5 (conteggio in SQL su `recipe_ingredients_canonical_name_idx`). Il repository non è stato modificato.

### Nuovi chiamanti di `listRecipesWith` (Feature 9)
`listSlotCandidates` (con `db`) e `assignSlotRecipe` (con la transazione, sotto il lock dei piani) di [[plan-service]] leggono l'intera libreria dell'household: il primo per elencare le ricette adatte allo slot, il secondo per trovare **una** ricetta per id e controllarne l'idoneità (requirements P10: `getRecipeById` non accetta un executor né controlla l'household). La seconda lettura è evitabile; la review architetturale della Feature 9 (R7) fissa la soglia per intervenire (oltre 200 ricette, o più di 300 ms sul Pi per aprire *Scegli*) e il rimedio: `getRecipeById(id, executor = db)` con controllo dell'household.

## Classificazione delle Ricette (Feature 8)

Due funzioni in coda al file, per la classificazione delle ricette senza portata ([[recipe-classification]]) e per il seed ([[fixtures-and-seed]]).

| Funzione | Comportamento |
|---|---|
| `listUnclassifiedRecipes(executor, householdId): Promise<UnclassifiedRecipe[]>` | Ricette dell'household con `cardinality(courses) = 0`, dalla meno recente (`created_at`, poi `id`). Legge solo i campi che servono al modello: `id`, `title`, `description`, `meal_types`, `tags` e le righe di ingredienti con `canonical_name` (com'è nel DB) e `unit`. Gli elenchi chiusi sono validati con Zod come nelle altre letture |
| `setRecipeClassification(executor, recipeId, courses, tags): Promise<boolean>` | `UPDATE recipes SET courses, tags WHERE id = … AND cardinality(courses) = 0 RETURNING id`: scrive **solo** se la ricetta è ancora non classificata e restituisce se ha scritto |

- `cardinality(courses) = 0` equivale a `courses = '{}'` della spec, ma non dipende dal letterale di array (requirements P14 della Feature 8). La condizione rende la scrittura sicura senza lock: due classificazioni sovrapposte, o una ricetta salvata nel frattempo con le sue portate, non si sovrascrivono.
- Il `boolean` serve a contare le ricette classificate davvero (`classified` nel rapporto della classificazione, `recipesClassified` nel seed).
- Le due funzioni non toccano ingredienti né preferenze.

Test: `tests/db/recipe-classification-repo.test.ts` (DB reale): solo le ricette dell'household senza portate, con i loro ingredienti; la più vecchia per prima; una sola scrittura, poi la ricetta resta com'è; nessuna scrittura su una ricetta che ha già portate; una ricetta classificata esce dall'elenco.

## Esempio d'Uso con Transazione Esterna

```ts
import { db } from '@/lib/db';
import {
  acquireRecipeGenerationLock,
  insertRecipeWith,
  findSimilarRecipeTitle,
  slugExists,
} from '@/lib/db/repositories/recipe-repo';

await db.transaction(async (tx) => {
  // 1. Lock di sessione
  await acquireRecipeGenerationLock(tx);

  // 2. Controllo similarità
  const similar = await findSimilarRecipeTitle(tx, householdId, 'Risotto ai funghi');
  if (similar) {
    throw new Error(`Titolo troppo simile a: ${similar}`);
  }

  // 3. Inserimento atomico
  const recipe = await insertRecipeWith(
    tx,
    {
      household_id: householdId,
      title: 'Risotto ai Funghi Porcini',
      slug: 'risotto-ai-funghi-porcini',
      steps: ['Tostare il riso', 'Aggiungere il brodo'],
      meal_types: ['cena'],
      servings_base: 2,
      prep_minutes: 30,
    },
    [
      { canonical_name: 'riso carnaroli', display_name: 'Riso Carnaroli', qty: 160, unit: 'g', category: 'dispensa' },
      { canonical_name: 'funghi porcini', display_name: 'Funghi Porcini secchi', qty: 30, unit: 'g', category: 'dispensa' },
    ]
  );
});
```

## Vedi anche

- [[database-schema]] — Struttura tabelle `recipes`, indici GIN trigram e vincoli
- [[database-architecture]] — Transazionalità, pg_trgm e cascade delete
- [[domain-types]] — Tipi `Recipe`, `Ingredient`, `RecipePref`, `Unit`, `Category`
- [[recipe-generation]] — Servizio che orchestra generazione e deduplicazione
- [[fixtures-and-seed]] — Inserimento ricette di base tramite `insertRecipe`
- [[plan-repo]] — Repository dei piani, che usa `toRecipeWithDetails`
- [[plan-service]] — Lettura della libreria con `listRecipesWith` dentro il lock
- [[prefs-service]] — `updateRecipePref`, che usa le funzioni di scrittura delle preferenze (Feature 5)
- [[library-service]] — Lettura della libreria per card e dettaglio (Feature 5)
- [[ingredient-pref-repo]] — Repository dei giudizi sugli ingredienti (Feature 5)
- [[shopping-service]] — Lettura della libreria per il reparto degli articoli a mano (Feature 6)
- [[recipe-proposal-service]] — `listRecipeTitleRefs`, salvataggio sotto il lock di generazione (Feature 9)
- [[recipe-classification]] — `listUnclassifiedRecipes` e `setRecipeClassification` (Feature 8)
