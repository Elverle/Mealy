---
title: Bootstrap del Database all'Avvio — register e runDbBootstrap (db-bootstrap)
type: entity
created: 2026-10-11
updated: 2026-10-21
tags: [database, bootstrap, migrations, drizzle, instrumentation, startup, aliases, production, deploy, classification, feature-7, feature-8]
---

## File e Responsabilità

- **Percorsi file**:
  - `instrumentation.ts` (radice del repository, accanto a `next.config.ts`): hook di avvio di Next.js. Esporta `register()`, che gira una volta prima che il server accetti richieste.
  - `lib/db/bootstrap.ts`: `runDbBootstrap`, che aspetta Postgres, applica le migrazioni mancanti e carica gli alias degli ingredienti.
- **Scopo**: far sì che in produzione il database si prepari da solo. Sul Raspberry non gira nessun comando `pnpm` e l'immagine non contiene `drizzle-kit` né `tsx` (requirements P4 della Feature 7): le migrazioni le applica l'app, con il migratore di `drizzle-orm`.
- **Dove è attivo**: solo in produzione. In sviluppo e nei test `register()` non fa nulla e restano `pnpm db:migrate` e `pnpm db:seed`.

## Attivazione (`instrumentation.ts`)

```ts
export async function register(): Promise<void>;
```

Il bootstrap parte solo se valgono **entrambe** le condizioni:

| Condizione | Chi la soddisfa |
|---|---|
| `process.env.NEXT_RUNTIME === 'nodejs'` | Il runtime Node di Next.js (non quello edge) |
| `process.env.DB_BOOTSTRAP_ON_START === 'true'` | Solo `docker-compose.prod.yml`, nel servizio `app` ([[production-stack]]) |

Il confronto è esatto: `''`, `'false'`, `'1'` e `'TRUE'` non attivano nulla. Il modulo `lib/db/bootstrap.ts` è importato in modo dinamico dentro la condizione, quindi fuori dalla produzione non viene nemmeno caricato.

Esito:
- riuscito: una riga di log `[bootstrap] migrazioni applicate; alias inseriti o aggiornati: <n>`. Il testo è un contratto: `scripts/smoke-prod.sh` cerca `alias inseriti o aggiornati: 0` dopo un riavvio ([[deploy-scripts]]);
- fallito: `console.error('[bootstrap] avvio interrotto: migrazioni o alias non applicati', err)` e poi `process.exit(1)`. Il container esce, `restart: unless-stopped` lo fa ripartire e `deploy.sh` vede uno stack che non diventa sano.

Finché `register()` non ha finito, il server non risponde: le richieste restano in attesa. È stato verificato sul prototipo di planning (requirements §5) ed è ciò che la spec chiede (migrazioni applicate prima di accettare traffico).

### Classificazione in background (Feature 8)

Dopo un bootstrap riuscito, e dopo la riga `[bootstrap] …`, `register()` importa in modo dinamico `./lib/recipes/classify` e lancia `classifyPendingRecipes()` **senza aspettarla** (`void … .catch(…)`). L'attesa delle richieste resta legata al solo bootstrap: la classificazione non allunga la partenza né la prima risposta. Un suo errore, anche nell'import, scrive `[classify] classificazione interrotta` con l'errore e non chiama `process.exit`. Se il bootstrap fallisce, la classificazione non parte. Le righe `[classify]` e il resto del comportamento sono in [[recipe-classification]].

Da qui l'hook di avvio carica anche `@/lib/db`, il pool delle rotte. Il bootstrap continua a usare la sua connessione e a chiuderla (v. sotto); la classificazione usa invece il pool dell'app, che dalla Feature 8 è un singleton per processo anche in produzione ([[database-architecture]]).

## `runDbBootstrap` (`lib/db/bootstrap.ts`)

```ts
export interface DbBootstrapOptions {
  connectionString?: string; // default: process.env.DATABASE_URL, poi l'URL di sviluppo
  migrationsFolder?: string; // default: <cwd>/lib/db/migrations
  attempts?: number;         // default 30
  delayMs?: number;          // default 2000
}

export interface DbBootstrapReport {
  aliasesWritten: number;    // alias inseriti o corretti da questo avvio (0 se già allineati)
}

export async function runDbBootstrap(options?: DbBootstrapOptions): Promise<DbBootstrapReport>;
```

Tre passi, nell'ordine:

1. **Attesa del database.** Esegue `select 1`; se fallisce, scrive `[bootstrap] database non ancora pronto (tentativo <n>/<totale>)`, aspetta `delayMs` e riprova. All'ultimo tentativo rilancia l'errore di connessione.
2. **Migrazioni.** `migrate(drizzle(sql, { schema }), { migrationsFolder })` da `drizzle-orm/postgres-js/migrator`.
3. **Alias.** `seedIngredientAliases(bootstrapDb)` di [[fixtures-and-seed]]; il numero restituito diventa `aliasesWritten`.

La funzione è idempotente: su un database già allineato non applica migrazioni e scrive 0 alias.

### Connessione propria

Il bootstrap **non usa il pool dell'app** (`client` di `lib/db/index.ts`): apre una connessione sua e la chiude nel `finally` con `sql.end({ timeout: 5 })`.

```ts
postgres(connectionString, {
  max: 1,
  connect_timeout: 5,   // secondi
  backoff: () => 0,
  onnotice: () => {},
});
```

- `backoff: () => 0` disattiva l'attesa crescente che postgres-js inserisce da solo dopo ogni connessione fallita (fino a 20 s): il ritmo dei tentativi lo decide soltanto `delayMs`. Con il valore predefinito i 30 tentativi "ogni 2 s" sarebbero diventati 6–7 minuti (requirements C3).
- Con i default l'attesa massima è di circa un minuto quando la connessione viene rifiutata subito (29 pause da 2 s); di più se ogni tentativo arriva al limite di 5 s di `connect_timeout`.
- `connectionString` usa `process.env.DATABASE_URL || <URL di sviluppo>`: una variabile vuota vale come assente, come in `lib/db/index.ts`. Se in produzione la variabile mancasse, il bootstrap proverebbe `localhost` invece di fermarsi con un messaggio; il compose la imposta sempre.

### Perché l'attesa

Con `docker compose up` il servizio `app` parte dopo che `db` è sano (`depends_on` con `condition: service_healthy`). Dopo un riavvio dell'host, però, Docker riavvia i container senza rispettare `depends_on`: l'app può partire prima di Postgres (requirements P6). I ritentativi coprono quel caso; se non bastano, l'uscita con codice 1 lascia a Docker il riavvio.

### Migrazioni: cosa fa il migratore

- **Stessa tabella di `drizzle-kit migrate`**: `drizzle.__drizzle_migrations` (requirements P5). Su un database migrato in sviluppo con `pnpm db:migrate` il migratore non applica nulla.
- **Decide per orario, non per elenco.** Legge solo l'ultima riga della tabella e applica le migrazioni il cui `when` nel journal (`lib/db/migrations/meta/_journal.json`) è più grande. Non confronta l'elenco né gli hash (review architetturale, P1). Due conseguenze:
  - una voce del journal con un `when` più vecchio dell'ultima applicata verrebbe **saltata in silenzio**;
  - una migrazione modificata dopo essere stata applicata non viene rieseguita.

  Da qui la regola di `docs/DEPLOY.md §10`: **una migrazione arrivata su `main` non si modifica, se ne aggiunge una nuova.**
- **Una transazione per tutte le migrazioni in attesa.** Una migrazione che fallisce non lascia il database a metà: si può tornare alla versione precedente dell'immagine senza ripristinare nulla (review architetturale, R3).
- **Gli alias vengono dopo, fuori da quella transazione.** Se fallisce il caricamento degli alias le migrazioni sono già applicate: per tornare indietro serve anche il dump `predeploy` (`docs/DEPLOY.md §9`).
- **La cartella delle migrazioni non fa parte del bundle.** Il migratore legge i file SQL dal disco, in `<cwd>/lib/db/migrations`: il `Dockerfile` li copia nell'immagine con una riga dedicata ([[production-stack]]). Se la cartella manca, `runDbBootstrap` fallisce con un errore che cita `_journal.json`.
- **`pg_trgm`** in produzione nasce dalla migrazione `0000` (`CREATE EXTENSION IF NOT EXISTS pg_trgm`): lo script `docker/init-db.sql` serve solo al Postgres di sviluppo ([[database-architecture]]).

### Cosa non fa

- Non inserisce ricette né l'household: `seedDatabase` non viene chiamata. Il modulo `seed-core.ts` che il bootstrap importa contiene però anche quella funzione e, tramite `@/fixtures`, porta con sé le ricette di `fixtures/recipes.json`, validate con Zod a ogni avvio. La regola "le ricette di esempio non entrano in produzione" è controllata dallo smoke, che fallisce se trova ricette nel database ([[deploy-scripts]]).
- Non riporta indietro una migrazione e non fa backup: il dump prima del cambio di immagine è compito di `deploy.sh`.

## Test

- `tests/instrumentation.test.ts` (`runDbBootstrap` mockato): nessuna chiamata fuori dal runtime `nodejs`; nessuna chiamata con `DB_BOOTSTRAP_ON_START` uguale a `''`, `'false'`, `'1'`, `'TRUE'`; con le due condizioni vere una sola chiamata, senza argomenti, e la riga di log con il conteggio; in caso d'errore il log con l'errore originale e `process.exit(1)`. Dalla Feature 8 anche `classifyPendingRecipes` è mockato: una sola classificazione dopo un bootstrap riuscito, avvio che non la aspetta, errore scritto nel log senza uscire, nessuna classificazione se il bootstrap fallisce o fuori dal bootstrap di produzione.
- `tests/db/bootstrap.test.ts`:
  - **journal** (senza database): `idx` consecutivi, `when` strettamente crescente, e corrispondenza nei due sensi tra le voci e i file `.sql` della cartella (un file assente dal journal non verrebbe mai applicato);
  - **database irraggiungibile** (`127.0.0.1:1`): con `attempts: 2` rinuncia e rilancia, con una sola riga di log; con `attempts: 8, delayMs: 10` finisce in meno di 10 s, cosa che con l'attesa crescente di postgres-js non accadrebbe;
  - **database già allineato** (DB reale, saltato se Postgres non risponde): due esecuzioni di fila, la seconda restituisce `{ aliasesWritten: 0 }` e il numero di migrazioni non cambia; cartella delle migrazioni inesistente → errore su `_journal.json`. Prima di cominciare il test si ferma con `Database di sviluppo non allineato: esegui \`pnpm db:migrate\` prima dei test.` se il database è indietro: così non migra mai da solo il database condiviso con gli altri file di test;
  - **database fermo alla migrazione precedente**: crea un database usa-e-getta (`mealy_bootstrap_<pid>_<timestamp>`), lo migra con una copia della cartella a cui è stata tolta l'ultima voce del journal, poi chiama `runDbBootstrap`. Le migrazioni diventano tutte, gli alias scritti sono quelli delle fixture. Il database viene eliminato alla fine. È il percorso che ogni nuova migrazione farà sul Raspberry (requirements C5).

Non coperto da test: l'attesa delle richieste durante il bootstrap (verificata solo sul prototipo) e il ramo d'errore del controllo "database non allineato".

## Vedi anche

- [[e6-deploy]] — Panoramica della Feature 7
- [[fixtures-and-seed]] — `seedIngredientAliases`, l'upsert chiamato dal bootstrap
- [[production-stack]] — `DB_BOOTSTRAP_ON_START` nel compose e copia delle migrazioni nell'immagine
- [[deploy-scripts]] — `deploy.sh` (dump prima delle migrazioni) e `smoke-prod.sh` (bootstrap idempotente)
- [[health-check]] — Cosa vede il controllo di salute dopo il bootstrap
- [[database-architecture]] — Flusso delle migrazioni in sviluppo e in produzione
- [[database-schema]] — Migrazioni `0000`–`0005`
- [[recipe-classification]] — Classificazione lanciata dopo il bootstrap (Feature 8)
