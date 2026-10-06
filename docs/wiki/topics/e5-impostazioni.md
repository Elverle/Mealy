---
title: E5 Impostazioni — Onboarding e Vincoli Household
type: topic
created: 2026-09-28
updated: 2026-10-05
tags: [settings, onboarding, household, api, route-group, ui, e5, feature-3]
---

## Panoramica

L'iniziativa **E5 Impostazioni** (implementata nella Feature 3, story `S5.1 Onboarding e impostazioni` del backlog) fa entrare davvero i vincoli del nucleo domestico nel sistema. Fino alla Feature 2 la schermata Impostazioni era un mock con dati finti; ora:

1. i 5 vincoli dell'household (`persons`, `meals`, `meal_style_tags`, `diet_tags`, `appliances`) si leggono e si salvano tramite `GET/PUT /api/settings`;
2. al primo avvio un **wizard a 5 passi obbligatorio** (`/benvenuto`) raccoglie i vincoli, precompilati con i valori di default;
3. da `/impostazioni` un **form unico con pulsante Salva** modifica i vincoli e, se qualcosa cambia davvero, mostra il banner "Il prossimo piano userà i nuovi vincoli.";
4. i vincoli salvati arrivano a planner e LLM tramite `buildConstraints` ([[recipe-generation]]), senza alcuna rigenerazione automatica dei piani.

### Decisioni dell'utente (requirements, 2026-09-17)

| ID | Decisione |
|---|---|
| U1 | Banner in Impostazioni dopo un salvataggio che cambia qualcosa, **più un contratto per F4**: un piano è superato dai vincoli se `settings.updated_at > meal_plans.created_at`. |
| U2 | Form di modifica con **pulsante Salva esplicito**, attivo solo con modifiche valide; un solo `PUT`. |
| U3 | **Wizard non saltabile**, 5 passi precompilati con i valori attuali. |

## Architettura del Flusso

```
[ Richiesta a /, /lista, /libreria, /impostazioni ]
                      │
                      ▼
+─────────────────────────────────────────────────────────────+
|  app/(app)/layout.tsx  (server, await connection())         |
|  getSettings() ──► onboarded?                               |
|     no  ──► redirect('/benvenuto')                          |
|     sì  ──► {children} + <BottomNav />                      |
+─────────────────────────────────────────────────────────────+
          │ no                                   │ sì
          ▼                                      ▼
+──────────────────────────────+   +──────────────────────────────+
| /benvenuto (fuori dal gruppo)|   | /impostazioni                |
| OnboardingWizard: 5 passi    |   | SettingsEditor: 5 card + Salva|
| putSettings({..., complete_  |   | putSettings(draft)           |
|   onboarding: true})         |   | banner se changed            |
| replace('/') + refresh()     |   | router.refresh()             |
+──────────────────────────────+   +──────────────────────────────+
                 │                                │
                 └──────────────┬─────────────────┘
                                ▼
+─────────────────────────────────────────────────────────────+
|  PUT /api/settings  (app/api/settings/route.ts)             |
|  UpdateSettingsRequestSchema.safeParse ──► 400 + details    |
+─────────────────────────────────────────────────────────────+
                                │
                                ▼
+─────────────────────────────────────────────────────────────+
|  saveSettings (lib/settings/service.ts)                     |
|  normalizeSettings ─► settingsEqual vs household corrente   |
|  nessun cambio e onboarding già fatto ─► nessuna scrittura  |
|  altrimenti updateHousehold(..., id)                        |
|     updated_at = now() del DB; onboarded_at solo se null    |
+─────────────────────────────────────────────────────────────+
```

## Moduli e Componenti Introdotti

### 1. Dati e Dominio
- [[database-schema]]: nuova colonna nullable `households.onboarded_at timestamptz` (migrazione `lib/db/migrations/0002_add_household_onboarded_at.sql`, una sola istruzione `ALTER TABLE … ADD COLUMN`). Le righe esistenti restano `null`, quindi un database già in uso richiede il wizard al primo accesso dopo l'aggiornamento.
- [[domain-types]]: etichette `MEAL_TYPE_LABELS` e `MEAL_STYLE_TAG_LABELS`, limiti `PERSONS_MIN`/`PERSONS_MAX` (1..12, ora condivisi con i contratti di generazione di F2), `Household.onboarded_at`, e i contratti `HouseholdSettingsSchema`, `UpdateSettingsRequestSchema`, `SettingsViewSchema`, `SaveSettingsResultSchema`.
- [[household-repo]]: nuova `loadHousehold(id?)` (regola unica "singleton o id esistente", riusata da settings e generazione ricette), `updateHousehold` con `updated_at = now()` del DB e invariante documentata, `ensureDefaultHousehold` invocata solo per l'id di default.

### 2. Servizio, API e Client (`lib/settings/`, `app/api/settings/`)
- [[settings-service]]: funzioni pure in `normalize.ts` (client-safe), servizio server `getSettings`/`saveSettings`, client `putSettings` con `SettingsRequestError`, route `GET/PUT /api/settings` con il formato errori di F2. Nessun barrel `lib/settings/index.ts`.

### 3. Guardia di Onboarding (`app/(app)/`)
- [[onboarding-guard]]: le 4 tab spostate nel route group `app/(app)/`, il cui layout reindirizza a `/benvenuto` finché l'onboarding non è completato e monta la `BottomNav`. Il root layout non contiene più la barra ([[shell-navigation-pattern]]).

### 4. Interfaccia (`components/settings/`)
- [[settings-fields]]: controlli dei 5 campi condivisi tra wizard e form (stepper persone, chip `ChipFilter` per le scelte multiple), con copy e validità in un solo punto.
- [[onboarding-wizard]]: pagina `/benvenuto` e wizard a 5 passi con barra di avanzamento e gestione del focus.
- [[settings-editor]]: pagina `/impostazioni` e form con Salva, banner, errori, `router.refresh()` e segnaposto "I miei ingredienti". Dalla Feature 5 il segnaposto è sostituito dalla sezione reale [[ingredient-prefs-section]], con le liste lette da `ingredient_prefs` e la rimozione a un tap; la pagina legge anche `listIngredientPrefs()`.

## Contratto Consegnato alla Feature 4 (U1)

Un piano è **superato dai vincoli** se `Date.parse(settings.updated_at) > meal_plans.created_at`. `updated_at` cambia solo con modifiche reali dei vincoli o al completamento dell'onboarding ed è scritto dall'orologio del DB, lo stesso di `meal_plans.created_at`. Dettagli e invarianti in [[settings-service]] e [[household-repo]].

Punti aperti per il piano di F4 (review architetturale 2026-09-28 e addendum):
- **R1** — le preferenze ingredienti (F5) non toccano `households.updated_at`: decidere se accettarlo o estendere la regola;
- **R2** — la pagina Piano è in `app/(app)/page.tsx`;
- **Q1** — valutare `React.cache()` su `getSettings`/`loadHousehold` per evitare la doppia lettura layout + pagina.

**Esito nella Feature 4** ([[e3-pianificatore]]): il confronto usa ora `meal_plans.generated_at` al posto di `created_at` (si aggiorna a ogni rigenerazione); R1 accettato così com'è, R2 applicato, Q1 non adottato. Dettagli in [[settings-service]].

**Esito nella Feature 5** ([[e2-libreria-preferenze]]): **R1 è deciso in via definitiva**. Con le preferenze ingrediente ora reali, l'utente ha confermato che un giudizio (su ricetta o ingrediente) non modifica mai un piano esistente e vale dalla selezione successiva: generazione, rigenerazione, *Ripeti* o *Cambia* (requirements U2 della Feature 5, `ARCHITECTURE §5.4`). Quindi `setIngredientPref` e `updateRecipePref` **non** toccano `households.updated_at`, nessun 👎 rende "superato" un piano, e la regola del contratto U1 resta legata ai soli 5 vincoli dell'household. Un toast lo dice all'utente al momento del giudizio.

## Innesti della Review Architetturale

La review del 2026-09-28 (`docs/planning/feature/feature-3/architecture-review-2026-09-28.md`) ha fatto applicare tre correzioni dentro WP1:
- **P1** — `loadHousehold` nel repository invece di una seconda copia della regola in `lib/settings/service.ts`; `lib/recipes/generate.ts` la riusa (messaggio `Household <id> non trovato` invariato).
- **P2** — `updated_at` scritto con `now()` del DB e invariante documentata in `updateHousehold`; `createTestHousehold` (`tests/helpers/db.ts`) non imposta più `created_at`/`updated_at`, così i test confrontano istanti dello stesso orologio.
- **P3** — `PERSONS_MIN`/`PERSONS_MAX` dichiarati prima di `HouseholdSchema` e riusati in `RecipeConstraintsSchema` e `ConstraintOverridesSchema`; `HouseholdSchema.persons` resta senza massimo, così un valore fuori range in DB non rompe `GET /api/settings`.

## Strategia di Test

La feature porta il gate a 246 test verdi. Nuovi file:
- `tests/settings/normalize.test.ts`, `tests/settings/service.test.ts` (DB reale, household dedicati, verifica anche della migrazione `0002` e della propagazione a `buildConstraints`), `tests/settings/client.test.ts`;
- `tests/api/settings.test.ts` (servizio mockato);
- `tests/app/app-layout.test.tsx`, `tests/app/benvenuto-page.test.tsx`, `tests/app/settings-page.test.tsx` (server component con `next/server` e `next/navigation` mockati);
- `tests/ui/settings-fields.test.tsx`, `tests/ui/settings-editor.test.tsx`, `tests/ui/onboarding-wizard.test.tsx` (jsdom).

I test di F1 sono stati adeguati solo nei percorsi (`@/app/(app)/…`) e nel test della schermata Impostazioni, che ora rende `SettingsEditor` con una fixture.

## Vedi anche

- [[settings-service]] — Servizio, API, client e contratto U1
- [[settings-fields]] — Controlli condivisi dei 5 campi
- [[settings-editor]] — Form di modifica in `/impostazioni`
- [[onboarding-wizard]] — Wizard di primo avvio in `/benvenuto`
- [[onboarding-guard]] — Route group `(app)` e redirect server-side
- [[household-repo]] — `loadHousehold` e invariante di `updated_at`
- [[e1-motore-ricette]] — Feature 2, consumatrice dei vincoli tramite `buildConstraints`
- [[e0-fondamenta]] — Feature 1, shell e mock originari
- [[e3-pianificatore]] — Feature 4, consumatrice del contratto U1
- [[e2-libreria-preferenze]] — Feature 5, che sostituisce il segnaposto "I miei ingredienti" e chiude R1
- [[ingredient-prefs-section]] — Sezione reale "I miei ingredienti"
