---
title: Repository Ricette (recipe-repo)
type: entity
created: 2026-09-15
updated: 2026-09-29
tags: [database, repository, recipes, ingredients, preferences, drizzle, transactions, trigram, advisory-lock, executor]
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
- `InsertRecipeInput`: dati anagrafici della ricetta (`title`, `slug`, `steps`, `meal_types`, `tags`, `diet_flags`, `appliances_required`, `servings_base`, `prep_minutes`, `kcal_est`, `source`, ecc.).
- `InsertIngredientInput`: lista ingredienti associati. **Restringimento forte dei tipi (Fix-P2)**:
  - `unit: Unit`: non una stringa generica, ma ristretto rigidamente ai valori ammessi `['g', 'ml', 'pz', 'qb']`.
  - `category: Category`: non una stringa generica, ma ristretto rigidamente ai 9 reparti spesa da [[domain-types]].
- `InsertRecipePrefInput`: preferenze opzionali (`rating`, `favorite`, `blocked`, `times_used`, `last_used_at`).
- `RecipeWithDetails`: tipo composito validato da Zod che unisce la `Recipe` con l'array tipato di `Ingredient[]` e l'oggetto `RecipePref | null`.

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
**Regola vincolante**: deve essere invocato unicamente all'interno di una transazione database attiva. Il lock garantisce che due generazioni simultanee non entrino in conflitto e viene rilasciato automaticamente dal database alla chiusura della transazione.

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
