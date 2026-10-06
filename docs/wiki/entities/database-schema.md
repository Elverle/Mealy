---
title: Schema del Database Relazionale Drizzle (db/schema)
type: entity
created: 2026-09-15
updated: 2026-10-05
tags: [database, schema, drizzle, tables, relations, postgresql, migrations, onboarding, meal-plans, ingredient-prefs]
---

## File e Responsabilità

- **Percorso file**: `lib/db/schema.ts`
- **Scopo**: Definizione delle 10 tabelle relazionali (9 fino alla Feature 4; la decima, `ingredient_prefs`, è della Feature 5), delle relazioni Drizzle ORM, delle chiavi primarie/esterne, delle regole di cascata e degli indici ad alte prestazioni per PostgreSQL 16.

## Mappa delle Tabelle

```
+----------------+        +-------------------+        +----------------------+
|   households   |<-------|      recipes      |<-------|  recipe_ingredients  |
+----------------+   1:N  +-------------------+   1:N  +----------------------+
        |                           | 1:1
        | 1:N                       v
        |                 +-------------------+
        |                 |   recipe_prefs    |
        v                 +-------------------+
+----------------+                  |
|   meal_plans   |                  | 1:N
+----------------+                  v
  | 1:N        | 1:1      +-------------------+
  v            v          |    plan_slots     |
+------------+ +---------------+ +-------------+
| plan_slots | |shopping_lists |
+------------+ +---------------+
                      | 1:N
                      v
               +---------------+
               |shopping_items |
               +---------------+

+----------------------+
|  ingredient_aliases  |
+----------------------+

+----------------+        +----------------------+
|   households   |<-------|   ingredient_prefs   |   (Feature 5)
+----------------+   1:N  +----------------------+
```

## Dettaglio Tabelle e Indici

### 1. `households`
Anagrafica dei nuclei domestici (in v1 contiene il record singleton standard).
- **Colonne**:
  - `id`: `uuid` default `gen_random_uuid()` PK — **Nota v1**: l'applicazione impone un `DEFAULT_HOUSEHOLD_ID` hardcoded (`00000000-0000-0000-0000-000000000001`) definito in `lib/domain/types.ts`. Il default DB viene ignorato in v1 (pattern singleton); sarà utile quando si supporteranno più nuclei.
  - `persons`: `integer` not null
  - `meals`: `text[]` array not null
  - `diet_tags`: `text[]` array default `[]`
  - `meal_style_tags`: `text[]` array default `[]`
  - `appliances`: `text[]` array default `[]`
  - `onboarded_at`: `timestamp with time zone` **nullable**, senza default (Feature 3, migrazione `0002`) — istante di completamento del wizard di primo avvio; `null` = onboarding da fare. È il segnale letto dalla guardia di onboarding ([[onboarding-guard]]), necessario perché l'household di default esiste già prima del primo avvio.
  - `created_at`: `timestamp with time zone` default now
  - `updated_at`: `timestamp with time zone` default now — dalla Feature 3 aggiornato da `updateHousehold` con `now()` del DB solo quando i vincoli cambiano davvero o l'onboarding si completa (contratto U1, v. [[household-repo]])

### 2. `recipes`
Libreria permanente delle ricette.
- **Colonne**:
  - `id`: `uuid` PK
  - `household_id`: `uuid` references `households.id` (`ON DELETE CASCADE`)
  - `title`: `text` not null
  - `slug`: `text` not null unique
  - `description`: `text` not null default `''`
  - `steps`: `jsonb` array di stringhe
  - `meal_types`: `text[]` array not null
  - `tags`: `text[]` array default `[]`
  - `diet_flags`: `text[]` array default `[]`
  - `appliances_required`: `text[]` array default `[]`
  - `servings_base`: `integer` not null
  - `prep_minutes`: `integer` not null
  - `kcal_est`: `integer` nullable
  - `macros_est`: `jsonb` nullable
  - `source`: `text` not null default `'manual'`
  - `created_at`: `timestamp with time zone` default now
- **Indici**:
  - `recipes_household_id_idx`: B-tree su `household_id`
  - `recipes_tags_idx`: `GIN` su `tags` (per ricerca con array overlap)
  - `recipes_diet_flags_idx`: `GIN` su `diet_flags`
  - `recipes_title_trgm_idx`: `GIN` su `title` con classe operatori `gin_trgm_ops` (estensione `pg_trgm` per fuzzy search)

### 3. `recipe_ingredients`
Ingredienti associati a ciascuna ricetta normalizzati alla fonte.
- **Colonne**:
  - `id`: `uuid` PK
  - `recipe_id`: `uuid` references `recipes.id` (`ON DELETE CASCADE`)
  - `canonical_name`: `text` not null (forma singolare minuscola)
  - `display_name`: `text` not null
  - `qty`: `numeric` nullable
  - `unit`: `text` not null (`g`, `ml`, `pz`, `qb`)
  - `category`: `text` not null (reparto)
  - `note`: `text` nullable
- **Indici**:
  - `recipe_ingredients_recipe_id_idx` su `recipe_id`
  - `recipe_ingredients_canonical_name_idx` su `canonical_name`

### 4. `recipe_prefs`
Preferenze, gradimento e metriche d'uso (relazione 1:1 con la ricetta).
- **Colonne**:
  - `recipe_id`: `uuid` PK references `recipes.id` (`ON DELETE CASCADE`)
  - `rating`: `integer` (1–5) nullable
  - `favorite`: `boolean` not null default `false`
  - `blocked`: `boolean` not null default `false`
  - `times_used`: `integer` not null default `0` — dalla Feature 4 incrementato di 1 per ricetta alla conferma del piano e dallo swap su un piano confermato
  - `last_used_at`: `timestamp with time zone` nullable — dalla Feature 4 è il **giorno del pasto** (mezzogiorno UTC dello slot più recente), non l'istante della conferma; non arretra mai ([[plan-repo]] `incrementRecipeUsage`)

### 5. `meal_plans`
Piani settimanali generati o archiviati.
- **Colonne**:
  - `id`: `uuid` PK
  - `household_id`: `uuid` references `households.id` (`ON DELETE CASCADE`)
  - `week_start`: `date` not null (data del lunedì di riferimento)
  - `status`: `text` not null default `'draft'` (`draft | active | archived`) — `draft` alla creazione, `active` alla conferma, `archived` quando si crea il piano di una settimana successiva e la sua settimana è già conclusa ([[plan-service]])
  - `created_at`: `timestamp with time zone` default now
  - `generated_at`: `timestamp with time zone` not null default now (Feature 4, migrazione `0003`) — ultima (ri)generazione, aggiornata con `now()` del DB a ogni rigenerazione o *Ripeti* su bozza. Il piano è **superato** se `households.updated_at > generated_at` (contratto U1 della Feature 3, prima riferito a `created_at`).
- **Indici**:
  - `meal_plans_household_week_idx`: indice UNIQUE composto `(household_id, week_start)`

### 6. `plan_slots`
Singoli slot pasto all'interno di una settimana.
- **Colonne**:
  - `id`: `uuid` PK
  - `plan_id`: `uuid` references `meal_plans.id` (`ON DELETE CASCADE`)
  - `day`: `date` not null
  - `meal`: `text` not null (`pranzo | cena`)
  - `recipe_id`: `uuid` references `recipes.id` (`ON DELETE SET NULL`)
  - `servings`: `integer` not null
  - `locked`: `boolean` not null default `false`
- **Indici**:
  - `plan_slots_plan_day_meal_idx`: indice UNIQUE composto `(plan_id, day, meal)`

### 7. `shopping_lists`
Contenitore della lista della spesa generata da un piano.
- **Colonne**:
  - `id`: `uuid` PK
  - `plan_id`: `uuid` unique references `meal_plans.id` (`ON DELETE CASCADE`)
  - `generated_at`: `timestamp with time zone` default now
  - `needs_regeneration`: `boolean` not null default `false` (Feature 4, migrazione `0003`) — flag "lista da rigenerare": messo a `true` da swap, rigenerazione e *Ripeti* su un piano che ha già una lista ([[plan-repo]] `markShoppingListStale`); va rimesso a `false` dalla rigenerazione della lista (Feature 6)

### 8. `shopping_items`
Voci consolidate della spesa raggruppate per corsia.
- **Colonne**:
  - `id`: `uuid` PK
  - `list_id`: `uuid` references `shopping_lists.id` (`ON DELETE CASCADE`)
  - `canonical_name`: `text` not null
  - `qty`: `numeric` nullable
  - `unit`: `text` nullable
  - `category`: `text` not null
  - `checked`: `boolean` not null default `false`
  - `manual`: `boolean` not null default `false`
  - `recipe_ids`: `uuid[]` array not null (tracciabilità ricette d'origine)
- **Indici**:
  - `shopping_items_list_category_idx` su `(list_id, category)` per raggruppamento rapido

### 9. `ingredient_aliases`
Tabella di mappatura sinonimi ("pelati" -> "pomodori pelati").
- **Colonne**:
  - `alias`: `text` PK
  - `canonical_name`: `text` not null
- Alla Feature 5 la tabella è popolata dal seed ma **non è letta da nessun codice applicativo**: né le preferenze ingrediente né il planner risolvono gli alias. Il suo uso è rinviato al consolidamento della lista della spesa (Feature 6).

### 10. `ingredient_prefs` (Feature 5)
Giudizi dell'household sui singoli ingredienti. Popolata in modo *lazy*: una riga esiste solo per gli ingredienti su cui è stato espresso un giudizio.
- **Colonne**:
  - `household_id`: `uuid` not null references `households.id` (`ON DELETE CASCADE`)
  - `canonical_name`: `text` not null — nome canonico già normalizzato con `normalizeCanonicalName` (lo normalizza chi scrive, v. [[prefs-service]])
  - `pref`: `text` not null (`like | dislike`)
  - `created_at`: `timestamp with time zone` not null default now — resta quello del primo inserimento anche se il giudizio cambia
- **Chiave primaria**: composta `(household_id, canonical_name)` (vincolo `ingredient_prefs_household_id_canonical_name_pk`). `ARCHITECTURE §4.2` prevedeva in origine il solo `canonical_name`: la chiave per household (requirements P2 della Feature 5) segue le ricette, che sono già per household, e tiene isolati i test DB che girano in parallelo; `ARCHITECTURE.md` e `BACKLOG.md` sono stati allineati.
- Nessun indice oltre alla chiave primaria, nessun vincolo `CHECK` su `pref` (nessuna tabella ne ha: i valori sono validati da Zod in lettura) e nessuna relazione Drizzle dichiarata, come per `ingredient_aliases`.
- Il nome si confronta per uguaglianza esatta con `recipe_ingredients.canonical_name` normalizzato; non c'è una chiave esterna verso gli ingredienti, quindi può esistere un giudizio su un nome che nessuna ricetta contiene.
- Letture e scritture in [[ingredient-pref-repo]].

Sulla tabella `recipe_prefs` la Feature 5 non cambia lo schema: `rating`, `favorite` e `blocked` diventano scrivibili dall'utente tramite `writeRecipePref` ([[recipe-repo]]).

## Migrazioni Versionate

File SQL in `lib/db/migrations/` generati da `pnpm db:generate` (drizzle-kit) e applicati con `pnpm db:migrate`; snapshot e journal in `lib/db/migrations/meta/`.

| Indice | Tag | Contenuto |
|---|---|---|
| `0000` | `0000_init_schema` | Estensione `pg_trgm`, le 9 tabelle e i relativi indici (Feature 1) |
| `0001` | `0001_unknown_wolf_cub` | DROP e CREATE degli stessi 9 indici (con metodo esplicito `btree`/`gin`); nessuna modifica alle colonne |
| `0002` | `0002_add_household_onboarded_at` | Solo `ALTER TABLE "households" ADD COLUMN "onboarded_at" timestamp with time zone;` (Feature 3). Le righe esistenti ricevono `null`. |
| `0003` | `0003_add_plan_generation_tracking` | Due `ALTER TABLE … ADD COLUMN` (Feature 4): `meal_plans.generated_at timestamp with time zone DEFAULT now() NOT NULL` e `shopping_lists.needs_regeneration boolean DEFAULT false NOT NULL`. Additiva: i piani esistenti ricevono `generated_at` = istante della migrazione. |
| `0004` | `0004_add_ingredient_prefs` | `CREATE TABLE "ingredient_prefs"` con le 4 colonne e la chiave primaria `("household_id","canonical_name")`, più la chiave esterna verso `households` con `ON DELETE cascade` (Feature 5). Additiva: nessuna modifica alle altre tabelle. |

## Vedi anche

- [[database-architecture]] — Architettura del database relazionale, pg_trgm e migrazioni
- [[domain-types]] — Tipi Zod corrispondenti alle tabelle
- [[recipe-repo]] — Operazioni di inserimento e join con Drizzle
- [[household-repo]] — Operazioni su `households`
- [[onboarding-guard]] — Uso di `households.onboarded_at`
- [[e5-impostazioni]] — Panoramica della Feature 3
- [[plan-repo]] — Operazioni su `meal_plans`, `plan_slots`, `recipe_prefs` (uso) e `shopping_lists` (flag)
- [[e3-pianificatore]] — Panoramica della Feature 4
- [[ingredient-pref-repo]] — Operazioni su `ingredient_prefs`
- [[e2-libreria-preferenze]] — Panoramica della Feature 5
