---
title: Schema del Database Relazionale Drizzle (db/schema)
type: entity
created: 2026-09-15
updated: 2026-10-27
tags: [database, schema, drizzle, tables, relations, postgresql, migrations, onboarding, meal-plans, ingredient-prefs, shopping-list, courses, compositions]
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
  - `meal_style_tags`: `text[]` array default `[]` — dalla Feature 11 senza `piatto-unico` (migrazione `0006`)
  - `meal_compositions`: `jsonb` not null (Feature 11, migrazione `0007`), default `{"pranzo": [le cinque composizioni], "cena": [le cinque composizioni]}` — composizioni ammesse per pasto ([[compositions]]). In Drizzle è `jsonb(...).$type<Record<string, string[]>>()`: il tipo vero lo dà `MealCompositionsSchema` alla lettura (`HouseholdSchema`) e alla scrittura (`HouseholdSettingsSchema`) ([[domain-types]])
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
  - `courses`: `text[]` not null default `ARRAY[]::text[]` (Feature 8, migrazione `0005`) — portate della ricetta tra `piatto-unico`, `primo`, `secondo`, `contorno`; vuoto = ricetta **non classificata** ([[courses]]). Nessun indice: il filtro della Libreria lavora in memoria. Le ricette senza portata si trovano con `cardinality(courses) = 0` ([[recipe-repo]])
  - `tags`: `text[]` array default `[]` — dalla Feature 8 dodici valori possibili, tra cui `pochi-ingredienti`, calcolato per regola; dalla Feature 11 undici, senza `piatto-unico` (migrazione `0006`)
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
  - `course`: `text` not null (Feature 11, migrazione `0007`) — portata del piatto nel pasto (`piatto-unico | primo | secondo | contorno`). Dalla Feature 11 uno slot è un **piatto**: il pasto è il gruppo di slot con lo stesso `(plan_id, day, meal)`, e la sua composizione si ricava dalle portate ([[compositions]])
  - `recipe_id`: `uuid` references `recipes.id` (`ON DELETE SET NULL`)
  - `servings`: `integer` not null
  - `locked`: `boolean` not null default `false` — dalla Feature 11 il blocco vale per il pasto: il servizio scrive lo stesso valore su tutti i suoi slot ([[plan-repo]], `setMealLocked`)
- **Indici**:
  - `plan_slots_plan_day_meal_idx`: indice UNIQUE composto `(plan_id, day, meal)`
  - **Dalla Feature 11** quell'indice non c'è più: lo sostituisce `plan_slots_plan_day_meal_side_idx`, UNIQUE su `(plan_id, day, meal, (course = 'contorno'))`. L'espressione booleana separa principale e contorno, quindi un pasto ha al più un principale e un contorno (spec D3, requirements P7). È l'ultima difesa contro un doppio «+ Contorno» concorrente. In `schema.ts` l'espressione è un `sql` dentro `uniqueIndex(...).on(...)`, come per `recipes_title_trgm_idx`; la via d'uscita con due indici parziali prevista dalla review (R4) non è servita

### 7. `shopping_lists`
Contenitore della lista della spesa generata da un piano.
- **Colonne**:
  - `id`: `uuid` PK
  - `plan_id`: `uuid` unique references `meal_plans.id` (`ON DELETE CASCADE`)
  - `generated_at`: `timestamp with time zone` default now
  - `needs_regeneration`: `boolean` not null default `false` (Feature 4, migrazione `0003`) — flag "lista da rigenerare": messo a `true` da swap, rigenerazione e *Ripeti* su un piano che ha già una lista ([[plan-repo]] `markShoppingListStale`); va rimesso a `false` dalla rigenerazione della lista (Feature 6)
- **Uso dalla Feature 6**: la lista nasce solo per un piano confermato e non chiuso, creata da `buildPlanShoppingList` ([[shopping-service]]). A ogni creazione o aggiornamento `markShoppingListGenerated` ([[shopping-repo]]) scrive `generated_at = now()` del DB e rimette `needs_regeneration` a `false`. Nessuna colonna nuova.

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
- **Significato delle colonne dalla Feature 6** (schema invariato, v. [[shopping-list]] e [[shopping-service]]):
  - articolo **generato** dal piano (`manual = false`): `unit` è una delle quattro unità (`g`, `ml`, `pz`, `qb`), `qty` è `null` solo per `qb`, `recipe_ids` elenca le ricette per cui serve. La coppia `(canonical_name, unit)` è la chiave con cui un aggiornamento della lista ritrova la riga e ne conserva l'`id`;
  - articolo **aggiunto a mano** (`manual = true`): `unit` e `qty` sono `null` e `recipe_ids` è vuoto;
  - `canonical_name` è normalizzato; negli articoli generati gli alias sono già risolti;
  - `qty` è `numeric`: il driver la restituisce come stringa e [[shopping-repo]] la converte in numero;
  - non c'è un vincolo di unicità su `(list_id, canonical_name, unit)`: l'unicità dei generati è garantita dalla costruzione sotto il lock dei piani, quella degli articoli a mano dalla ricerca e dall'inserimento sotto lo stesso lock.

### 9. `ingredient_aliases`
Tabella di mappatura sinonimi ("pelati" -> "pomodori pelati").
- **Colonne**:
  - `alias`: `text` PK
  - `canonical_name`: `text` not null
- Alla Feature 5 la tabella è popolata dal seed ma **non è letta da nessun codice applicativo**: né le preferenze ingrediente né il planner risolvono gli alias. Il suo uso è rinviato al consolidamento della lista della spesa (Feature 6).
- **Dalla Feature 6** la tabella è letta da `listIngredientAliases` ([[shopping-repo]]), chiamata dal servizio della lista della spesa: gli alias si risolvono nella costruzione della lista e nella deduzione del reparto di un articolo a mano, e solo lì. La tabella è **globale** (non per household) e si popola con `pnpm db:seed` in sviluppo e con `pnpm db:seed:aliases` in produzione ([[fixtures-and-seed]]).
- **Dalla Feature 7** la frase sulla produzione qui sopra è superata: sul Raspberry non gira nessun comando `pnpm` e la tabella la popola l'app all'avvio, dopo le migrazioni ([[db-bootstrap]]). Il caricamento è un upsert sulla chiave `alias`: inserisce le voci nuove di `fixtures/ingredient-aliases.json`, corregge il `canonical_name` di quelle cambiate e non cancella quelle tolte dal file ([[fixtures-and-seed]]). `pnpm db:seed:aliases` fa la stessa cosa in sviluppo.

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
| `0005` | `0005_add_recipe_courses` | Colonna `recipes.courses` e `UPDATE` della regola "pochi ingredienti" sulle etichette esistenti (Feature 8; dettagli più sotto). La prima migrazione che cambia dati oltre allo schema |
| `0006` | `0006_remove_piatto_unico_tag` | Solo due `UPDATE` con `array_remove(…, 'piatto-unico')` su `households.meal_style_tags` e `recipes.tags` (Feature 11; dettagli più sotto) |
| `0007` | `0007_add_meal_compositions` | Colonne `households.meal_compositions` e `plan_slots.course`, portata degli slot esistenti, indice unico nuovo al posto di `plan_slots_plan_day_meal_idx` (Feature 11; dettagli più sotto) |

La Feature 6 (lista della spesa) **non aggiunge migrazioni**: usa `shopping_lists` e `shopping_items` così come sono dalla migrazione `0000`, con la colonna `needs_regeneration` della `0003` (requirements P2 della Feature 6).

La Feature 7 (deploy) **non aggiunge migrazioni** e non tocca `lib/db/schema.ts`. Cambia chi le applica in produzione: non `pnpm db:migrate`, ma l'app all'avvio con il migratore di `drizzle-orm`, sulla stessa tabella `drizzle.__drizzle_migrations` ([[db-bootstrap]]). Tre conseguenze per chi aggiunge una migrazione:
- la cartella `lib/db/migrations/` viene copiata nell'immagine di produzione ([[production-stack]]) e la migrazione nuova si applica da sola al deploy successivo;
- **una migrazione già arrivata su `main` non si modifica**: il migratore applica solo le voci del journal con un orario (`when`) successivo all'ultima applicata, e non si accorge di un file cambiato. `tests/db/bootstrap.test.ts` controlla che le voci del journal siano in ordine strettamente crescente e corrispondano una a una ai file `.sql`;
- una migrazione non torna indietro: prima di avviare un'immagine diversa `scripts/deploy.sh` scrive un dump `predeploy` ([[deploy-scripts]]).

### `0005_add_recipe_courses` (Feature 8)

Due istruzioni:

1. `ALTER TABLE "recipes" ADD COLUMN "courses" text[] DEFAULT ARRAY[]::text[] NOT NULL`: tutte le ricette esistenti diventano non classificate. Le classifica poi il modello, all'avvio dell'app in produzione ([[recipe-classification]]).
2. Un `UPDATE` di `recipes.tags` che applica alle ricette esistenti la regola "pochi ingredienti": aggiunge `pochi-ingredienti` in coda (`array_append`, se manca) alle ricette con al massimo 6 righe di `recipe_ingredients` con `unit <> 'qb'`, e lo toglie (`array_remove`) alle altre. Nessun'altra etichetta cambia. In SQL l'etichetta va in coda e non nell'ordine di `MEAL_STYLE_TAG_VALUES` che usa `deriveStyleTags`: l'ordine nel DB non ha effetti, e la classificazione riscrive comunque le etichette in ordine (requirements P6 della Feature 8).

È idempotente rispetto alla regola: ripetere l'`UPDATE` non cambia nulla. `tests/db/recipe-courses-migration.test.ts` la prova su un database usa-e-getta migrato fino alla `0004` (journal filtrato a `idx < 5`, come in `tests/db/bootstrap.test.ts`): colonna non nulla e vuota per ogni ricetta, `pochi-ingredienti` secondo la regola, nessun'altra etichetta toccata, seconda esecuzione senza effetti.

**Non si torna indietro senza il dump**: dopo questa migrazione, e dopo la classificazione, le ricette contengono etichette e portate che le versioni precedenti alla 0.8 non conoscono. La loro lettura con lo schema Zod fallirebbe e la Libreria non si aprirebbe. `docs/DEPLOY.md §6` chiede di ripristinare sempre il dump `predeploy` (innesto R3 della review architetturale della Feature 8).

### `0006_remove_piatto_unico_tag` e `0007_add_meal_compositions` (Feature 11)

Due migrazioni invece di una (requirements P2 della Feature 11): togliere `piatto-unico` da `MEAL_STYLE_TAG_VALUES` fa fallire la lettura di ogni riga che lo contiene (`toRecipeWithDetails`, `HouseholdSchema.parse`), quindi la pulizia dei dati è arrivata nello stesso work package che cambia l'enum (WP1); le colonne nuove servono solo dal WP2.

`0006` sono due `UPDATE` con `array_remove`: l'etichetta esce da `households.meal_style_tags` e da `recipes.tags`, le altre restano. È idempotente. `tests/db/piatto-unico-tag-migration.test.ts` la prova su un database usa-e-getta migrato fino alla `0005` (journal filtrato a `idx < 6`).

`0007`, nell'ordine:
1. `households.meal_compositions jsonb NOT NULL` con il default di tutte e cinque le composizioni: anche l'household esistente le riceve tutte (spec D4).
2. `plan_slots.course text`, ancora nullable.
3. Un `UPDATE` che dà a ogni slot esistente la portata del principale ricavata dalla ricetta: la prima tra `piatto-unico`, `primo` e `secondo` che la ricetta ha, altrimenti `piatto-unico` (ricetta non classificata, solo contorno o eliminata). È la stessa regola di `mainCourseOf` ([[compositions]]). Nessun piano esistente riceve contorni (spec D8): restano piani a un piatto per pasto, e li ricompone solo *Rigenera*.
4. `course` diventa `NOT NULL`.
5. `DROP INDEX plan_slots_plan_day_meal_idx` e `CREATE UNIQUE INDEX plan_slots_plan_day_meal_side_idx` sull'espressione.

`tests/db/meal-compositions-migration.test.ts` la prova allo stesso modo (journal filtrato a `idx < 7`): portata attesa per ogni slot (principale in ordine canonico, `piatto-unico` per una non classificata o mancante), composizioni di default su ogni household, secondo principale e secondo contorno nello stesso pasto rifiutati dall'indice, contorno accanto al principale accettato.

**Non si torna indietro senza il dump**, come dalla 0.8: le versioni precedenti alla 0.10 non scrivono `plan_slots.course` (`NOT NULL` senza default) e leggerebbero due slot per lo stesso pasto. `docs/DEPLOY.md §6` lo dice per la 0.10.

Nel journal il `when` della migrazione `0000` è `1700000000000`, un valore scritto a mano (osservazione della review architetturale della Feature 7): l'ordine attuale è comunque crescente e il test lo conferma.

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
- [[shopping-repo]] — Operazioni su `shopping_lists`, `shopping_items` e lettura di `ingredient_aliases`
- [[e4-lista-spesa]] — Panoramica della Feature 6
- [[db-bootstrap]] — Migrazioni e alias applicati all'avvio in produzione (Feature 7)
- [[e6-deploy]] — Panoramica della Feature 7
- [[courses]] — Significato di `recipes.courses` e regole derivate (Feature 8)
- [[f8-portate-etichette]] — Panoramica della Feature 8
- [[compositions]] — Significato di `plan_slots.course` e `households.meal_compositions` (Feature 11)
- [[f11-composizione-pasto]] — Panoramica della Feature 11
