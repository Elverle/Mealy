# Catalogo Documentazione Tecnica (Wiki Mealy)

Benvenuto nella documentazione tecnica interna del progetto **Mealy**. Questo indice cataloga tutte le pagine della wiki organizzate per categorie (Topic, Concetti, Entità).

## Topics (Aggregati Tematici)

- [[e0-fondamenta]] — Panoramica dell'architettura fondamentale (Feature 1), dallo scaffold Next.js 15.5 al layer DB e alla shell UI. (2026-09-15)
- [[e1-motore-ricette]] — Pipeline di generazione ricette assistita da LLM, deduplicazione trigrammi, fixtures offline e seed idempotente (Feature 2). (2026-10-05)
- [[e5-impostazioni]] — Onboarding obbligatorio e vincoli household: `GET/PUT /api/settings`, wizard `/benvenuto`, form `/impostazioni`, route group `(app)` e contratto U1 per il planner (Feature 3). (2026-10-05)
- [[e3-pianificatore]] — Piano settimanale dalla libreria: selezione pesata riproducibile, generazione LLM a lotti solo se serve, swap, blocco, conferma, *Ripeti* e navigatore di settimane; contratti per F5/F6 (Feature 4). (2026-10-05)
- [[e2-libreria-preferenze]] — Libreria reale con ricerca e filtri, preferenze sulla ricetta (voto, ★, *Non proporre più*) in Libreria e nel Piano, 👍/👎 sugli ingredienti cablati in planner e generazione, *I miei ingredienti*; decisioni, limiti noti e contratti per F6 (Feature 5). (2026-10-05)

## Concetti Architetturali & Design

- [[single-source-of-truth-types]] — Principio vincolante che stabilisce gli schemi Zod in `lib/domain/types.ts` come unica fonte di verità dei tipi. (2026-09-15)
- [[database-architecture]] — Architettura del database relazionale PostgreSQL 16 con estensione `pg_trgm`, Drizzle ORM e migrazioni; uso effettivo degli indici alla Feature 5. (2026-10-05)
- [[design-system-and-tokens]] — Filosofia visiva editoriale, configurazione `@theme` in Tailwind CSS v4, palette cromatiche, caratteri `Fraunces`/`Figtree` e animazione dello swap con movimento ridotto. (2026-09-29)
- [[shell-navigation-pattern]] — Pattern di shell applicativa mobile-first persistente con navigazione a 4 tab, montata dal layout del route group `(app)`, e gestione dei padding. (2026-10-05)
- [[onboarding-guard]] — Guardia di onboarding server-side nel layout del route group `app/(app)/`: redirect a `/benvenuto`, `connection()` e `BottomNav` per gruppo. (2026-10-05)
- [[plan-concurrency-pattern]] — Generazione LLM fuori dalle transazioni, selezione rifatta dentro l'advisory lock sullo stato riletto, conferma con transizione condizionata. (2026-10-05)

## Entità di Dominio, Dati & UI

- [[domain-types]] — Schemi Zod di validazione runtime, tipi TypeScript inferiti, contratti di generazione LLM, delle impostazioni, dei piani, della libreria e delle preferenze, etichette UI e funzioni pure di normalizzazione (`lib/domain/`). (2026-10-05)
- [[planner]] — Selezione pesata pura e riproducibile, esclusioni, pausa morbida, `needMore` e lotti di generazione, RNG seedabile e settimana obiettivo (`lib/domain/{planner,planner-config,rng,week}.ts`). (2026-10-05)
- [[database-schema]] — Modello dati relazionale a 10 tabelle Drizzle con indici GIN, trigram, vincoli a cascata, colonne `onboarded_at`, `generated_at`, `needs_regeneration`, tabella `ingredient_prefs` e migrazioni `0000`–`0004` (`lib/db/schema.ts`). (2026-10-05)
- [[household-repo]] — Repository del singleton nucleo familiare: `loadHousehold`, `getHouseholdById` con executor, `updateHousehold` con `updated_at = now()` del DB e invariante del contratto U1 (`lib/db/repositories/household-repo.ts`). (2026-10-05)
- [[plan-repo]] — Repository dei piani: letture complete, `listPlanWeeks`, advisory lock per household, `activateDraftPlan`, uso delle ricette al giorno del pasto, flag lista da rigenerare (`lib/db/repositories/plan-repo.ts`). (2026-09-29)
- [[plan-service]] — Servizio dei piani (schermata, genera, *Ripeti*, conferma, blocco, swap), errori `PlanError`, API `app/api/plans/**`, client fetch e formattazione date (`lib/plans/`). (2026-10-05)
- [[library-service]] — Regole pure di card, filtro, ricerca e ordinamento, servizio `listLibraryCards`/`listLibrary`/`getRecipeDetail`, API `GET /api/recipes` e `GET /api/recipes/:id`, client `fetchRecipeDetail` (`lib/domain/library.ts`, `lib/library/`). (2026-10-05)
- [[prefs-service]] — Regole pure delle preferenze (`applyRecipePrefPatch`, impatto, validazione del nome), servizio `updateRecipePref`/`listIngredientPrefs`/`setIngredientPref`, `loadIngredientPreferences`, API e client delle preferenze (`lib/domain/prefs.ts`, `lib/prefs/`). (2026-10-05)
- [[http-helpers]] — Busta d'errore condivisa, `readJsonBody`, `llmErrorResponse`, client generico `requestJson`/`ApiRequestError` e `apiErrorMessage` (`lib/http/`). (2026-10-05)
- [[settings-service]] — Funzioni pure di normalizzazione, servizio `getSettings`/`saveSettings`, client `putSettings` e API `GET/PUT /api/settings` (`lib/settings/`, `app/api/settings/`). (2026-10-05)
- [[settings-fields]] — Controlli condivisi dei 5 vincoli (stepper persone e chip) riusati da wizard e form (`components/settings/settings-fields.tsx`). (2026-09-28)
- [[settings-editor]] — Form di modifica `/impostazioni` con Salva esplicito, banner "Il prossimo piano userà i nuovi vincoli." e sezione "I miei ingredienti" in fondo (`components/settings/settings-editor.tsx`). (2026-10-05)
- [[ingredient-prefs-section]] — Sezione "I miei ingredienti": liste *Mi piacciono* / *Scartati* con impatto, rimozione a un tap, focus e annuncio dopo la rimozione (`components/settings/ingredient-prefs-section.tsx`). (2026-10-05)
- [[onboarding-wizard]] — Wizard di primo avvio a 5 passi non saltabile su `/benvenuto`, con barra di avanzamento e gestione del focus (`components/settings/onboarding-wizard.tsx`). (2026-09-28)
- [[recipe-repo]] — Repository per persistenza atomica, ricerca similarità trigrammi `findSimilarRecipeTitle`, advisory lock, collisioni slug, `listRecipesWith`, `toRecipeWithDetails` e scrittura delle preferenze con blocco di riga (`lib/db/repositories/recipe-repo.ts`). (2026-10-05)
- [[ingredient-pref-repo]] — Repository di `ingredient_prefs`: `listIngredientPrefRows`, `upsertIngredientPref`, `deleteIngredientPref` (`lib/db/repositories/ingredient-pref-repo.ts`). (2026-10-05)
- [[llm-adapter]] — Adapter multi-provider per Vercel AI SDK 7 con repair loop a 2 fasi, prompt vincoli, errori tipizzati `LlmError` e timeout di 90 s per lotto (`lib/llm/`). (2026-09-29)
- [[recipe-generation]] — Servizio orchestratore di vincoli (con scarti e gradimenti sugli ingredienti), cascata di deduplicazione, persistenza protetta da advisory lock ed endpoint HTTP, chiamato a lotti da 3 dal servizio dei piani (`lib/recipes/`, `app/api/recipes/generate/`). (2026-10-05)
- [[fixtures-and-seed]] — Corpus statico di 18 ricette casalinghe normalizzate, 24 alias, loader in memoria `fixtureRecipesAsDomain` e seed database idempotente (`fixtures/`, `lib/db/seed*.ts`). (2026-09-17)
- [[bottom-nav]] — Barra di navigazione fissa inferiore mobile-first a 4 tab con safe-area padding, montata dal layout `app/(app)/` (`components/navigation/bottom-nav.tsx`). (2026-09-28)
- [[plan-screen]] — Pagina Piano reale: navigatore di settimane, genera/rigenera con avanzamento e recupero da errori di rete, swap con flip, blocco, conferma, *Ripeti*, ★ sulle card e dettaglio con preferenze (`app/(app)/page.tsx`, `components/plan/`). (2026-10-05)
- [[library-screen]] — Pagina Libreria reale: ricerca per titolo o ingrediente, riga rapida e pannello *Filtri*, card con ★ rapida, stati vuoti, dettaglio scalato sulle persone (`app/(app)/libreria/`, `components/library/`). (2026-10-05)
- [[meal-card]] — Scheda del pasto pianificato con eyebrow, titolo Fraunces, *Cambia* e stella solo con handler, long-press e azioni sostitutive (`components/cards/meal-card.tsx`). (2026-10-05)
- [[recipe-sheet]] — Pannello modale presentazionale per dettaglio ricetta: scala porzioni, gradimento ingredienti con conferma di scarto e impatto, voto, scheletro di caricamento; conversione `toRecipeDetail` (`components/sheets/`). (2026-10-05)
- [[recipe-detail-sheet]] — Dettaglio ricetta unico per Piano e Libreria: carica `GET /api/recipes/:id`, salva preferenze e giudizi in modo ottimistico, avvisa il genitore con i soli campi cambiati (`components/recipes/recipe-detail-sheet.tsx`). (2026-10-05)
- [[shopping-item-row]] — Riga articolo della spesa interamente toccabile con stato barrato e feedback accessibile (`components/shopping/shopping-item-row.tsx`). (2026-09-15)
- [[chip-filter]] — Chip a pillola per filtraggio multi-criterio per tag e regimi alimentari, riusato nei campi delle impostazioni e nei filtri della Libreria (`components/filters/chip-filter.tsx`). (2026-10-05)
- [[empty-state]] — Componente di cortesia con icona centrata, titolo Fraunces e pulsante di azione primaria (`components/feedback/empty-state.tsx`). (2026-10-05)
- [[toast]] — Notifica temporanea locale con live region sempre montata, senza intercettare i tap e sopra la sheet (`z-[60]`) (`components/feedback/toast.tsx`). (2026-10-05)

---
*Per lo storico delle modifiche e delle operazioni della wiki, consulta il [[log]].*
