# Catalogo Documentazione Tecnica (Wiki Mealy)

Benvenuto nella documentazione tecnica interna del progetto **Mealy**. Questo indice cataloga tutte le pagine della wiki organizzate per categorie (Topic, Concetti, Entità).

## Topics (Aggregati Tematici)

- [[e0-fondamenta]] — Panoramica dell'architettura fondamentale (Feature 1), dallo scaffold Next.js 15.5 al layer DB e alla shell UI. (2026-09-15)
- [[e1-motore-ricette]] — Pipeline di generazione ricette assistita da LLM, deduplicazione trigrammi, fixtures offline e seed idempotente (Feature 2). (2026-09-17)
- [[e5-impostazioni]] — Onboarding obbligatorio e vincoli household: `GET/PUT /api/settings`, wizard `/benvenuto`, form `/impostazioni`, route group `(app)` e contratto U1 per il planner (Feature 3). (2026-09-28)

## Concetti Architetturali & Design

- [[single-source-of-truth-types]] — Principio vincolante che stabilisce gli schemi Zod in `lib/domain/types.ts` come unica fonte di verità dei tipi. (2026-09-15)
- [[database-architecture]] — Architettura del database relazionale PostgreSQL 16 con estensione `pg_trgm`, Drizzle ORM e migrazioni. (2026-09-15)
- [[design-system-and-tokens]] — Filosofia visiva editoriale, configurazione `@theme` in Tailwind CSS v4, palette cromatiche e caratteri `Fraunces`/`Figtree`. (2026-09-15)
- [[shell-navigation-pattern]] — Pattern di shell applicativa mobile-first persistente con navigazione a 4 tab, montata dal layout del route group `(app)`, e gestione dei padding. (2026-09-28)
- [[onboarding-guard]] — Guardia di onboarding server-side nel layout del route group `app/(app)/`: redirect a `/benvenuto`, `connection()` e `BottomNav` per gruppo. (2026-09-28)

## Entità di Dominio, Dati & UI

- [[domain-types]] — Schemi Zod di validazione runtime, tipi TypeScript inferiti, contratti di generazione LLM e delle impostazioni, etichette UI e funzioni pure di normalizzazione (`lib/domain/`). (2026-09-28)
- [[database-schema]] — Modello dati relazionale a 9 tabelle Drizzle con indici GIN, trigram, vincoli a cascata, colonna `households.onboarded_at` e migrazioni versionate (`lib/db/schema.ts`). (2026-09-28)
- [[household-repo]] — Repository del singleton nucleo familiare: `loadHousehold`, `updateHousehold` con `updated_at = now()` del DB e invariante del contratto U1 (`lib/db/repositories/household-repo.ts`). (2026-09-28)
- [[settings-service]] — Funzioni pure di normalizzazione, servizio `getSettings`/`saveSettings`, client `putSettings` e API `GET/PUT /api/settings` (`lib/settings/`, `app/api/settings/`). (2026-09-28)
- [[settings-fields]] — Controlli condivisi dei 5 vincoli (stepper persone e chip) riusati da wizard e form (`components/settings/settings-fields.tsx`). (2026-09-28)
- [[settings-editor]] — Form di modifica `/impostazioni` con Salva esplicito, banner "Il prossimo piano userà i nuovi vincoli." e segnaposto ingredienti (`components/settings/settings-editor.tsx`). (2026-09-28)
- [[onboarding-wizard]] — Wizard di primo avvio a 5 passi non saltabile su `/benvenuto`, con barra di avanzamento e gestione del focus (`components/settings/onboarding-wizard.tsx`). (2026-09-28)
- [[recipe-repo]] — Repository per persistenza atomica, ricerca similarità trigrammi `findSimilarRecipeTitle`, advisory lock e collisioni slug (`lib/db/repositories/recipe-repo.ts`). (2026-09-17)
- [[llm-adapter]] — Adapter multi-provider per Vercel AI SDK 7 con repair loop a 2 fasi, prompt vincoli ed errori tipizzati `LlmError` (`lib/llm/`). (2026-09-17)
- [[recipe-generation]] — Servizio orchestratore di vincoli, cascata di deduplicazione, persistenza protetta da advisory lock ed endpoint HTTP (`lib/recipes/`, `app/api/recipes/generate/`). (2026-09-28)
- [[fixtures-and-seed]] — Corpus statico di 18 ricette casalinghe normalizzate, 24 alias, loader in memoria `fixtureRecipesAsDomain` e seed database idempotente (`fixtures/`, `lib/db/seed*.ts`). (2026-09-17)
- [[bottom-nav]] — Barra di navigazione fissa inferiore mobile-first a 4 tab con safe-area padding, montata dal layout `app/(app)/` (`components/navigation/bottom-nav.tsx`). (2026-09-28)
- [[meal-card]] — Scheda del pasto pianificato con eyebrow, titolo Fraunces, pulsante swap tomato e stella saffron (`components/cards/meal-card.tsx`). (2026-09-15)
- [[recipe-sheet]] — Pannello modale scorrevole dal basso per dettaglio ricetta, scala porzioni, gradimento ingredienti e voto (`components/sheets/recipe-sheet.tsx`). (2026-09-15)
- [[shopping-item-row]] — Riga articolo della spesa interamente toccabile con stato barrato e feedback accessibile (`components/shopping/shopping-item-row.tsx`). (2026-09-15)
- [[chip-filter]] — Chip a pillola per filtraggio multi-criterio per tag e regimi alimentari, riusato nei campi delle impostazioni (`components/filters/chip-filter.tsx`). (2026-09-28)
- [[empty-state]] — Componente di cortesia con icona centrata, titolo Fraunces e pulsante di azione primaria (`components/feedback/empty-state.tsx`). (2026-09-15)

---
*Per lo storico delle modifiche e delle operazioni della wiki, consulta il [[log]].*
