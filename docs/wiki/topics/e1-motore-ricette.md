---
title: E1 Motore Ricette — Generazione, Adapter LLM e Libreria Persistente
type: topic
created: 2026-09-17
updated: 2026-10-05
tags: [recipes, llm, generation, fixtures, seed, architecture, e1, feature-2]
---

## Panoramica

L'iniziativa **E1 Motore Ricette** (implementata nella Feature 2) realizza la pipeline tecnologica che trasforma una richiesta condizionata da vincoli (persone, tipologia di pasto, diete, elettrodomestici disponibili, stili alimentari) in nuove ricette culinarie validate, deduplicate e archiviate stabilmente nel database relazionale.

L'intervento copre tre user story fondamentali del backlog di Mealy:
1. **S1.1 — LLM Adapter Multi-Provider**: integrazione provider-agnostica di Vercel AI SDK 7 (`lib/llm/`) con supporto a Google, OpenRouter, Anthropic e OpenAI-compatible, prompt engineering specializzato per la cucina casalinga italiana e repair loop automatico su errori di schema.
2. **S1.2 — Generazione e Persistenza Libreria**: servizio di generazione e salvataggio ricette (`lib/recipes/`) con verifica rigorosa dei vincoli, esclusione titoli esistenti nel prompt, filtro anti-duplicazione a 4 livelli (esatto, trigrammi Postgres `pg_trgm`, intra-batch, collisioni slug), protezione da concorrenza tramite advisory lock ed endpoint HTTP `POST /api/recipes/generate`.
3. **S1.3 — Seed e Fixtures Offline**: corpus statico di 18 ricette casalinghe e 24 alias ingredienti normalizzati (`fixtures/`), loader tipizzato in memoria `fixtureRecipesAsDomain` per test unitari e script di seed database idempotente `pnpm db:seed` (`lib/db/seed*.ts`).

### Il Principio Guida
> *"Le ricette generate non sono usa-e-getta, sono la libreria permanente"* (`ARCHITECTURE §1.3`, `CLAUDE.md`).

In Mealy l'LLM non viene invocato a ogni calcolo del piano settimanale; interviene esclusivamente come strumento di arricchimento ed espansione del catalogo quando la libreria non contiene un numero sufficiente di alternative valide per i vincoli dell'utente.

## Architettura della Pipeline di Generazione

Il flusso end-to-end garantisce la separazione delle responsabilità, la resilienza a errori sintattici del modello e l'integrità del database:

```
[ Richiesta HTTP POST /api/recipes/generate ]
                      │
                      ▼
+─────────────────────────────────────────────────────────────+
|  Route Handler (app/api/recipes/generate/route.ts)          |
|  - Validazione Zod del body (GenerateRecipesRequestSchema)  |
|  - Mappatura errori tipizzati LlmError in status HTTP       |
+─────────────────────────────────────────────────────────────+
                      │
                      ▼
+─────────────────────────────────────────────────────────────+
|  Servizio Generazione (lib/recipes/generate.ts)            |
|  1. Caricamento Household e aggregazione vincoli            |
|     buildConstraints(household, mealType, overrides)        |
|  2. Query titoli recenti dalla libreria (listRecipeTitles)  |
+─────────────────────────────────────────────────────────────+
                      │
                      │  (Chiamata FUORI transazione DB)
                      ▼
+─────────────────────────────────────────────────────────────+
|  LLM Adapter (lib/llm/adapter.ts)                           |
|  - System & User Prompts specializzati (prompts.ts)         |
|  - Provider LanguageModel via getModel() da variabili env   |
|  - Invocazione AI SDK 7 generateText({ output })             |
|  - Repair Loop a 2 fasi su NoObjectGeneratedError           |
|  - Normalizzazione e sanitizzazione campi (recipe-text.ts)  |
+─────────────────────────────────────────────────────────────+
                      │
                      │  Candidate generate (GeneratedRecipe[])
                      ▼
+─────────────────────────────────────────────────────────────+
|  Transazione Database Atomica (db.transaction)             |
|  - Advisory lock transazionale (pg_advisory_xact_lock)      |
|  - Controllo vincoli post-generazione                       |
|    findConstraintViolations(recipe, constraints)            |
|  - Deduplicazione titolo esatto normalizzato (normalizeTitle)|
|  - Deduplicazione similarità trigrammi > 0.6               |
|    findSimilarRecipeTitle(tx, household.id, title)          |
|  - Risoluzione globale collisioni slug (uniqueSlug)         |
|  - Inserimento atomico ricetta + ingredienti + pref default |
|    insertRecipeWith(tx, recipe, ingredients)                |
+─────────────────────────────────────────────────────────────+
                      │
                      ▼
[ Risultato: { requested, created: Recipe[], skipped: Skip[] } ]
```

Dalla Feature 5 ([[e2-libreria-preferenze]]) due passi di questa pipeline usano le preferenze ingrediente dell'household: al passo 1 `buildConstraints` riceve come quarto parametro gli insiemi letti da `loadIngredientPreferences` (gradimenti e scarti finiscono nel prompt), e dentro la transazione gli scarti vengono riletti prima di `findConstraintViolations`, così una ricetta che contiene un ingrediente scartato non entra in libreria. Dettagli in [[recipe-generation]]; l'adapter e i prompt non sono cambiati.

## Moduli e Componenti Introdotti

### 1. Adapter LLM (`lib/llm/`)
- [[llm-adapter]]: unico modulo autorizzato a importare `ai` e gli SDK dei fornitori. Fornisce l'infrastruttura per chiamate con output JSON strutturato (`GenerateRecipesOutputSchema`).
- Se il provider restituisce un formato parziale o non conforme a Zod, il repair loop diagnostica i singoli nodi errati (`describeValidationError`) e invia un prompt correttivo a temperatura bassa (`0.2`), recuperando il fallimento in modo trasparente.
- Incapsula tutti i problemi di rete, configurazione o modello nella classe `LlmError`.

### 2. Business Logic di Ricette (`lib/recipes/`)
- [[recipe-generation]]: contiene il coordinamento del processo. Costruisce i vincoli di dieta, stile, coperti ed elettrodomestici, ed esegue i controlli di congruenza post-generazione.
- Gestisce la sequenza di deduplicazione a 4 stadi:
  - Scarto per violazione vincoli.
  - Scarto per duplicato esatto (incluso intra-batch nello stesso array generato).
  - Scarto per similarità testuale trigram (`similarity() > 0.6`) sfruttando l'indice GIN di PostgreSQL.
  - Generazione di slug univoci garantiti a livello globale con suffissi progressivi o casuali.

### 3. Repository e Supporto Transazionale (`lib/db/repositories/recipe-repo.ts`)
- [[recipe-repo]]: aggiornato con l'interfaccia `DbExecutor` per operare indifferentemente su client o su transazione aperta.
- Aggiunti metodi specializzati: `insertRecipeWith`, `listRecipeTitles` (per esclusioni veloci), `findSimilarRecipeTitle` (ricerca fuzzy basata su `pg_trgm`), `slugExists` e `acquireRecipeGenerationLock`.
- Tipi rafforzati con vincoli precisi: `unit: Unit` e `category: Category` per l'inserimento degli ingredienti.

### 4. Fixtures e Seed Idempotente (`fixtures/` e `lib/db/seed*.ts`)
- [[fixtures-and-seed]]: 18 ricette casalinghe complete e 24 alias di ingredienti conformi a tutti gli standard di normalizzazione.
- Fornisce il loader `fixtureRecipesAsDomain` per testare planner e lista spesa in memoria senza DB né LLM.
- Fornisce il comando `pnpm db:seed` per popolare il database PostgreSQL locale in modo completamente idempotente (skip ricette esistenti per id/slug, `ON CONFLICT DO NOTHING` per alias).

### 5. Dominio Tipato e Normalizzazione Pura (`lib/domain/`)
- [[domain-types]]: esteso con i contratti Zod per la generazione (`GeneratedRecipeSchema`, `RecipeConstraintsSchema`, `ConstraintOverridesSchema`, `GenerateRecipesRequestSchema`, `GenerationSkipSchema`, `FixtureRecipeSchema`).
- `lib/domain/recipe-text.ts`: funzioni pure per normalizzare titoli (`normalizeTitle`), generare slug URL-friendly (`slugify`), normalizzare nomi ingredienti (`normalizeCanonicalName`), espandere diete per implicazione transitiva (`expandDietFlags`) e normalizzare l'intera struttura della ricetta generata (`normalizeGeneratedRecipe`).

## Strategia di Testing Offline e Senza Rete

In piena osservanza delle regole architetturali di progetto (`CLAUDE.md § Regole di architettura` e `§ Stack`):
- Nessun test automatico della suite CI/CD o di Vitest effettua chiamate HTTP verso API LLM esterne.
- I test dell'adapter (`tests/llm/`) impiegano `MockLanguageModelV4` da `ai/test` e caricano risposte precedentemente registrate tramite la CLI `pnpm llm:record`.
- I test del database (`tests/recipes/`, `tests/db/`) utilizzano l'istanza Docker locale di PostgreSQL 16 con estensione `pg_trgm` abilitata.

## Vedi anche

- [[llm-adapter]] — Architettura dell'adapter LLM e gestione errori
- [[recipe-generation]] — Servizio `generateAndStoreRecipes` e route handler HTTP
- [[fixtures-and-seed]] — Corpus ricette offline e script seed database
- [[recipe-repo]] — Repository persistente e supporto transazionale
- [[domain-types]] — Schemi Zod di generazione e funzioni di testo pure
- [[e0-fondamenta]] — Architettura fondamentale di Mealy (Feature 1)
- [[e2-libreria-preferenze]] — Feature 5: scarti e gradimenti nei vincoli di generazione
