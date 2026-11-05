# Mealy — Cosa Mangio Oggi

App web personale di meal planning: genera il piano settimanale con una selezione pesata dalla libreria di ricette, tiene conto delle preferenze esplicite e produce la lista della spesa consolidata. Le ricette generate dall'LLM non sono usa-e-getta: entrano nella libreria e vengono riusate nei piani successivi.

## Stato

Versione **0.10.1**. Feature completate:

- **E0 Fondamenta** — scaffold Next.js, schema DB, shell UI a 4 tab
- **E1 Motore ricette** — adapter LLM multi-provider, generazione e persistenza delle ricette, fixtures e seed
- **E5 Impostazioni** — wizard di primo avvio e vincoli del nucleo (`/impostazioni`, `GET/PUT /api/settings`)
- **E3 Pianificatore** — piano settimanale dalla libreria con selezione pesata, swap, blocco, conferma, *Ripeti* e navigatore di settimane (`/`, `/api/plans`)
- **E2 Libreria e preferenze** — libreria con ricerca e filtri, voto, ★ e *Non proporre più* sulle ricette, 👍/👎 sugli ingredienti e sezione *I miei ingredienti* (`/libreria`, `/api/recipes`, `/api/ingredient-prefs`)
- **E4 Lista della spesa** — lista consolidata dal piano confermato e ordinata per reparto, spunte che reggono la rete assente, articoli aggiunti a mano e *Aggiorna lista* quando il piano cambia (`/lista`, `/api/plans/:id/shopping-list`, `/api/shopping-items`)
- **E6 Deploy** — produzione su un server di casa con Docker Compose (un Raspberry Pi nel caso del maintainer), raggiungibile dalla rete di casa e via VPN: immagine costruita sul server o da GitHub Actions, migrazioni e alias applicati all'avvio dell'app, backup notturno e aggiornamento con un solo comando (`docs/DEPLOY.md`, `scripts/deploy.sh`, `GET /api/health`)
- **Ricette su richiesta (Feature 9)** — dalla ricerca della Libreria si chiede una ricetta all'LLM, che entra in libreria solo con *Aggiungi alla libreria*; sulla card del Piano *Scegli* apre le ricette adatte a quel pasto, con *Metti nel piano* e la richiesta all'LLM se la ricetta non c'è (`POST /api/recipes/propose`, `POST /api/recipes`, `/api/plans/:id/slots/:slotId/candidates`, `/api/plans/:id/slots/:slotId/recipe`). Nessuna migrazione né variabile nuova
- **Portate ed etichette (Feature 8)** — ogni ricetta ha una o più portate (piatto unico, primo, secondo, contorno), mostrate con un badge su card e dettaglio e filtrabili dal gruppo *Portata* della Libreria; le etichette di stile passano da 7 a 12; un contorno da solo non entra mai nel piano. Le ricette salvate prima le classifica l'LLM all'avvio dell'app in produzione (in sviluppo con `pnpm recipes:classify`). Una migrazione (`0005`), nessuna variabile nuova
- **Pacchetto iniziale di ricette (Feature 10)** — la libreria parte da 200 ricette italiane riscritte da un dataset (49 primi, 51 secondi, 41 piatti unici, 60 contorni), con le diete ricavate per regola da una tabella degli ingredienti rivista a mano: il primo piano di solito esce senza chiamare l'LLM. L'app le carica all'avvio in produzione, saltando i titoli già in libreria o simili; il pacchetto si prepara una volta sola sul PC con `pnpm recipes:pack`. Nessuna migrazione né variabile nuova
- **Composizione del pasto (Feature 11)** — un pasto è un piatto unico, un primo o un secondo, con o senza contorno: nell'onboarding e nelle Impostazioni, dentro *Pasti da pianificare*, si scelgono le composizioni ammesse per pranzo e per cena (di default tutte e cinque), e *Genera piano* le alterna in modo bilanciato. Sulla card del pasto si aggiunge, si cambia o si toglie il contorno, *Scegli* sul principale cambia anche la composizione e il lucchetto blocca il pasto intero; la lista della spesa comprende i contorni. L'etichetta di stile *Piatto unico* sparisce: resta come portata. Due migrazioni (`0006`, `0007`), due rotte nuove (`POST /api/plans/:id/slots/:slotId/side`, `DELETE /api/plans/:id/slots/:slotId`), nessuna variabile nuova

Avanzamento completo in [`docs/planning/feature-index.md`](docs/planning/feature-index.md).

## Stack

Next.js (App Router, TypeScript) · Tailwind CSS + shadcn/ui · PostgreSQL 16 · Drizzle ORM + drizzle-kit · Zod · Vercel AI SDK (provider via env `LLM_PROVIDER` + `LLM_MODEL`) · Vitest · pnpm

## Requisiti

- Node.js 22 o superiore (lo richiede l'AI SDK; il gate e l'immagine di produzione usano la 24). Il progetto non fissa la versione: né `engines` in `package.json` né `.nvmrc`
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
- **Piano.** *Genera piano* sceglie le ricette dalla libreria e chiama l'LLM solo quando la libreria non basta: fino alla 0.9, con `pnpm db:seed` e le impostazioni di default, il primo piano non richiedeva una chiave API. `pnpm db:seed` non carica il pacchetto iniziale di ricette: per provarlo in sviluppo c'è `pnpm recipes:pack load`. Dalla 0.10 le composizioni di default comprendono il contorno; le ricette d'esempio hanno sette contorni (sei per pranzo e cena, uno solo per cena), che bastano al primo piano in quasi tutte le settimane: solo se il sorteggio dà quattro pasti con il contorno sia a pranzo sia a cena (circa una settimana su cento) il piano chiede un contorno all'LLM. Da lunedì a venerdì si pianifica la settimana in corso, nel weekend la successiva; le frecce ‹ › (`/?settimana=YYYY-MM-DD`) mostrano anche le settimane passate, in sola lettura.
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
| `pnpm db:seed:aliases` | Inserisce o corregge gli alias degli ingredienti usati dalla lista della spesa (idempotente). In produzione lo stesso caricamento avviene da solo all'avvio dell'app |
| `pnpm db:generate` | Genera una nuova migrazione dallo schema (`lib/db/schema.ts`) |
| `pnpm llm:record` | Registra una risposta LLM reale in `tests/fixtures/llm/recorded/` (richiede una chiave API); con `--request "testo"` registra una richiesta libera |
| `pnpm recipes:classify` | Assegna portate ed etichette di stile alle ricette senza portata sul database di `DATABASE_URL` (richiede una chiave API). In produzione lo stesso procedimento parte da solo all'avvio dell'app |
| `pnpm recipes:pack <passo>` | Pacchetto iniziale di ricette. Si prepara una volta sola sul PC, dal dataset `docs/recipe.csv` (non nel repository): `select` → revisione di `.recipe-pack/selection.md` → `convert` → `ingredients` → revisione della tabella e `ingredients --approve` → `build`, che scrive `fixtures/recipe-pack.json`. `convert` e `ingredients` richiedono una chiave API. `load` carica il pacchetto sul database di `DATABASE_URL`; in produzione lo carica l'app all'avvio |

Gate di verifica: `pnpm lint` + `pnpm typecheck` + `pnpm test` + `pnpm build`, tutti verdi. I test non usano la rete: l'LLM è simulato con risposte registrate.

## Deploy

Mealy gira su **qualsiasi macchina Linux con Docker** che tieni in casa: un mini PC, un vecchio portatile, un NAS, un Raspberry Pi a 64 bit (`x86_64` o `aarch64`). Lo stack è Docker Compose: app Next.js standalone, PostgreSQL 16 e backup notturno. Il maintainer lo fa girare su un Raspberry Pi 4 con Tailscale, ma il progetto non dipende dal Raspberry.

> **L'app non ha autenticazione** (`docs/ARCHITECTURE.md §8`). Tienila raggiungibile solo dalla rete di casa e, da fuori casa, con una VPN (Tailscale, WireGuard) oppure dietro un reverse proxy con login. Non aprire la porta su Internet: chiunque la raggiunga può modificare i dati e generare ricette con la tua chiave LLM, a tue spese.

Avvio rapido sul server. Servono Docker con Compose v2, `git` e la chiave API di un provider LLM:

```bash
git clone https://github.com/Elverle/Mealy.git && cd Mealy
cp .env.production.example .env.production && chmod 600 .env.production
nano .env.production       # POSTGRES_PASSWORD (openssl rand -hex 24), LLM_MODEL e la chiave del provider
bash scripts/deploy.sh --build
```

Poi apri `http://<ip-del-server>:3000`. Per aggiornare a una versione nuova basta rilanciare `bash scripts/deploy.sh --build`. La guida completa è [`docs/DEPLOY.md`](docs/DEPLOY.md): preparazione del server, VPN, backup e ripristino, aggiornamenti, ritorno a una versione precedente e problemi frequenti.

- **Da dove viene l'immagine.** Con `--build` la costruisce il server stesso. In alternativa la costruisce GitHub Actions a ogni push su `main` (workflow `Image`, `ghcr.io/<proprietario del repository>/mealy:sha-<commit>`, anche da un fork) e `bash scripts/deploy.sh` la scarica: conviene su una macchina piccola, ed è il modo usato sul Raspberry del maintainer (`docs/DEPLOY.md §3.4`).
- All'avvio in produzione l'app applica le migrazioni e carica gli alias degli ingredienti (`DB_BOOTSTRAP_ON_START=true`, `lib/db/bootstrap.ts`): sul server non si lancia nessun comando `pnpm`. Le ricette di esempio di `pnpm db:seed` non entrano mai in produzione.
- Dopo migrazioni e alias l'app carica il pacchetto iniziale di ricette (`fixtures/recipe-pack.json`): entrano solo le ricette con un titolo non già in libreria, né uguale né simile, e l'avvio aspetta il caricamento. Nei log dell'app compare `[pack] ricette del pacchetto inserite: N, già presenti o simili: M` (ai riavvii N è 0); se il caricamento fallisce l'app parte lo stesso e riprova al riavvio successivo.
- Dopo il pacchetto l'app classifica in background, a lotti di 10, le ricette ancora senza portata: l'avvio non la aspetta e i log dell'app mostrano righe `[classify]`. Senza modello configurato le ricette restano senza portata e l'app funziona lo stesso; le rimaste si riprovano al riavvio.
- Dalla 0.8 si torna a una versione precedente solo ripristinando il dump `predeploy` (`docs/DEPLOY.md §6`); vale anche per la 0.10, che aggiunge la portata dei piatti dei piani e le composizioni dei pasti.
- Prova locale dello stack di produzione: `docker build -t mealy-app:smoke . && bash scripts/smoke-prod.sh mealy-app:smoke`.

## Come è sviluppato

Mealy è sviluppato con [agentic-feature-factory](https://github.com/Elverle/agentic-feature-factory), il mio workflow di sviluppo guidato da agenti per Claude Code. Ogni feature segue la stessa pipeline: brainstorming e specifica, piano a work package (`/feature-plan`), architecture review (`/arch-review`), implementazione test-driven con il gate di verifica (`/feature-dev`), code review (`/feature-review`) e documentazione (`/feature-docs`). Specifiche, piani e review di ogni feature sono in [`docs/planning/`](docs/planning/); la wiki tecnica che il workflow tiene aggiornata è in [`docs/wiki/`](docs/wiki/index.md).

## Documentazione

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architettura, modello dati, logiche core, API
- [`docs/DESIGN.md`](docs/DESIGN.md) — design system, schermate, microcopy
- [`docs/BACKLOG.md`](docs/BACKLOG.md) — epic, story e criteri di accettazione
- [`docs/planning/`](docs/planning/) — strategia di esecuzione, piani e stato delle feature
- [`docs/wiki/index.md`](docs/wiki/index.md) — wiki tecnica del codice
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — deploy su un server di casa

## Contribuire

Segnalazioni e pull request sono benvenute: come procedere è in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Licenza

[MIT](LICENSE).
