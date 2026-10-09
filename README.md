# Mealy — Cosa Mangio Oggi

App web personale di meal planning: genera il piano settimanale con una selezione pesata dalla libreria di ricette, tiene conto delle preferenze esplicite e produce la lista della spesa consolidata. Le ricette generate dall'LLM non sono usa-e-getta: entrano nella libreria e vengono riusate nei piani successivi.

## Stato

Versione **0.5.1**. Feature completate:

- **E0 Fondamenta** — scaffold Next.js, schema DB, shell UI a 4 tab
- **E1 Motore ricette** — adapter LLM multi-provider, generazione e persistenza delle ricette, fixtures e seed
- **E5 Impostazioni** — wizard di primo avvio e vincoli del nucleo (`/impostazioni`, `GET/PUT /api/settings`)
- **E3 Pianificatore** — piano settimanale dalla libreria con selezione pesata, swap, blocco, conferma, *Ripeti* e navigatore di settimane (`/`, `/api/plans`)
- **E2 Libreria e preferenze** — libreria con ricerca e filtri, voto, ★ e *Non proporre più* sulle ricette, 👍/👎 sugli ingredienti e sezione *I miei ingredienti* (`/libreria`, `/api/recipes`, `/api/ingredient-prefs`)
- **E4 Lista della spesa** — lista consolidata dal piano confermato e ordinata per reparto, spunte che reggono la rete assente, articoli aggiunti a mano e *Aggiorna lista* quando il piano cambia (`/lista`, `/api/plans/:id/shopping-list`, `/api/shopping-items`)

Avanzamento completo in [`docs/planning/feature-index.md`](docs/planning/feature-index.md).

## Stack

Next.js (App Router, TypeScript) · Tailwind CSS + shadcn/ui · PostgreSQL 16 · Drizzle ORM + drizzle-kit · Zod · Vercel AI SDK (provider via env `LLM_PROVIDER` + `LLM_MODEL`) · Vitest · pnpm

## Requisiti

- Node.js (il progetto non fissa una versione: né `engines` in `package.json` né `.nvmrc`)
- pnpm
- Docker (con Docker Compose) per il PostgreSQL di sviluppo

## Avvio in sviluppo

```bash
pnpm install
cp .env.example .env        # poi imposta le variabili (v. sotto)
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Variabili in `.env` (i nomi completi e i commenti sono in `.env.example`):

| Variabile | Uso |
|---|---|
| `DATABASE_URL` | Connessione Postgres; il default punta al container di sviluppo (`postgresql://mealy:mealy@localhost:5432/mealy_dev`) |
| `LLM_PROVIDER` | `google` \| `openrouter` \| `anthropic` \| `openai-compatible` |
| `LLM_MODEL` | Modello del provider scelto (es. `gemini-3.1-flash-lite`; alternativa consigliata `z-ai/glm-5.3-flash` su OpenRouter) |
| `LLM_TIMEOUT_MS` | Timeout di una chiamata LLM in millisecondi, per un lotto da 3 ricette (default `90000`; fino a `120000` con modelli lenti) |
| `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` | Chiave del provider attivo: serve solo quella |
| `LLM_BASE_URL`, `LLM_API_KEY` | Solo per `LLM_PROVIDER=openai-compatible` |

Note:

- **Primo avvio.** Finché l'onboarding non è completato, ogni tab reindirizza al wizard `/benvenuto` (5 passi precompilati). Dopo si arriva al Piano; i vincoli si modificano da Impostazioni.
- **Piano.** *Genera piano* sceglie le ricette dalla libreria e chiama l'LLM solo quando la libreria non basta: con `pnpm db:seed` e le impostazioni di default il primo piano non richiede una chiave API. Da lunedì a venerdì si pianifica la settimana in corso, nel weekend la successiva; le frecce ‹ › (`/?settimana=YYYY-MM-DD`) mostrano anche le settimane passate, in sola lettura.
- **`.env` già esistente.** Se il tuo `.env` ha ancora `LLM_TIMEOUT_MS=50000` (valore precedente di `.env.example`), portalo a `90000`: il timeout ora vale per un lotto di 3 ricette.
- **Porta 5432 occupata.** Crea un file di override (es. `docker-compose.dev.override.yml`) che rimappa la porta host, per esempio:

  ```yaml
  services:
    postgres:
      ports: !override
        - "5433:5432"
  ```

  Il tag `!override` (Docker Compose 2.24 o successivo) sostituisce la mappatura originale invece di aggiungerne una seconda. Avvialo con `docker compose -f docker-compose.dev.yml -f docker-compose.dev.override.yml up -d` e aggiorna `DATABASE_URL` in `.env` con la nuova porta. `pnpm test` non legge `.env`: per i test DB esporta `DATABASE_URL` anche nella shell.

## Comandi

| Comando | Cosa fa |
|---|---|
| `pnpm dev` | Server di sviluppo |
| `pnpm test` | Test Vitest (i test DB richiedono il Postgres Docker attivo e migrato) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | Build di produzione |
| `pnpm db:migrate` | Applica le migrazioni drizzle-kit |
| `pnpm db:seed` | Seed idempotente (household di default, ricette fixture, alias ingredienti); solo per lo sviluppo |
| `pnpm db:seed:aliases` | Inserisce solo gli alias degli ingredienti usati dalla lista della spesa (idempotente); è il comando per la produzione |
| `pnpm db:generate` | Genera una nuova migrazione dallo schema (`lib/db/schema.ts`) |
| `pnpm llm:record` | Registra una risposta LLM reale in `tests/fixtures/llm/recorded/` (richiede una chiave API) |

Gate di verifica: `pnpm lint` + `pnpm typecheck` + `pnpm test` + `pnpm build`, tutti verdi. I test non usano la rete: l'LLM è simulato con risposte registrate.

## Deploy

La v1 gira su Raspberry Pi con Docker Compose, raggiungibile solo via LAN/Tailscale e senza autenticazione (`docs/ARCHITECTURE.md §8`); i dettagli sono nella Feature 7 ([`docs/planning/feature/feature-7/spec.md`](docs/planning/feature/feature-7/spec.md)). In produzione, dopo `pnpm db:migrate`, gli alias degli ingredienti si caricano con `pnpm db:seed:aliases`; mai con `pnpm db:seed`, che inserisce anche le ricette di esempio.

## Documentazione

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architettura, modello dati, logiche core, API
- [`docs/DESIGN.md`](docs/DESIGN.md) — design system, schermate, microcopy
- [`docs/BACKLOG.md`](docs/BACKLOG.md) — epic, story e criteri di accettazione
- [`docs/planning/`](docs/planning/) — strategia di esecuzione, piani e stato delle feature
- [`docs/wiki/index.md`](docs/wiki/index.md) — wiki tecnica del codice
