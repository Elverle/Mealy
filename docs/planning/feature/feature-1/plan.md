# Feature 1 — E0 Fondamenta: Piano di Implementazione

Questo documento contiene il piano di lavoro dettagliato per la **Feature 1 (E0 Fondamenta)** di Mealy. Il piano è strutturato in **Work Package (WP)** auto-consistenti per l'esecuzione orchestrata da sub-agenti `implementer` isolati.

---

## 1. Decisioni Fissate e Convenzioni Condivise

Tutte le decisioni derivano dai requisiti e dall'analisi svolta in Phase B (memorizzate in [`requirements.md`](requirements.md)):

1. **Stack & Versioni**:
   - Next.js 16 (o `next@latest`), React 19, TypeScript strict mode, App Router.
   - Tailwind CSS v4 con configurazione token tramite `@theme` in `app/globals.css`.
   - shadcn/ui per i componenti accessibili.
   - Vitest con `@testing-library/react` per test unitari e di componenti senza rete.
   - Drizzle ORM + `drizzle-kit` con PostgreSQL 16 locale (`docker-compose.dev.yml`).
2. **Layout Struttura File**:
   - Root pulita senza cartella `src/` (`--no-src-dir`).
   - Import alias: `@/*` mappato su `./*`.
   - Moduli principali: `app/`, `components/`, `lib/domain/`, `lib/db/`, `lib/llm/`, `fixtures/`.
3. **Single Source of Truth dei Tipi**:
   - `lib/domain/types.ts` contiene tutti gli schemi Zod e i tipi TypeScript inferiti. Nessun modulo o feature successiva ridefinisce tipi di dominio localmente.
4. **Liste Chiuse degli Enum**:
   - Unità di misura (`UNIT_ENUM`): `['g', 'ml', 'pz', 'qb']`
   - Categorie reparti spesa (`CATEGORY_ENUM`): `['ortofrutta', 'pane', 'macelleria', 'pescheria', 'banco-frigo', 'dispensa', 'surgelati', 'bevande', 'altro']`
   - Pasti (`MEAL_TYPE_ENUM`): `['pranzo', 'cena']`
   - Esigenze alimentari (`DIET_FLAG_ENUM`): `['vegetariano', 'vegano', 'senza-glutine', 'senza-lattosio', 'pescetariano']`
   - Tag stile pasto (`MEAL_STYLE_TAG_ENUM`): `['veloce', 'salutare', 'proteico', 'leggero', 'comfort-food', 'economico', 'piatto-unico']`
   - Elettrodomestici (`APPLIANCE_ENUM`): `['fornelli', 'forno', 'microonde', 'friggitrice-ad-aria', 'frullatore']`
   - Stato piano (`PLAN_STATUS_ENUM`): `['draft', 'active', 'archived']`
   - Origine ricetta (`RECIPE_SOURCE_ENUM`): `['llm', 'manual']`
   - Preferenza ingrediente (`INGREDIENT_PREF_ENUM`): `['like', 'dislike']`
5. **Singleton Household di Default**:
   - UUID fisso: `'00000000-0000-0000-0000-000000000001'`
   - Persone: `2`
   - Pasti: `['pranzo', 'cena']`
   - Esigenze (`diet_tags`): `[]`
   - Stili (`meal_style_tags`): `['veloce', 'salutare']`
   - Elettrodomestici: `['fornelli', 'forno', 'microonde', 'friggitrice-ad-aria']`
6. **Regole di Disgiunzione File per i WP Paralleli (Wave 2)**:
   - `WP2 (S0.2)` opera esclusivamente su `lib/db/`, `lib/domain/types.ts`, `drizzle.config.ts`, `docker-compose.dev.yml`, `tests/db/`.
   - `WP3 (S0.3)` opera esclusivamente su `app/`, `components/`, `tests/ui/` e utilizza mock data locali hardcoded (NON importa `lib/domain/types.ts` né `lib/db/`).

---

## 2. Work Packages

### Wave 1 (Solitaria)

---

#### WP1 — S0.1: Scaffold del progetto e design token

- **Obiettivo in una frase**: Inizializzare lo scaffold Next.js 16 con App Router, TypeScript, Tailwind CSS v4, shadcn/ui, Vitest e i design token di `DESIGN.md`, garantendo la stabilità della baseline per le wave successive.
- **File da creare o modificare**:
  - `package.json` — dipendenze e script unificati (`dev`, `build`, `lint`, `test`, `db:*`)
  - `tsconfig.json` — configurazione strict TypeScript con paths `@/*` -> `./*`
  - `next.config.ts` — configurazione Next.js
  - `postcss.config.mjs` — plugin PostCSS per Tailwind CSS v4 (`@tailwindcss/postcss`)
  - `components.json` — configurazione shadcn/ui (style new-york/default, CSS in `app/globals.css`, aliases `@/*`)
  - `app/globals.css` — configurazione tema Tailwind v4 (`@theme`), token palette Mealy (`paper`, `ink`, `basil`, `tomato`, `saffron`, `stone`), font display/sans e variabili shadcn
  - `app/layout.tsx` — root layout con caricamento font Google `Fraunces` e `Figtree` via `next/font/google`, variabili CSS font e sfondo `bg-paper text-ink`
  - `app/page.tsx` — minimal landing page di verifica rendering e token colore/font
  - `vitest.config.ts` — configurazione test runner Vitest con ambiente `jsdom` e alias `@/*`
  - `vitest.setup.ts` — setup file per Vitest e `@testing-library/jest-dom`
  - `tests/smoke.test.ts` — test di verifica base Vitest
  - `.env.example` — template variabili d'ambiente di sviluppo
  - `.gitignore` — integrazione esclusioni standard (`node_modules`, `.next`, `.env*.local`, `coverage`, ecc.)
- **Riferimenti a pattern e convenzioni di progetto**:
  - `docs/DESIGN.md §2`: palette colori (`paper: #FAF7F2`, `ink: #26221B`, `basil: #3E6B4F`, `tomato: #C4482F`, `saffron: #E0A83C`, `stone: #8A8377`), font `Fraunces` e `Figtree`.
  - `CLAUDE.md § Comandi`: script `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm build`.
- **Passi dettagliati di implementazione**:
  1. Eseguire l'inizializzazione non interattiva di Next.js tramite comando (es. `pnpm create next-app@latest . --typescript --eslint --tailwind --no-src-dir --app --import-alias "@/*" --use-pnpm`). **Attenzione**: la cartella contiene già file e cartelle preesistenti (`.git`, `docs/`, `CLAUDE.md`, `.claude/`); non cancellarli né sovrascrivere `docs/` o `CLAUDE.md`.
  2. Verificare e aggiornare le dipendenze in `package.json`:
     - Dipendenze di sviluppo: `vitest`, `@vitejs/plugin-react`, `vite-tsconfig-paths`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`.
     - Dipendenze shadcn / styling: `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, `tw-colors` o dirette variabili CSS Tailwind v4.
  3. Configurare `vitest.config.ts` specificando:
     - `plugins: [tsconfigPaths(), react()]`
     - `test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], globals: true }`
  4. Configurare `vitest.setup.ts` con `import '@testing-library/jest-dom/vitest';`.
  5. Configurare `components.json` per shadcn/ui:
     ```json
     {
       "$schema": "https://ui.shadcn.com/schema.json",
       "style": "default",
       "rsc": true,
       "tsx": true,
       "tailwind": {
         "config": "",
         "css": "app/globals.css",
         "baseColor": "stone",
         "cssVariables": true
       },
       "aliases": {
         "components": "@/components",
         "utils": "@/lib/utils",
         "ui": "@/components/ui",
         "lib": "@/lib",
         "hooks": "@/hooks"
       }
     }
     ```
  6. Creare `lib/utils.ts` con la funzione helper `cn(...inputs: ClassValue[])`.
  7. In `app/globals.css`, integrare Tailwind v4 e i token di design:
     ```css
     @import "tailwindcss";

     @theme {
       --color-paper: #FAF7F2;
       --color-ink: #26221B;
       --color-basil: #3E6B4F;
       --color-tomato: #C4482F;
       --color-saffron: #E0A83C;
       --color-stone: #8A8377;

       --font-display: var(--font-fraunces), serif;
       --font-sans: var(--font-figtree), sans-serif;
     }

     :root {
       --background: #FAF7F2;
       --foreground: #26221B;
       --primary: #3E6B4F;
       --primary-foreground: #FAF7F2;
       --destructive: #C4482F;
       --destructive-foreground: #FAF7F2;
       --muted: #FAF7F2;
       --muted-foreground: #8A8377;
       --border: rgba(138, 131, 119, 0.2);
       --radius: 0.75rem;
     }

     body {
       background-color: var(--color-paper);
       color: var(--color-ink);
       font-family: var(--font-sans);
       min-height: 100dvh;
     }
     ```
  8. Configurare `app/layout.tsx` importando `Fraunces` e `Figtree` con `variable: '--font-fraunces'` e `variable: '--font-figtree'`, applicandoli a `<html>` o `<body>` con `<body className="${figtree.variable} ${fraunces.variable} antialiased bg-paper text-ink">`.
  9. Creare `.env.example` con:
     ```env
     DATABASE_URL=postgresql://mealy:mealy@localhost:5432/mealy_dev
     LLM_PROVIDER=openrouter
     LLM_MODEL=google/gemini-2.5-flash
     OPENROUTER_API_KEY=
     ```
  10. Configurare in `package.json` gli script canonici:
      ```json
      "scripts": {
        "dev": "next dev",
        "build": "next build",
        "start": "next start",
        "lint": "next lint",
        "test": "vitest run",
        "test:watch": "vitest",
        "db:generate": "drizzle-kit generate",
        "db:migrate": "drizzle-kit migrate",
        "db:push": "drizzle-kit push",
        "db:studio": "drizzle-kit studio",
        "db:seed": "tsx lib/db/seed.ts"
      }
      ```
  11. Creare `tests/smoke.test.ts` con un test di base (`expect(true).toBe(true)` e verifica import di base).
  12. Creare le cartelle vuote con file `.gitkeep` se necessario: `lib/domain/`, `lib/db/`, `lib/llm/`, `fixtures/`, `components/ui/`.
- **Contratti esposti**:
  - Script npm eseguibili: `dev`, `build`, `lint`, `test`.
  - Design tokens accessibili tramite classi Tailwind (`bg-paper`, `text-ink`, `bg-basil`, `text-tomato`, `text-saffron`, `border-stone`, `font-display`, `font-sans`).
  - Helper `cn()` in `lib/utils.ts`.
  - Configurazione Vitest funzionante.
- **Dipendenze**: Nessuna.
- **Criteri di accettazione**:
  - `pnpm test` completa con successo ed è verde.
  - `pnpm lint` passa senza warning né errori bloccanti.
  - `pnpm build` compila l'applicazione con successo.
  - `app/layout.tsx` include le classi dei font e i token colore impostati su `paper` (#FAF7F2) e `ink` (#26221B).
- **Cosa è esplicitamente fuori scope**:
  - Creazione delle tabelle DB o migrazioni (assegnata a WP2).
  - Componenti complessi o shell di navigazione (assegnata a WP3).
  - Chiamate ad API LLM (Feature 2).

---

### Wave 2 (Parallela & File-Disjoint)

---

#### WP2 — S0.2: Schema DB, Tipi di Dominio Zod e Migrazioni

- **Obiettivo in una frase**: Implementare gli schemi Zod e i tipi di dominio in `lib/domain/types.ts`, lo schema Drizzle per PostgreSQL con estensione `pg_trgm`, il file `docker-compose.dev.yml`, le migrazioni generate e il repository tipato base testato con Vitest su Postgres.
- **File da creare o modificare**:
  - `docker-compose.dev.yml` — configurazione PostgreSQL 16 con estensione `pg_trgm` abilitata
  - `drizzle.config.ts` — configurazione Drizzle Kit per schema e cartella migrazioni
  - `lib/domain/types.ts` — single source of truth: schemi Zod e tipi TS per ricette, ingredienti, household, piani, liste spesa ed enum chiusi
  - `lib/db/schema.ts` — definizioni tabelle Drizzle (`households`, `recipes`, `recipe_ingredients`, `recipe_prefs`, `meal_plans`, `plan_slots`, `shopping_lists`, `shopping_items`, `ingredient_aliases`) con indici e FK
  - `lib/db/index.ts` — client Drizzle collegato a Postgres via `postgres.js`
  - `lib/db/migrations/*` — file SQL di migrazione generati da `drizzle-kit generate`
  - `lib/db/repositories/household-repo.ts` — repository tipato per get/create default household
  - `lib/db/repositories/recipe-repo.ts` — repository tipato base per insert ricetta con ingredienti e pref, findById, findBySlug
  - `tests/db/schema.test.ts` — test di integrazione DB: migrazione, insert e select tipate
- **Riferimenti a pattern e convenzioni di progetto**:
  - `docs/ARCHITECTURE.md §4.1 & §4.2`: modelli relazionali completi, campi, indici (`GIN` su tag/diete, trigram su `title`), regole di normalizzazione ingredienti.
  - `docs/planning/feature/feature-1/requirements.md`: elenchi completi degli enum e valori del singleton household.
  - `CLAUDE.md § Regole di architettura`: `lib/domain/types.ts` è la single source of truth.
- **Passi dettagliati di implementazione**:
  1. Creare `docker-compose.dev.yml`:
     ```yaml
     services:
       postgres:
         image: postgres:16-alpine
         container_name: mealy-postgres-dev
         environment:
           POSTGRES_USER: mealy
           POSTGRES_PASSWORD: mealy
           POSTGRES_DB: mealy_dev
         ports:
           - "5432:5432"
         volumes:
           - postgres_dev_data:/var/lib/postgresql/data
           - ./docker/init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro
     volumes:
       postgres_dev_data:
     ```
     Creare `docker/init-db.sql` contenente `CREATE EXTENSION IF NOT EXISTS pg_trgm;`.
  2. Implementare `lib/domain/types.ts`:
     - Definire e esportare le costanti array:
       - `UNIT_VALUES = ['g', 'ml', 'pz', 'qb'] as const`
       - `CATEGORY_VALUES = ['ortofrutta', 'pane', 'macelleria', 'pescheria', 'banco-frigo', 'dispensa', 'surgelati', 'bevande', 'altro'] as const`
       - `MEAL_TYPE_VALUES = ['pranzo', 'cena'] as const`
       - `DIET_FLAG_VALUES = ['vegetariano', 'vegano', 'senza-glutine', 'senza-lattosio', 'pescetariano'] as const`
       - `MEAL_STYLE_TAG_VALUES = ['veloce', 'salutare', 'proteico', 'leggero', 'comfort-food', 'economico', 'piatto-unico'] as const`
       - `APPLIANCE_VALUES = ['fornelli', 'forno', 'microonde', 'friggitrice-ad-aria', 'frullatore'] as const`
       - `PLAN_STATUS_VALUES = ['draft', 'active', 'archived'] as const`
       - `RECIPE_SOURCE_VALUES = ['llm', 'manual'] as const`
       - `INGREDIENT_PREF_VALUES = ['like', 'dislike'] as const`
     - Definire gli schemi Zod enum corrispondenti: `UnitSchema`, `CategorySchema`, `MealTypeSchema`, `DietFlagSchema`, `MealStyleTagSchema`, `ApplianceSchema`, `PlanStatusSchema`, `RecipeSourceSchema`, `IngredientPrefSchema`.
     - Definire gli schemi Zod per le entità:
       - `IngredientSchema`: `canonical_name` (string min 1), `display_name` (string min 1), `qty` (number nullable), `unit` (`UnitSchema`), `category` (`CategorySchema`), `note` (string nullable).
       - `RecipeSchema`: `id` (uuid), `household_id` (uuid), `title` (string min 1), `slug` (string min 1), `description` (string), `steps` (array di stringhe min 1), `meal_types` (array di `MealTypeSchema`), `tags` (array di `MealStyleTagSchema`), `diet_flags` (array di `DietFlagSchema`), `appliances_required` (array di `ApplianceSchema`), `servings_base` (int min 1), `prep_minutes` (int min 1), `kcal_est` (int nullable), `macros_est` (record/object nullable), `source` (`RecipeSourceSchema`), `created_at` (date).
       - `RecipePrefSchema`: `recipe_id` (uuid), `rating` (int 1..5 nullable), `favorite` (boolean default false), `blocked` (boolean default false), `times_used` (int default 0), `last_used_at` (date nullable).
       - `HouseholdSchema`: `id` (uuid), `persons` (int min 1), `meals` (array di `MealTypeSchema`), `diet_tags` (array di `DietFlagSchema`), `meal_style_tags` (array di `MealStyleTagSchema`), `appliances` (array di `ApplianceSchema`), `created_at` (date), `updated_at` (date).
       - `MealPlanSchema`: `id` (uuid), `household_id` (uuid), `week_start` (string YYYY-MM-DD o date), `status` (`PlanStatusSchema`), `created_at` (date).
       - `PlanSlotSchema`: `id` (uuid), `plan_id` (uuid), `day` (date), `meal` (`MealTypeSchema`), `recipe_id` (uuid nullable), `servings` (int), `locked` (boolean default false).
       - `ShoppingListSchema`: `id` (uuid), `plan_id` (uuid), `generated_at` (date).
       - `ShoppingItemSchema`: `id` (uuid), `list_id` (uuid), `canonical_name` (string), `qty` (number nullable), `unit` (string nullable), `category` (`CategorySchema`), `checked` (boolean), `manual` (boolean), `recipe_ids` (array di uuid).
       - `IngredientAliasSchema`: `alias` (string), `canonical_name` (string).
     - Esportare tutti i tipi inferiti: `export type Recipe = z.infer<typeof RecipeSchema>`, ecc.
     - Esportare la costante `DEFAULT_HOUSEHOLD`:
       ```ts
       export const DEFAULT_HOUSEHOLD: Household = {
         id: '00000000-0000-0000-0000-000000000001',
         persons: 2,
         meals: ['pranzo', 'cena'],
         diet_tags: [],
         meal_style_tags: ['veloce', 'salutare'],
         appliances: ['fornelli', 'forno', 'microonde', 'friggitrice-ad-aria'],
         created_at: new Date('2026-01-01T00:00:00Z'),
         updated_at: new Date('2026-01-01T00:00:00Z'),
       };
       ```
  3. Implementare `lib/db/schema.ts` con tabelle Drizzle:
     - Usare `pgTable`, `uuid`, `text`, `integer`, `numeric`, `boolean`, `timestamp`, `date`, `jsonb`, `index`, `uniqueIndex`.
     - Definire le 9 tabelle specificate:
       - `households` (PK uuid defaultRandom, persons integer, meals text[].array(), diet_tags text[].array(), meal_style_tags text[].array(), appliances text[].array(), created_at, updated_at).
       - `recipes` (PK uuid defaultRandom, household_id uuid references households.id, title text, slug text unique, description text, steps jsonb, meal_types text[].array(), tags text[].array(), diet_flags text[].array(), appliances_required text[].array(), servings_base integer, prep_minutes integer, kcal_est integer, macros_est jsonb, source text, created_at).
         - Indici: GIN su `tags`, GIN su `diet_flags`, trigram su `title` (tramite `sql\`USING gin (title gin_trgm_ops)\``).
       - `recipe_ingredients` (PK uuid defaultRandom, recipe_id uuid references recipes.id on delete cascade, canonical_name text, display_name text, qty numeric, unit text, category text, note text).
       - `recipe_prefs` (PK recipe_id uuid references recipes.id on delete cascade, rating integer, favorite boolean default false, blocked boolean default false, times_used integer default 0, last_used_at timestamp with time zone).
       - `meal_plans` (PK uuid defaultRandom, household_id uuid references households.id, week_start date, status text default 'draft', created_at, uniqueIndex su `(household_id, week_start)`).
       - `plan_slots` (PK uuid defaultRandom, plan_id uuid references meal_plans.id on delete cascade, day date, meal text, recipe_id uuid references recipes.id, servings integer, locked boolean default false, uniqueIndex su `(plan_id, day, meal)`).
       - `shopping_lists` (PK uuid defaultRandom, plan_id uuid unique references meal_plans.id on delete cascade, generated_at timestamp).
       - `shopping_items` (PK uuid defaultRandom, list_id uuid references shopping_lists.id on delete cascade, canonical_name text, qty numeric, unit text, category text, checked boolean default false, manual boolean default false, recipe_ids uuid[].array(), index su `(list_id, category)`).
       - `ingredient_aliases` (PK alias text, canonical_name text).
  4. Configurare `drizzle.config.ts`:
     ```ts
     import { defineConfig } from 'drizzle-kit';

     export default defineConfig({
       schema: './lib/db/schema.ts',
       out: './lib/db/migrations',
       dialect: 'postgresql',
       dbCredentials: {
         url: process.env.DATABASE_URL || 'postgresql://mealy:mealy@localhost:5432/mealy_dev',
       },
     });
     ```
  5. Eseguire `pnpm db:generate` per generare la migrazione iniziale in `lib/db/migrations/`.
  6. Implementare `lib/db/index.ts`:
     - Inizializzare connessione `postgres` con pooling o singleton connection (`postgres(process.env.DATABASE_URL)`).
     - Esportare `export const db = drizzle(client, { schema });`.
  7. Implementare `lib/db/repositories/household-repo.ts`:
     - Funzione `getDefaultHousehold(): Promise<Household>`
     - Funzione `ensureDefaultHousehold(): Promise<Household>` (idempotente: inserisce `DEFAULT_HOUSEHOLD` se assente)
     - Funzione `updateHousehold(data: Partial<Household>): Promise<Household>`
  8. Implementare `lib/db/repositories/recipe-repo.ts`:
     - Funzione `insertRecipe(recipeData, ingredientsData, prefData?)`: esecuzione transazionale (`db.transaction`) che inserisce ricetta, ingredienti associati e riga pref di default.
     - Funzione `getRecipeById(id: string)`: join ricetta + ingredienti + pref.
     - Funzione `getRecipeBySlug(slug: string)`.
  9. Creare `tests/db/schema.test.ts`:
     - Connessione al DB locale (o skip condizionale controllato con messaggio esplicito se container Docker non è attivo).
     - Test migrazione / validazione schema.
     - Test creazione e lettura household singleton.
     - Test inserimento transazionale di una ricetta con ingredienti e preferenze, con verifica FK e cascade delete.
- **Contratti esposti**:
  - `lib/domain/types.ts`: tutti gli schemi Zod, i tipi TypeScript e le costanti enum.
  - `lib/db/schema.ts`: tutte le definizioni tabelle Drizzle.
  - `lib/db/index.ts`: client `db`.
  - `lib/db/repositories/household-repo.ts` e `lib/db/repositories/recipe-repo.ts`: API repository per le feature successive.
  - `docker-compose.dev.yml`: configurazione Postgres 16 con `pg_trgm`.
- **Dipendenze**: Richiede il completamento di WP1 (pacchetti e tsconfig configurati). Non tocca e non dipende da WP3.
- **Criteri di accettazione**:
  - `pnpm db:generate` produce file di migrazione SQL validi.
  - `pnpm db:migrate` applica le migrazioni senza errori sul container Postgres locale.
  - I test di `tests/db/schema.test.ts` passano con successo inserendo e leggendo ricetta e household.
  - Nessuna dipendenza circolare o import da `app/` o `components/`.
- **Cosa è esplicitamente fuori scope**:
  - Tabella `ingredient_prefs` (prevista per Feature 5).
  - Componenti React o route UI (gestite in WP3).
  - Seed massivo di ricette (previsto in Feature 2, Story S1.3).

---

#### WP3 — S0.3: UI Kit e Shell di Navigazione

- **Obiettivo in una frase**: Realizzare la shell di navigazione mobile-first con bottom tab bar a 4 tab (`/`, `/lista`, `/libreria`, `/impostazioni`) e i componenti base (`MealCard`, `RecipeSheet`, `ShoppingItemRow`, `ChipFilter`, `EmptyState`) basati su token di `DESIGN.md` e mockup dati locali isolati.
- **File da creare o modificare**:
  - `components/ui/button.tsx` — bottone base shadcn con varianti `default` (basil), `destructive` (tomato), `outline`, `ghost`
  - `components/ui/sheet.tsx` — componente Sheet/Drawer shadcn per pannelli a scorrimento
  - `components/ui/badge.tsx` — chip/badge shadcn
  - `components/ui/card.tsx` — card contenitore con raggio 12px e bordo stone al 20%
  - `components/ui/checkbox.tsx` — checkbox accessibile shadcn (tap target generoso)
  - `components/navigation/bottom-nav.tsx` — tab bar inferiore a 4 voci con icone e stato attivo `basil`
  - `components/cards/meal-card.tsx` — card pasto con titolo Fraunces, chip tag, bottone swap `tomato` e stella `saffron`
  - `components/sheets/recipe-sheet.tsx` — sheet dettaglio ricetta (ingredienti, passi, porzioni, azioni di valutazione)
  - `components/shopping/shopping-item-row.tsx` — riga lista della spesa con tap target ≥ 44px e spunta riga intera
  - `components/filters/chip-filter.tsx` — chip filtro a pillola per tag e diete
  - `components/feedback/empty-state.tsx` — componente stato vuoto con titolo Fraunces, descrizione e CTA
  - `app/layout.tsx` — inclusione layout responsive con `BottomNav` sticky e container principale
  - `app/page.tsx` — vista Tab 1: Piano (mockup card pasto giornaliere e stato vuoto)
  - `app/lista/page.tsx` — vista Tab 2: Lista della spesa (mockup righe reparto spuntabili)
  - `app/libreria/page.tsx` — vista Tab 3: Libreria ricette (mockup griglia e filtri chip)
  - `app/impostazioni/page.tsx` — vista Tab 4: Impostazioni (mockup visuale vincoli)
  - `tests/ui/shell.test.tsx` — test Vitest di render componenti e navigazione
- **Riferimenti a pattern e convenzioni di progetto**:
  - `docs/DESIGN.md §1–§6`: tap target ≥ 44px, contrasto AA, palette (`paper`, `ink`, `basil`, `tomato`, `saffron`, `stone`), tipografia (titoli `Fraunces`, UI `Figtree`), bottom tab bar a 4 voci.
  - **Regola di isolamento WP3**: i componenti in questo WP usano definizioni di tipi locali o props inline e mockup hardcoded locali; **NON importano `lib/domain/types.ts` né `lib/db/`** per garantire la perfetta disgiunzione file con WP2.
- **Passi dettagliati di implementazione**:
  1. Creare i primitivi shadcn in `components/ui/`:
     - `button.tsx`: supporta varianti `default` (sfondo `bg-basil text-paper hover:bg-basil/90`), `destructive` (sfondo `bg-tomato text-paper`), `secondary` (`bg-stone/10 text-ink`), `outline` (`border border-stone/20 text-ink`), `ghost`. Dimensioni con altezza minima 44px per accessibilità tap.
     - `badge.tsx`: pillola arrotondata (`rounded-full px-3 py-1 text-xs font-medium`).
     - `card.tsx`: raggio 12px (`rounded-xl border border-stone/20 bg-white shadow-none`).
     - `checkbox.tsx`: checkbox accessibile con styling `data-[state=checked]:bg-basil data-[state=checked]:border-basil`.
     - `sheet.tsx`: pannello a scomparsa dal basso (mobile drawer) o da destra con animazione fluida.
  2. Implementare `components/navigation/bottom-nav.tsx`:
     - Render fisso in basso: `fixed bottom-0 left-0 right-0 z-40 bg-paper/95 backdrop-blur-sm border-t border-stone/20`.
     - 4 tab:
       - Piano: `href="/"`, label "Piano", icona `CalendarDays`
       - Lista: `href="/lista"`, label "Lista", icona `ShoppingCart`
       - Libreria: `href="/libreria"`, label "Libreria", icona `BookOpen`
       - Impostazioni: `href="/impostazioni"`, label "Impostazioni", icona `Settings`
     - Rilevamento rotta attiva tramite `usePathname()`: classe attiva `text-basil font-semibold`, classe inattiva `text-stone hover:text-ink`.
     - Ciascun link ha `min-h-[44px]` e `min-w-[44px]` con padding centrato per tocco rapido con una mano.
  3. Implementare `components/cards/meal-card.tsx`:
     - Props locali:
       ```ts
       interface MealCardProps {
         dayLabel: string; // es. "Lunedì 20"
         mealType: 'pranzo' | 'cena';
         title: string;
         prepMinutes: number;
         tags: string[];
         isFavorite?: boolean;
         isLocked?: boolean;
         onSwap?: () => void;
         onToggleFavorite?: () => void;
         onClick?: () => void;
       }
       ```
     - Eyebrow: `dayLabel · mealType` in maiuscoletto `text-xs text-stone tracking-wide font-medium`.
     - Titolo: `font-display font-medium text-lg text-ink line-clamp-2`.
     - Chip tag: badge compatti per tempo di preparazione (`${prepMinutes} min`) e tag dieta/stile.
     - Pulsanti d'azione sempre accessibili:
       - Bottone stella ★ per preferita: icona `Star` (colore `text-saffron fill-saffron` se preferita, `text-stone` se inattiva).
       - Bottone swap: icona `RefreshCw` con etichetta "Cambia" in colore `text-tomato hover:bg-tomato/10` con tap target di 44px.
  4. Implementare `components/sheets/recipe-sheet.tsx`:
     - Props locali per dettaglio ricetta mockup (titolo, tempo, porzioni, ingredienti con toggle 👍/👎, lista passi).
     - Struttura scrollabile pulita, titolo in `Fraunces`, barra inferiore con rating 1–5 (stelle) e bottone blocco "Non proporre più" (`text-tomato`).
  5. Implementare `components/shopping/shopping-item-row.tsx`:
     - Props locali:
       ```ts
       interface ShoppingItemRowProps {
         id: string;
         name: string;
         quantity?: string;
         category: string;
         checked: boolean;
         onToggle: (id: string) => void;
       }
       ```
     - Tutta la riga è un contenitore interattivo (`role="button"`, `min-h-[48px] flex items-center gap-3 px-3 py-2 cursor-pointer select-none rounded-lg hover:bg-stone/5`).
     - Checkbox 44×44 px a sinistra con stato checked.
     - Se `checked === true`, testo sbarrato (`line-through text-stone`) e opacità attenuata.
  6. Implementare `components/filters/chip-filter.tsx`:
     - Bottone a pillola (`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors`).
     - Attivo: `bg-basil text-paper border-basil`.
     - Inattivo: `bg-white text-stone border border-stone/20 hover:border-stone/40 hover:text-ink`.
  7. Implementare `components/feedback/empty-state.tsx`:
     - Contenitore centrato con icona tematica, titolo in `font-display text-xl text-ink`, paragrafo descrittivo in `text-stone text-sm max-w-sm` e bottone CTA primario (`bg-basil`).
  8. Aggiornare `app/layout.tsx`:
     - Aggiungere il componente `<BottomNav />`.
     - Impostare il padding sul `<main className="pb-24 pt-4 px-4 max-w-2xl mx-auto min-h-screen">` per garantire la visibilità completa dei contenuti sopra la barra inferiore.
  9. Creare le pagine mockup:
     - `app/page.tsx`: Titolo settimana ("Settimana 15 - 21 Settembre"), CTA "Genera piano", lista mockup di 3-4 `MealCard` per i primi giorni e uno stato vuoto dimostrativo.
     - `app/lista/page.tsx`: Intestazione con progresso spunta ("3/8 completati"), raggruppamento per reparto ("Ortofrutta", "Banco frigo") e righe `ShoppingItemRow` con toggle interattivo locale (stato React).
     - `app/libreria/page.tsx`: Barra di ricerca, chip filtri (`ChipFilter`) e griglia mockup di card ricetta.
     - `app/impostazioni/page.tsx`: Riepilogo mockup nucleo domestico (persone: 2, pasti: pranzo e cena, elettrodomestici attivi).
  10. Creare `tests/ui/shell.test.tsx`:
      - Test che verifica la presenza delle 4 voci di navigazione nella `BottomNav`.
      - Test che verifica il render di `MealCard` con eyebrow, titolo, tag e bottoni swap e stella.
      - Test che verifica il comportamento di click su `ShoppingItemRow` e il toggle visivo della spunta.
- **Contratti esposti**:
  - Pagine web navigabili: `/`, `/lista`, `/libreria`, `/impostazioni`.
  - Componenti riutilizzabili: `MealCard`, `RecipeSheet`, `ShoppingItemRow`, `ChipFilter`, `EmptyState`, `BottomNav`.
- **Dipendenze**: Richiede il completamento di WP1 (scaffold, Tailwind, font). Totalmente disgiunto da WP2.
- **Criteri di accettazione**:
  - `pnpm test` esegue `tests/ui/shell.test.tsx` con esito verde.
  - `pnpm build` compila le 4 pagine senza errori TypeScript.
  - Le card e le righe rispettano la dimensione minima di tocco di 44px e la palette di `DESIGN.md`.
  - Nessun file di WP2 è importato in WP3.
- **Cosa è esplicitamente fuori scope**:
  - Connessione reale a PostgreSQL o API Route di backend (previste nelle Feature successive).
  - Generazione di ricette con LLM.
  - Wizard completo multi-step di onboarding (previsto in Feature 3).

---

## 3. Strategia di Riuso

- **shadcn/ui e Radix Primitives**: i componenti UI (`Button`, `Sheet`, `Badge`, `Card`, `Checkbox`) devono basarsi sui pattern accessibili di shadcn/ui e su `lib/utils.ts` (`cn`).
- **Token CSS e Variabili Font**: tutti i componenti devono riutilizzare rigorosamente le classi Tailwind generate da `@theme` (`paper`, `ink`, `basil`, `tomato`, `saffron`, `stone`, `font-display`, `font-sans`) definite in `app/globals.css`.
- **Tipi Zod di Dominio**: `lib/domain/types.ts` deve essere il solo riferimento per tipi e schemi; WP2 definisce i tipi canonici che verranno riutilizzati da tutte le feature 2-7.

---

## 4. Mappa delle Dipendenze e Ordine di Esecuzione

```mermaid
flowchart TD
    WP1[WP1: S0.1 Scaffold & Token - Wave 1] --> WP2[WP2: S0.2 Schema DB & Types - Wave 2]
    WP1 --> WP3[WP3: S0.3 UI Kit & Shell - Wave 2]
```

### Regole di parallelizzazione:
- **Wave 1**: `WP1` deve essere eseguito in isolamento. Nessun altro WP può iniziare prima della chiusura con gate verde di `WP1`.
- **Wave 2**: `WP2` e `WP3` sono rigorosamente **file-disjoint**:
  - `WP2` possiede: `docker-compose.dev.yml`, `drizzle.config.ts`, `lib/domain/types.ts`, `lib/db/**`, `docker/**`, `tests/db/**`.
  - `WP3` possiede: `app/**`, `components/**`, `tests/ui/**`.
  Possono essere eseguiti in parallelo da sub-agenti `implementer` distinti.

---

## 5. Indice Completo dei Work Package e Checklist

- [x] **Wave 1**
  - [x] `WP1 — S0.1`: Scaffold del progetto, setup Next.js 16, Tailwind v4, shadcn/ui, Vitest, design token e layout di base
- [x] **Wave 2** (Parallela)
  - [x] `WP2 — S0.2`: Schema DB Drizzle, tipi Zod di dominio, Postgres docker-compose, migrazioni e test repository
  - [x] `WP3 — S0.3`: UI Kit, shell di navigazione a 4 tab, componenti `MealCard`, `RecipeSheet`, `ShoppingItemRow` e test UI
