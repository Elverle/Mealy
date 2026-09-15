# Feature 1 — E0 Fondamenta: Requisiti e Decisioni

Documento di memoria delle decisioni architetturali e tecniche assunte in fase di planning per la Feature 1 (E0 Fondamenta).

## 1. Planning Layout & Naming
- **Layout risolto**: `docs/planning/` come root dei piani (da `.claude/agentic-feature-factory.local.md`), cartella feature `docs/planning/feature/feature-1/`.
- **Identificativo & Titolo**: `Feature 1 — E0 Fondamenta (scaffold, schema DB, UI shell)`.

## 2. Decisioni Tecniche e Stack
- **Framework & Runtime**: Next.js 16 (o `next@latest`), React 19, TypeScript in strict mode, App Router. *Rationale*: scelta esplicita dell'utente per allinearsi all'ultima versione stabile/major disponibile.
- **Styling & Design System**: Tailwind CSS v4 con configurazione dei design token (`paper`, `ink`, `basil`, `tomato`, `saffron`, `stone`, font Fraunces e Figtree) definita via CSS theme in `app/globals.css`, integrato con shadcn/ui. *Rationale*: adozione dello standard moderno di Tailwind v4 come richiesto dall'utente.
- **Scaffold Options**: Cartella root pulita senza `src/` (`--no-src-dir`), import alias `@/*` mappato su `./*`, gestione pacchetti con `pnpm`. Struttura cartelle: `app/`, `components/`, `lib/domain/`, `lib/db/`, `lib/llm/`, `fixtures/`.
- **Database & ORM**: PostgreSQL 16 locale via `docker-compose.dev.yml` (con estensione `pg_trgm`), Drizzle ORM + `drizzle-kit`, driver `postgres` (`postgres.js`).
- **Testing & Tooling**: Vitest con `vite-tsconfig-paths` e `@testing-library/react` per test unitari e di componenti senza rete; ESLint e Prettier con script unificati in `package.json`.

## 3. Liste Chiuse degli Enum di Dominio
Gli enum sono definiti come array `const` e schemi `z.enum()` in `lib/domain/types.ts`:
- **`UNIT_ENUM`**: `['g', 'ml', 'pz', 'qb']` (*ARCHITECTURE §4.1*)
- **`CATEGORY_ENUM`** (reparti spesa ordinati per supermarket tour): `['ortofrutta', 'pane', 'macelleria', 'pescheria', 'banco-frigo', 'dispensa', 'surgelati', 'bevande', 'altro']` (*ARCHITECTURE §4.1 & §5.5*)
- **`MEAL_TYPE_ENUM`**: `['pranzo', 'cena']` (*ARCHITECTURE §4.2*)
- **`DIET_FLAG_ENUM`**: `['vegetariano', 'vegano', 'senza-glutine', 'senza-lattosio', 'pescetariano']` (*Scelta concordata*)
- **`MEAL_STYLE_TAG_ENUM`**: `['veloce', 'salutare', 'proteico', 'leggero', 'comfort-food', 'economico', 'piatto-unico']` (*Scelta concordata*)
- **`APPLIANCE_ENUM`**: `['fornelli', 'forno', 'microonde', 'friggitrice-ad-aria', 'frullatore']` (*Scelta concordata*)
- **`PLAN_STATUS_ENUM`**: `['draft', 'active', 'archived']` (*ARCHITECTURE §4.2*)
- **`RECIPE_SOURCE_ENUM`**: `['llm', 'manual']` (*ARCHITECTURE §4.2*)
- **`INGREDIENT_PREF_ENUM`**: `['like', 'dislike']` (*ARCHITECTURE §4.2*)

## 4. Default Seed Household Singleton
- **Identificativo**: UUID fisso `'00000000-0000-0000-0000-000000000001'`.
- **Valori di default**:
  - `persons`: `2`
  - `meals`: `['pranzo', 'cena']`
  - `diet_tags`: `[]`
  - `meal_style_tags`: `['veloce', 'salutare']`
  - `appliances`: `['fornelli', 'forno', 'microonde', 'friggitrice-ad-aria']`
- *Rationale*: Fornisce un profilo household valido immediatamente pronto per i test DB e per visualizzare la UI prima dell'onboarding guidato di Feature 3.

## 5. Strategia di Decomposizione in Work Package
- **Wave 1 (Solitaria)**:
  - `WP1 (S0.1)`: Scaffold Next.js 16 + Tailwind v4 + shadcn/ui + Vitest + token `DESIGN.md`.
- **Wave 2 (Parallela & File-Disjoint)**:
  - `WP2 (S0.2)`: Schema DB Drizzle, migrazioni, Docker dev compose, Zod domain types (`lib/domain/types.ts`), base repository tipato e test DB.
  - `WP3 (S0.3)`: UI Kit, layout mobile-first con bottom navigation bar a 4 tab (`/`, `/lista`, `/libreria`, `/impostazioni`), componenti base (`MealCard`, `RecipeSheet`, `ShoppingItemRow`, `ChipFilter`, `EmptyState`) con mock data hardcoded locali isolati.
