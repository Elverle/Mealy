---
title: Fixtures di Test e Seed Idempotente (fixtures-and-seed)
type: entity
created: 2026-09-17
updated: 2026-09-17
tags: [fixtures, seed, database, testing, offline, household, aliases, ingredients]
---

## File e Responsabilità

- **Percorsi file**:
  - `fixtures/recipes.json`: file JSON con 18 ricette casalinghe italiane predefinite.
  - `fixtures/ingredient-aliases.json`: dizionario con 24 sinonimi e varianti di ingredienti mappati sui loro nomi canonici.
  - `fixtures/index.ts`: modulo TypeScript che carica, valida ed esporta le costanti delle fixtures e la funzione loader `fixtureRecipesAsDomain`.
  - `lib/db/seed-core.ts`: logica transazionale idempotente di popolamento database (`seedDatabase`).
  - `lib/db/seed.ts`: script eseguibile da riga di comando via `pnpm db:seed`.
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

## Vedi anche

- [[recipe-repo]] — Metodi `insertRecipe`, `getRecipeById`, `getRecipeBySlug`
- [[household-repo]] — Inizializzazione nucleo di default `ensureDefaultHousehold`
- [[domain-types]] — Schemi `FixtureRecipeSchema`, `FixtureFileSchema`, `IngredientAliasSchema`
- [[e1-motore-ricette]] — Architettura complessiva del motore ricette
- [[database-schema]] — Tabelle `recipes`, `recipe_ingredients`, `ingredient_aliases`
