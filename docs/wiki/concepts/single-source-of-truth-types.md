---
title: Single Source of Truth dei Tipi di Dominio
type: concept
created: 2026-09-15
updated: 2026-09-15
tags: [domain, zod, types, contracts, single-source-of-truth]
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
