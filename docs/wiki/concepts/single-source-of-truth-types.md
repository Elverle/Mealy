---
title: Single Source of Truth dei Tipi di Dominio
type: concept
created: 2026-09-15
updated: 2026-10-26
tags: [domain, zod, types, contracts, single-source-of-truth, lint, feature-10]
---

## Il Principio

Una delle regole architetturali vincolanti di Mealy (`CLAUDE.md § Regole di architettura`) stabilisce che `lib/domain/types.ts` costituisce l'**unica fonte di verità** per tutti i tipi di dominio dell'applicazione.

Nessun componente React, repository DB, route handler Next.js o modulo di integrazione LLM può ridefinire privatamente i tipi per ricette, ingredienti, nuclei familiari, piani settimanali o liste della spesa.

## Vantaggi della Scelta

1. **Allineamento runtime e statico**: grazie a Zod, gli schemi di validazione runtime e i tipi statici TypeScript (`z.infer<typeof Schema>`) sono indissolubilmente accoppiati. Una modifica allo schema si propaga istantaneamente al type checker di TypeScript (`tsc`).
2. **Validazione dei contratti LLM**: le risposte strutturate prodotte dai modelli linguistici (tramite Vercel AI SDK `generateObject`) vengono convalidate direttamente contro gli schemi Zod di dominio, scartando o riparando output malformati prima che raggiungano il database.
3. **Validazione dei dati API e Form**: i medesimi schemi validano l'input utente inviato via Server Actions o Route Handlers.
4. **Prevenzione di drift architetturali**: la convergenza in un unico file impedisce la proliferazione di interfacce parzialmente incompatibili tra backend, frontend e repository.

## Liste Chiuse (Closed Enums)

Per garantire la massima prevedibilità nelle logiche di planning e consolidamento spesa, tutte le categorie tassonomiche sono definite come tuple immutabili (`as const`) abbinate a `z.enum`:

- **Unità di Misura (`UNIT_VALUES`)**: `['g', 'ml', 'pz', 'qb']`. L'LLM e l'utente normalizzano sempre i volumi e i pesi alle quattro unità supportate.
- **Reparti della Spesa (`CATEGORY_VALUES`)**: `['ortofrutta', 'pane', 'macelleria', 'pescheria', 'banco-frigo', 'dispensa', 'surgelati', 'bevande', 'altro']`. Abilitano l'aggregazione visiva per corsie del supermercato.
- **Tipi di Pasto (`MEAL_TYPE_VALUES`)**: `['pranzo', 'cena']`.
- **Esigenze Alimentari (`DIET_FLAG_VALUES`)**: `['vegetariano', 'vegano', 'senza-glutine', 'senza-lattosio', 'pescetariano']`.
- **Tag Stile Pasto (`MEAL_STYLE_TAG_VALUES`)**: `['veloce', 'salutare', 'proteico', 'leggero', 'comfort-food', 'economico', 'piatto-unico']`.
- **Elettrodomestici (`APPLIANCE_VALUES`)**: `['fornelli', 'forno', 'microonde', 'friggitrice-ad-aria', 'frullatore']`.
- **Stato del Piano (`PLAN_STATUS_VALUES`)**: `['draft', 'active', 'archived']`.
- **Origine Ricetta (`RECIPE_SOURCE_VALUES`)**: `['llm', 'manual']`.
- **Preferenza Ingrediente (`INGREDIENT_PREF_VALUES`)**: `['like', 'dislike']`.

## Confini controllati dal lint (Feature 10)

Fino alla Feature 9 le regole di confine di `CLAUDE.md` valevano solo per attenzione di chi scrive e di chi rivede. Dalla Feature 10 due di esse sono regole di ESLint, in `eslint.config.mjs` (blocchi `files` con `no-restricted-imports`, fino al 2026-10-27 `overrides` di `.eslintrc.json`; review architetturale R5 della Feature 10):

| File | Import vietati | Messaggio |
|---|---|---|
| `lib/domain/**/*.ts` | `@/lib/db`, `@/lib/db/*`, `@/lib/llm`, `@/lib/llm/*` | `Il dominio non importa DB né LLM.` |
| `lib/recipes/pack/**/*.ts` tranne `load.ts` | `@/lib/db`, `@/lib/db/*` | `Gli strumenti del pacchetto non aprono il DB (Feature 10, req. P7).` |

La prima era già rispettata e non ha richiesto modifiche. La seconda impedisce che uno strumento di `pnpm recipes:pack`, importando anche solo un tipo da `@/lib/db`, apra il pool e lasci il comando appeso ([[recipe-pack-tools]]). Restano scritte ma non controllate le altre regole, per esempio "solo `lib/recipes` chiama `lib/llm/`". Dal 2026-10-27 il lint (`eslint .`) guarda anche `tests/`, `scripts/` e la radice; prima `next lint` li saltava ([[e6-deploy]]).

## Il Singleton Household

In versione v1, Mealy opera in modalità single-user/single-household, pur adottando uno schema DB con foreign key su `household_id` per non precludere future espansioni multi-utente o multi-dispositivo.

In `lib/domain/types.ts` è definito il singleton standard:
- Costante ID: `DEFAULT_HOUSEHOLD_ID = '00000000-0000-0000-0000-000000000001'`
- Impostazioni base: 2 persone, pasti pranzo e cena, tag `['veloce', 'salutare']`, elettrodomestici `['fornelli', 'forno', 'microonde', 'friggitrice-ad-aria']`.

I repository e le Server Actions fanno riferimento a questa costante quando operano in assenza di autenticazione session-based.

## Vedi anche

- [[domain-types]] — Schemi e tipi dettagliati esportati da `lib/domain/types.ts`
- [[database-schema]] — Corrispondenza delle entità nelle tabelle Drizzle
- [[household-repo]] — Gestione della persistenza del singleton household
- [[e0-fondamenta]] — Panoramica della Feature 1
- [[diet-rules]] — Regole pure aggiunte a `lib/domain/` dalla Feature 10
