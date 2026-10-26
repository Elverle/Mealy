---
title: Immagine e Stack di Produzione — Dockerfile e docker-compose.prod.yml (production-stack)
type: entity
created: 2026-10-11
updated: 2026-10-26
tags: [docker, dockerfile, compose, standalone, production, raspberry-pi, environment, postgres, deploy, feature-7, feature-10]
---

## File e Responsabilità

- **Percorsi file**:
  - `Dockerfile`: build a più stadi dell'immagine dell'app (Next.js standalone).
  - `.dockerignore`: cosa resta fuori dal contesto di build.
  - `next.config.ts`: opzione `output`, attiva solo con `NEXT_OUTPUT=standalone`.
  - `docker-compose.prod.yml`: stack di produzione, progetto `mealy-prod`, servizi `db`, `app`, `backup`.
  - `.env.production.example`: modello del file `.env.production`, che non va mai committato.
  - `.gitattributes`: fine riga LF per tutti i file `.sh`.
  - `.gitignore`: eccezione per `.env.production.example`; cartelle `backups/` e `.smoke/` ignorate.
- **Scopo**: descrivere tutto ciò che gira sul Raspberry Pi. Il Raspberry non costruisce l'immagine: la scarica da GHCR ([[ci-workflows]]) e la avvia con questo compose, sempre attraverso `scripts/compose-prod.sh` ([[deploy-scripts]]).

I comandi per chi opera il Raspberry sono in `docs/DEPLOY.md`.

## Immagine (`Dockerfile`)

| Stadio | Base | Cosa fa |
|---|---|---|
| `base` | `node:24-alpine` | `apk add libc6-compat`, `npm install -g pnpm@11.14.0`, `WORKDIR /app` |
| `deps` | `base` | Copia `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`; `pnpm install --frozen-lockfile`. Lo strato si riusa finché non cambia il lockfile |
| `builder` | `base` | Copia `node_modules` da `deps` e tutto il sorgente; `NEXT_TELEMETRY_DISABLED=1`, `NEXT_OUTPUT=standalone`; `pnpm build` |
| `runner` | `node:24-alpine` | Immagine finale: solo l'output standalone, i file statici e le migrazioni |

Stadio `runner`:
- `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1`, `PORT=3000`, `HOSTNAME=0.0.0.0` (ascolta su tutte le interfacce del container);
- utente non root `nextjs` (uid 1001) del gruppo `nodejs` (gid 1001);
- tre copie da `builder`, tutte con `--chown=nextjs:nodejs`: `.next/standalone` nella radice, `.next/static`, e **`lib/db/migrations`**. Le migrazioni SQL le legge il bootstrap dal disco e non fanno parte del bundle ([[db-bootstrap]]);
- `EXPOSE 3000`, `CMD ["node", "server.js"]`;
- etichetta `org.opencontainers.image.source` con l'URL del repository.

Scelte e motivi (requirements della Feature 7):
- **Node 24** (P1): `ai` 7 richiede Node ≥ 22 e il gate CI usa già Node 24. `ARG NODE_VERSION=24` vale per entrambe le basi.
- **pnpm fissato a 11.14.0 con `npm install -g`**, non corepack (P2): `package.json` non ha il campo `packageManager`.
- **Nessuna cartella `public/`** (P22): nel repository non esiste e il `Dockerfile` non la copia. Se viene creata serve la riga `COPY --from=builder --chown=nextjs:nodejs /app/public ./public` nello stadio `runner`.
- **La build non ha bisogno del database**: solo `/_not-found` è prerenderizzata (verifica di planning, requirements §5).
- `instrumentation.ts` e il migratore di drizzle entrano nello standalone senza configurazione aggiuntiva: Next traccia i file dell'hook di avvio (verifica di planning su Next 15.5.25).

Sul prototipo di planning (amd64) l'immagine finale pesava 233 MB.

### `output: 'standalone'` solo su richiesta (`next.config.ts`)

```ts
output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
```

La variabile la imposta solo lo stadio `builder`. La build locale (`pnpm build`) e quella del gate restano senza standalone: la copia dei file tracciati crea symlink, che con pnpm su Windows possono fallire (requirements P3).

### `.dockerignore`

Fuori dal contesto: `.git`, `.github`, `.claude`, `.tokensave`, `.next`, `node_modules`, `docs`, `tests`, `backups`, `.smoke`, `coverage`, `*.tsbuildinfo`, `*.log`, `.env` e `.env.*`, `Dockerfile`, `.dockerignore`, `docker-compose.*.yml`.

Due conseguenze: nessun file `.env` può finire nell'immagine, e `fixtures/` **resta nel contesto**, perché `fixtures/index.ts` importa i due file JSON e la build li include nel codice del server: gli alias servono al bootstrap.

Dalla Feature 10:
- anche `.recipe-pack` è fuori dal contesto: la cartella di lavoro del pacchetto di ricette contiene i testi e i link del dataset d'origine, che non devono entrare nell'immagine (code review della Feature 10). `docs/`, dove sta il dataset `docs/recipe.csv`, era già escluso;
- `fixtures/recipe-pack.json` (circa 600 KB) entra nel codice del server tramite `fixtures/recipe-pack.ts`, importato in modo dinamico dal caricatore all'avvio ([[recipe-pack]]).

## Stack (`docker-compose.prod.yml`)

`name: mealy-prod`. Tutti i servizi hanno `restart: unless-stopped` e log `json-file` con rotazione a 10 MB × 3 file, per proteggere la microSD (requirements P12).

### `db`
- `postgres:16-alpine`, utente e database `mealy`, password da `POSTGRES_PASSWORD`.
- Dati nel volume `postgres_data`, che Docker chiama `mealy-prod_postgres_data`.
- **Nessuna porta pubblicata**: il database si raggiunge solo dalla rete interna del compose.
- Healthcheck `pg_isready -U mealy -d mealy` ogni 5 s (12 tentativi, `start_period` 10 s).
- Nessuno script di inizializzazione: l'estensione `pg_trgm` la crea la migrazione `0000`.

### `app`
- Immagine da `MEALY_IMAGE`, obbligatoria: la calcola `scripts/compose-prod.sh` dal commit in uso.
- `depends_on: db` con `condition: service_healthy`.
- Porta `${APP_PORT:-3000}:3000`.
- Healthcheck su `GET /api/health` con `node -e "fetch(…)"`: ogni 10 s, limite 5 s, 6 tentativi, `start_period` 60 s ([[health-check]]).
- Variabili passate al container, **elencate una per una**:

| Variabile nel container | Valore |
|---|---|
| `DATABASE_URL` | `postgresql://mealy:${POSTGRES_PASSWORD}@db:5432/mealy`, composta dal compose |
| `DB_BOOTSTRAP_ON_START` | `"true"`, fisso: è ciò che attiva [[db-bootstrap]] |
| `LLM_PROVIDER` | da `.env.production`, default `google` |
| `LLM_MODEL` | da `.env.production`, **obbligatoria** |
| `LLM_TIMEOUT_MS` | default `90000` |
| `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_BASE_URL`, `LLM_API_KEY` | da `.env.production`, vuote se assenti |
| `TZ` | default `Europe/Rome` |

### `backup`
- Stessa immagine `postgres:16-alpine`; `depends_on: db` sano.
- Connessione dalle variabili `PGHOST=db`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`; `BACKUP_CRON` (default `0 3 * * *`), `BACKUP_KEEP` (default `7`), `TZ`.
- Monta `./docker/backup` in `/opt/backup` in sola lettura e `${BACKUP_DIR:-./backups}` in `/backups`.
- `entrypoint: ["sh", "/opt/backup/entrypoint.sh"]`. Nessun healthcheck. Dettagli in [[backup-service]].

### Variabili di `.env.production`

| Variabile | Obbligatoria | Default | Note |
|---|---|---|---|
| `POSTGRES_PASSWORD` | sì | — | Solo lettere e cifre: finisce dentro un URL. Vale alla prima creazione del database: cambiarla dopo non cambia la password già impostata |
| `LLM_MODEL` | sì | — | Modello del provider scelto |
| `LLM_PROVIDER` | no | `google` | `google`, `openrouter`, `anthropic`, `openai-compatible` ([[llm-adapter]]) |
| chiave del provider | serve per generare | vuota | Solo quella del provider attivo; con `openai-compatible` serve `LLM_BASE_URL`, più `LLM_API_KEY` se il servizio la richiede. Il compose non la impone: l'app parte anche senza (lo smoke gira senza chiavi) |
| `LLM_TIMEOUT_MS` | no | `90000` | Timeout di una chiamata LLM |
| `APP_PORT` | no | `3000` | Porta dell'app sull'host |
| `BACKUP_DIR` | no | `./backups` | Relativa alla cartella del repository oppure assoluta |
| `BACKUP_KEEP` | no | `7` | Dump conservati per etichetta |
| `BACKUP_CRON` | no | `0 3 * * *` | Orario del backup notturno |
| `TZ` | no | `Europe/Rome` | Fuso di log e backup |

`MEALY_IMAGE` non sta nel file: la esporta `scripts/compose-prod.sh`.

### Scelte e motivi

- **Interpolazione da `--env-file`, non `env_file`** (P12): ogni servizio riceve solo le variabili elencate per lui. Il database non vede le chiavi LLM, e una variabile obbligatoria vuota ferma `docker compose` con un messaggio (`Imposta POSTGRES_PASSWORD in .env.production`, `Imposta LLM_MODEL in .env.production`, `Imposta MEALY_IMAGE oppure usa scripts/compose-prod.sh`). Il rovescio: **una variabile nuova per l'app va aggiunta all'elenco `environment`**, altrimenti non arriva al container.
- **Nessun limite di memoria** (P12): un limite che uccide l'app durante una generazione farebbe più danno di nessun limite.
- **`TZ` tocca solo log e backup.** La logica dell'app usa un fuso esplicito, `APP_TIME_ZONE = 'Europe/Rome'` ([[planner]]).
- **`depends_on` non basta dopo un riavvio dell'host**: Docker riavvia i container senza rispettarlo. Per questo il bootstrap ritenta la connessione ([[db-bootstrap]]).
- **Rete**: l'app è pubblicata su tutte le interfacce dell'host, in HTTP, senza TLS e senza login. Il perimetro è la rete (LAN e Tailscale sull'host); le porte pubblicate da Docker non passano da `ufw`. La decisione e le avvertenze sono in [[e6-deploy]] e in `docs/DEPLOY.md §1`.

## File di Contorno

- **`.gitattributes`**: `*.sh text eol=lf`. Gli script girano in container Linux e sul Raspberry: uno script con fine riga CRLF montato nel container fallirebbe (requirements P19).
- **`.gitignore`**: `!.env.production.example` (la regola `.env.*` lo avrebbe ignorato), `backups/` (cartella di default dei dump), `.smoke/` (cartella temporanea di `smoke-prod.sh`).
- **`.env.production.example`**: le stesse variabili della tabella sopra, con le facoltative commentate ai valori di default.

## Verifiche

`Dockerfile` e compose non hanno test Vitest. Li prova `scripts/smoke-prod.sh`, che avvia **questo stesso file compose** con un progetto a parte (`mealy-smoke`) e controlla avvio, migrazioni, alias, assenza di ricette, pagina iniziale, backup con rotazione e riavvio ([[deploy-scripts]]). Lo smoke gira in locale, nel job `image` del gate e nel workflow `Image` ([[ci-workflows]]).

Verificato in locale su amd64. L'immagine arm64 l'ha costruita e provata il workflow `Image` il 12 ottobre 2026 (`SMOKE OK` sul runner arm64). **Non ancora verificato**: lo stack sul Raspberry, compreso il comportamento dopo un riavvio dell'host.

## Vedi anche

- [[e6-deploy]] — Panoramica della Feature 7 e decisione "senza autenticazione"
- [[db-bootstrap]] — Cosa fa l'app all'avvio con `DB_BOOTSTRAP_ON_START=true`
- [[health-check]] — Rotta usata dall'healthcheck del servizio `app`
- [[backup-service]] — Script del servizio `backup`
- [[deploy-scripts]] — `compose-prod.sh`, `deploy.sh`, `smoke-prod.sh`
- [[ci-workflows]] — Dove l'immagine viene costruita e pubblicata
- [[llm-adapter]] — Variabili `LLM_*` e provider
- [[database-architecture]] — Ambienti del database
