# Feature 2 — E1 Motore ricette: Requisiti e Decisioni

Memoria del "perché" dietro `plan.md`. Fonte delle story: `docs/BACKLOG.md` (S1.1, S1.2, S1.3); contratti: `docs/ARCHITECTURE.md §4.1, §5.1, §7`; strategia: `docs/planning/execution-strategy.md §3 Feature 2`.

## 1. Layout e identità
- **Layout**: `docs/planning/` (da `.claude/agentic-feature-factory.local.md`), cartella `docs/planning/feature/feature-2/`.
- **Titolo**: Feature 2 — E1 Motore ricette (LLM adapter, generazione, fixtures).

## 2. Decisioni prese con l'utente (2026-09-17)
| # | Decisione | Motivo |
|---|---|---|
| U1 | **Provider di default: Google Gemini** (`LLM_PROVIDER=google`, `LLM_MODEL=gemini-2.5-flash`); **OpenRouter** come secondo provider dello smoke test (blocco commentato in `.env.example`) | Scelta dell'utente: ha la chiave Gemini come prima scelta; il secondo provider soddisfa il criterio "cambio provider via env" |
| U2 | **Risposte LLM registrate = file di testo scritti a mano** in `tests/fixtures/llm/` **+ script `pnpm llm:record`** per catturare risposte reali in seguito | Test deterministici subito, con possibilità di sostituirli/affiancarli con output reali |
| U3 | **Una sola chiamata LLM per richiesta** (più l'eventuale repair): se dopo filtro vincoli e dedup restano meno di N ricette, si riporta il conteggio (`created` / `skipped`) senza rabbocco | Costo e latenza prevedibili; la politica "genera ancora" appartiene al planner (F4, protocollo `needMore`) |
| U4 | **`diet_flags` = tutte le diete che la ricetta soddisfa**, con espansione deterministica dopo il parse: `vegano ⇒ vegetariano + pescetariano + senza-lattosio`; `vegetariano ⇒ pescetariano` | Il planner (F4) filtra con la semplice regola "diete household ⊆ diet_flags" senza conoscere le implicazioni |

## 3. Decisioni prese in planning (senza domanda, motivate)
| # | Decisione | Motivo |
|---|---|---|
| P1 | **AI SDK 7** (`ai@^7`) con `generateText` + `output: Output.object({ schema })` (non `generateObject`, deprecato) e opzione `instructions` (non `system`) | Versione corrente verificata su npm/documentazione il 2026-09-17; peer `zod ^3.25.76` compatibile con lo zod 3.25.76 installato |
| P2 | Pacchetti provider: `@ai-sdk/google@^4`, `@ai-sdk/anthropic@^4`, `@ai-sdk/openai-compatible@^3`, `@openrouter/ai-sdk-provider@^3` | Unici compatibili con `ai@7`; nessun uso di AI Gateway (deploy self-hosted su Raspberry, ADR `ARCHITECTURE §8`) |
| P3 | L'adapter restituisce **`GeneratedRecipe[]`** (contratto §5.1: senza `id`, `household_id`, `slug`), non `Recipe[]` | `Recipe` richiede campi assegnati solo dalla persistenza; lo schema nuovo vive in `lib/domain/types.ts` (single source of truth) |
| P4 | Schema di output LLM **senza `.optional()`/`.default()`** (campi nullable espliciti) | I provider con structured output (Gemini, OpenAI-compatible) gestiscono male i campi opzionali nel JSON Schema |
| P5 | Regola `qb`: normalizzazione, non validazione (`qb` ⇒ `qty=null`; `qty=null` con unità ≠ `qb` ⇒ unità `qb`) | Evita cicli di repair per incoerenze banali; enum e tipi restano invece stretti (repair) |
| P6 | Vincoli in input all'adapter come **`RecipeConstraints`** con `ingredient_likes` / `ingredient_dislikes` già presenti (vuoti fino a F5) | Contratto trasversale n.3: F5 cabla i dati senza cambiare le firme |
| P7 | **Filtro vincoli deterministico dopo la generazione** (pasto, diete, elettrodomestici, ingredienti esclusi): le ricette non conformi sono scartate con motivo `constraint_violation` | L'LLM può sbagliare; la libreria non deve contenere ricette incompatibili con i vincoli con cui sono state chieste |
| P8 | Dedup = **titolo normalizzato identico** (minuscolo, senza accenti/punteggiatura) **oppure `similarity(title) > 0.6`** (pg_trgm), **limitato allo stesso household**, controllato anche **dentro lo stesso batch** | `ARCHITECTURE §5.1`; il batch si inserisce in un'unica transazione che vede le proprie righe |
| P9 | Inserimento dell'intero batch in **una transazione con advisory lock** (`pg_advisory_xact_lock(hashtext('mealy:recipes:generate'))`); la chiamata LLM avviene **fuori** dalla transazione | Due generazioni concorrenti non producono duplicati; non si tiene una transazione aperta per 30 s |
| P10 | Exclude-list nel prompt: **max 150 titoli** più recenti dell'household (filtrati per pasto se indicato); il dedup confronta invece con **tutti** i titoli | Prompt di dimensione limitata; correttezza garantita dal dedup lato DB |
| P11 | `count` richiesto: intero **1..10**, default **5** | Batch da 5 = `ARCHITECTURE §5.1`; 10 rispetta i rate limit dei free tier |
| P12 | Timeout per chiamata LLM **50 s** (`LLM_TIMEOUT_MS`), `maxRetries: 1` (errori transitori), route **`maxDuration = 120`**, `runtime = 'nodejs'` | Chiamata + repair (≤ 100 s) stanno nel budget; `maxDuration` è rilevante solo su Vercel ma documenta il budget |
| P13 | Errori tipizzati **`LlmError`** con `code: 'config' \| 'provider' \| 'timeout' \| 'invalid_output'`; la route li traduce in HTTP + microcopy `DESIGN.md §5` ("La generazione non è andata a buon fine. Riprova.") | UI pulita, nessun gergo; log server con la causa |
| P14 | Corpo della route: `{ count?, meal_type?, overrides? }` con `overrides` parziale di `persons / diet_tags / meal_style_tags / appliances` | Serve allo smoke test con vincoli estremi ("solo friggitrice ad aria, vegano") prima che esista la UI Impostazioni (F3) |
| P15 | Slug: `slugify(title)`; collisione ⇒ suffisso `-2`, `-3`, … fino a `-99`, poi suffisso esadecimale casuale di 6 caratteri | `recipes.slug` è unico globalmente (schema F1) |
| P16 | Fixtures: **18 ricette** con UUID fissi, `source: 'manual'`, household di default; alias in `fixtures/ingredient-aliases.json` | Coprono pasti, diete, elettrodomestici, reparti, `qb`, ingredienti condivisi e unità eterogenee per F4/F5/F6 |
| P17 | Seed: logica in `lib/db/seed-core.ts` (testabile), CLI in `lib/db/seed.ts` (script `db:seed` già presente in `package.json`) che carica `.env.local`/`.env` con `process.loadEnvFile` | `tsx` non carica i file env; separazione CLI/logica per i test |
| P18 | Test DB: helper condiviso `tests/helpers/db.ts`; DB non raggiungibile ⇒ `describe.skipIf`; DB raggiungibile ma non migrato ⇒ **fallimento esplicito** ("esegui `pnpm db:migrate`"); ogni test di generazione usa un **household di test dedicato** eliminato a fine test | Isolamento dai dati di seed; nessuno skip silenzioso quando il DB c'è |
| P19 | I nuovi test lato server dichiarano `// @vitest-environment node` | `vitest.config.ts` usa `jsdom` globalmente; AI SDK e postgres.js vanno eseguiti in ambiente Node |
| P20 | Contratti e dipendenze in una **wave 1 solitaria** (WP1), poi adapter ∥ seed (wave 2), poi generazione (wave 3) | `types.ts` e `package.json` sono condivisi: modificarli una sola volta rende le wave successive file-disjoint |

## 4. Osservazioni sul codice as-built (da segnalare in `/arch-review 2`, fuori scope)
- `package.json` / `node_modules` hanno **Next.js 15.5.x**, mentre `docs/wiki/topics/e0-fondamenta.md` e il commit di F1 parlano di Next.js 16. Il piano non dipende dalla major (Route Handler + `maxDuration` identici).
- `tests/db/schema.test.ts` applica a mano solo la migrazione `0000` e modifica il household di default (`persons = 4`) senza ripristinarlo; su un DB già migrato con `pnpm db:migrate` il test finisce in skip. Non viene toccato da questa feature.
- `package.json` dichiara già `db:seed: tsx lib/db/seed.ts`, ma il file non esiste: lo crea WP3.
