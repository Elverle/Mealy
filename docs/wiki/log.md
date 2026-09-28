# Wiki Log — Mealy

Append-only operation log per le modifiche alla documentazione tecnica di Mealy.

## [2026-09-17] feat-2 | Documentazione Feature 2 (E1 Motore ricette)
- Documentato il topic aggregato [[e1-motore-ricette]] (pipeline end-to-end generazione ricette con LLM, adapter AI SDK 7, repair loop, deduplicazione trigrammi e persistenza).
- Creata l'entità [[llm-adapter]] (`lib/llm/`): architettura multi-provider (Google, OpenRouter, Anthropic, OpenAI-compatible), repair loop a 2 fasi su `NoObjectGeneratedError`, prompt vincoli/esclusioni, errori tipizzati `LlmError` e CLI `pnpm llm:record`.
- Creata l'entità [[recipe-generation]] (`lib/recipes/`, `app/api/recipes/generate/`): aggregazione e validazione vincoli (`buildConstraints`, `findConstraintViolations`), esecuzione LLM fuori transazione, inserimento atomico con advisory lock `pg_advisory_xact_lock`, cascata dedup a 4 stadi e route handler HTTP `POST /api/recipes/generate`.
- Creata l'entità [[fixtures-and-seed]] (`fixtures/`, `lib/db/seed*.ts`): 18 ricette casalinghe e 24 alias ingredienti normalizzati, loader tipizzato in memoria `fixtureRecipesAsDomain` per test offline e script di seed database idempotente `pnpm db:seed`.
- Aggiornata l'entità [[recipe-repo]] (`lib/db/repositories/recipe-repo.ts`): aggiunto supporto a `DbExecutor` (`Database | DbTransaction`), metodi `insertRecipeWith`, `listRecipeTitles`, similarità trigrammi `findSimilarRecipeTitle`, collisioni `slugExists`, advisory lock `acquireRecipeGenerationLock` e tipi ristretti `Unit`/`Category` (Fix-P2).
- Aggiornata l'entità [[domain-types]] (`lib/domain/`): inseriti nuovi contratti Zod di generazione (`GeneratedRecipeSchema`, `RecipeConstraintsSchema`, `ConstraintOverridesSchema`, `GenerateRecipesRequestSchema`, `GenerationSkipSchema`, `FixtureRecipeSchema`) e documentate le funzioni pure di normalizzazione testo (`normalizeTitle`, `slugify`, `normalizeCanonicalName`, `expandDietFlags`, `normalizeGeneratedRecipe`).
- Corretta la versione di Next.js da 16 a 15.5 in [[e0-fondamenta]] e [[index]] (Fix-P3).
- Aggiornato il catalogo generale in [[index]].

## [2026-09-15] init | Inizializzazione wiki e documentazione Feature 1 (E0 Fondamenta)
- Inizializzata la wiki di progetto sotto `docs/wiki/` secondo convenzioni standard e direttive di `CLAUDE.md`.
- Documentato il topic aggregato [[e0-fondamenta]].
- Documentati i concetti architetturali: [[single-source-of-truth-types]], [[database-architecture]], [[design-system-and-tokens]], [[shell-navigation-pattern]].
- Documentate le entità core introdotte: [[domain-types]], [[database-schema]], [[household-repo]], [[recipe-repo]], [[bottom-nav]], [[meal-card]], [[recipe-sheet]], [[shopping-item-row]], [[chip-filter]], [[empty-state]].
- Creato il catalogo delle pagine in [[index]].
