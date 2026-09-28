# Wiki Log — Mealy

Append-only operation log per le modifiche alla documentazione tecnica di Mealy.

## [2026-09-28] fix | Smoke test LLM reale (debito F2)
- Aggiornata l'entità [[llm-adapter]]: `gemini-2.5-flash` non è più disponibile per i nuovi account; modello di esempio `gemini-3.1-flash-lite`, alternativa consigliata OpenRouter `z-ai/glm-5.3-flash` (38 s per 3 ricette, entro `LLM_TIMEOUT_MS`). Esiti completi nel piano della Feature 2 e risposte registrate in `tests/fixtures/llm/recorded/`.

## [2026-09-28] feat-3 | Documentazione Feature 3 (E5 Impostazioni)
- Documentato il topic aggregato [[e5-impostazioni]] (onboarding obbligatorio e vincoli household: flusso guardia → wizard/form → `PUT /api/settings` → `saveSettings`, decisioni U1–U3, innesti P1–P3 della review architetturale e contratto U1 per la Feature 4).
- Creato il concetto [[onboarding-guard]]: route group `app/(app)/` con layout server-side che reindirizza a `/benvenuto` gli household non onboardati, `await connection()`, `BottomNav` montata per gruppo, conseguenze per F4 (percorso `app/(app)/page.tsx`, doppia lettura `getSettings` da valutare con `React.cache()`).
- Creata l'entità [[settings-service]] (`lib/settings/`, `app/api/settings/`): funzioni pure `normalize.ts` (client-safe), servizio server `getSettings`/`saveSettings` senza scritture a vincoli invariati, client `putSettings` con `SettingsRequestError` (2xx non JSON → `invalid_response`), API `GET/PUT /api/settings`, contratto U1 e punti aperti R1/R2/Q1.
- Create le entità UI [[settings-fields]] (controlli condivisi dei 5 campi, copy e validità), [[settings-editor]] (form `/impostazioni` con Salva esplicito, banner, `router.refresh()`, `<fieldset disabled>` e live region sempre montata) e [[onboarding-wizard]] (wizard `/benvenuto` a 5 passi, progressbar, focus sull'`h1`, `replace('/')` + `refresh()`).
- Aggiornata l'entità [[household-repo]]: nuova `loadHousehold(id?)`, `updateHousehold` con `updated_at = now()` del DB e invariante del contratto U1, `ensureDefaultHousehold` solo per l'id di default, `onboarded_at` nel singleton.
- Aggiornata l'entità [[domain-types]]: etichette `MEAL_TYPE_LABELS`/`MEAL_STYLE_TAG_LABELS`, `PERSONS_MIN`/`PERSONS_MAX` condivisi con i contratti di F2, `Household.onboarded_at`, contratti `HouseholdSettingsSchema`, `UpdateSettingsRequestSchema`, `SettingsViewSchema`, `SaveSettingsResultSchema`.
- Aggiornata l'entità [[database-schema]]: colonna `households.onboarded_at`, semantica di `updated_at` e tabella delle migrazioni `0000`–`0002`.
- Aggiornati [[shell-navigation-pattern]] e [[bottom-nav]]: la shell e la `BottomNav` vivono ora nel layout `app/(app)/layout.tsx`; il root layout contiene solo `{children}` (corretti anche gli snippet precedenti, che indicavano un `<main>` inesistente nel root layout).
- Aggiornata l'entità [[recipe-generation]]: risoluzione dell'household tramite `loadHousehold`, limiti `persons` condivisi, origine dei vincoli dalle impostazioni. Aggiunto il riferimento a [[settings-fields]] in [[chip-filter]].
- Creato il `README.md` alla radice del repository (stato v0.2.0, stack, requisiti, avvio in sviluppo con note su primo avvio e porta 5432, comandi e gate, deploy, link alla documentazione).
- Aggiornato il catalogo generale in [[index]].

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
