# Feature 7 — E6 Deploy (Raspberry Pi + Tailscale) · Piano di implementazione

**Data:** 2026-10-09 · **Stato:** planned · **Input di:** `/arch-review 7`, poi `/feature-dev 7`
**Story:** `docs/BACKLOG.md` S6.1 · **Spec:** `spec.md` · **Decisioni e motivi:** `requirements.md` (stessa cartella)
**Aggiornato:** 2026-10-11 con le correzioni di [`architecture-review-2026-10-11.md`](architecture-review-2026-10-11.md): elenco in fondo, sezione "Correzioni dalla architecture review".

---

## 0. Contesto per chi implementa (leggere tutto prima del proprio WP)

### 0.1 Obiettivo

Portare Mealy in produzione su un Raspberry Pi 4 (2 GB) con Docker Compose: un'immagine dell'app costruita da GitHub Actions e pubblicata su GHCR, PostgreSQL 16 con volume persistente, backup notturno, migrazioni applicate da sole all'avvio, uno script di aggiornamento a comando singolo e la guida per l'utente. Nessuna autenticazione: l'accesso è protetto dalla rete (LAN + Tailscale).

Il Raspberry **non** costruisce nulla e **non** esegue comandi `pnpm`: scarica l'immagine e la avvia.

### 0.2 Stato del codice su cui si lavora

Base: `main` al commit `9bc43b5`, versione `0.5.1`. Il branch `feature/7-<slug>` va creato da `main`, non dal branch in cui si trova la cartella di lavoro. Fatti verificati, da non rimettere in discussione:

- `next.config.ts` è vuoto (nessuna opzione). Next è `15.5.25`.
- `lib/db/index.ts` esporta `client` (postgres-js), `db` (drizzle), i tipi `Database` e `DbExecutor`, e riesporta lo schema (`ingredient_aliases`, …). Legge `process.env.DATABASE_URL`, con ripiego `postgresql://mealy:mealy@localhost:5432/mealy_dev`.
- `lib/db/seed-core.ts` esporta `seedIngredientAliases(executor: DbExecutor = db): Promise<number>` (oggi `insert … onConflictDoNothing`) e `seedDatabase()`.
- `lib/db/migrations/` contiene 5 migrazioni SQL e `meta/_journal.json`. La prima crea l'estensione `pg_trgm`.
- `lib/http/responses.ts` esporta `errorResponse(status, code, message, details?)`: busta `{ error: { code, message } }`.
- Ogni rotta API dichiara `export const runtime = 'nodejs'` e `export const dynamic = 'force-dynamic'` (es. `app/api/settings/route.ts`).
- `tests/helpers/db.ts` esporta `isDbAvailable()` e `assertDbMigrated()`; i test DB usano `describe.skipIf(!dbUp)` (es. `tests/db/seed.test.ts`).
- Non esistono: `instrumentation.ts`, `Dockerfile`, `.dockerignore`, `.gitattributes`, `docker-compose.prod.yml`, cartella `public/`, cartella `docker/backup/`, `docs/DEPLOY.md`.
- Esistono e **non vanno toccati**: `docker-compose.dev.yml`, `docker/init-db.sql`, `drizzle.config.ts`, `package.json`, `pnpm-lock.yaml`.
- `.gitignore` contiene `.env`, `.env.*`, `!.env.example`: quindi **ogni** file `.env.<qualcosa>` è ignorato, anche `.env.production.example` finché non lo si esclude (lo fa WP3).

### 0.3 Regole vincolanti

1. **I contenuti dei file scritti in questo piano vanno copiati così come sono.** Sono stati costruiti ed eseguiti su un prototipo (build dell'immagine, avvio dello stack, backup, test). Non riformattarli, non rinominare variabili, non "migliorarli", non aggiungere opzioni. Le aggiunte della review del 2026-10-11 non sono passate dal prototipo: sono elencate in fondo al piano, vanno copiate allo stesso modo e le conferma il gate del WP che le contiene. Le correzioni della code review dell'11 ottobre sono arrivate dopo i sei WP: i blocchi di questo piano sono stati riallineati ai file corretti, e la tabella in fondo dice come ciascuna è stata provata.
2. **Nessuna dipendenza nuova**: non eseguire `pnpm add`, non modificare `package.json` né `pnpm-lock.yaml`.
3. **Fine riga LF** per tutti i file `.sh`. Dopo averli scritti, controllare con `tr -cd '\r' < <file> | wc -c`: deve stampare `0`. Se stampa altro, riscrivere il file con fine riga LF. (Non usare `grep -c $'\r'`: nel Git Bash di questa macchina stampa `0` anche su un file CRLF.)
4. **Script sempre lanciati con l'interprete**: `bash scripts/….sh`, `sh /opt/backup/….sh`. Non contare sul bit di esecuzione.
5. Ambiente di sviluppo: Windows con Git Bash. I comandi di questo piano vanno lanciati in **Git Bash**, dalla radice del repo.
6. Il Postgres di sviluppo è il container `mealy-postgres-dev` sulla porta 5432. **Non fermare, riavviare o rimuovere** quel container né altri container che non siano stati creati dal proprio WP. Se `pnpm test` salta i test DB perché il database non risponde, segnalarlo nel resoconto: non è un esito verde.
7. `pnpm test` non legge `.env`: usa il ripiego di `lib/db/index.ts` oppure `DATABASE_URL` della shell.
8. Codice e identificatori in inglese; commenti, messaggi di log, testi per l'utente e documentazione in italiano (come nei file esistenti).
9. Non fare commit, non creare branch, non fare push: ci pensa l'orchestratore.
10. Ogni WP tocca **solo** i file elencati nella sua sezione "File".
11. Gate di verifica: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, tutti verdi.
12. **Il gate non si lancia mentre gira un `docker build` o lo smoke**, né propri né di un altro WP: sotto carico la suite ha test sensibili ai tempi. L'11 ottobre, sul codice di `main`, sono falliti a tratti `tests/plans/service.test.ts` (timeout) e `tests/ui/ingredient-prefs-section.test.tsx` (`toHaveFocus`), entrambi verdi da soli. Un test che fallisce solo nella suite completa si rilancia da solo (`pnpm exec vitest run <file>`) e poi si rilancia la suite: è una regressione solo se fallisce anche così. Non si modifica un test per farlo passare.
13. Prima di cominciare (orchestratore): `docker ps` deve mostrare `mealy-postgres-dev` acceso sulla 5432, e la porta 3100 deve essere libera per lo smoke. Se il container è spento, chiedere all'utente prima di avviarlo.

### 0.4 Contratti trasversali (nomi fissi, usati da più WP)

| Nome | Valore | Chi lo definisce | Chi lo usa |
|---|---|---|---|
| Variabile `DB_BOOTSTRAP_ON_START` | il bootstrap gira solo se vale esattamente `true` | WP1 | WP3 (compose) |
| Variabile `NEXT_OUTPUT` | `standalone` attiva l'output standalone | WP3 | WP3 (Dockerfile) |
| Log di fine bootstrap | `[bootstrap] migrazioni applicate; alias inseriti o aggiornati: <n>` | WP1 | WP6 (lo smoke cerca `alias inseriti o aggiornati: 0`) |
| `GET /api/health` | 200, corpo esatto `{"status":"ok"}`; 503 se il DB non risponde | WP2 | WP3 (healthcheck), WP6 (script) |
| Immagine di produzione | `ghcr.io/elverle/mealy:sha-<sha completo del commit>` (tutto minuscolo) | WP4 (la pubblica) | WP6 (`compose-prod.sh` la ricava) |
| Immagine di prova locale | `mealy-app:smoke` | WP3, WP4, WP6 | — |
| Variabile `MEALY_IMAGE` | immagine usata dal servizio `app` | WP3 (compose) | WP6 (script), WP4 |
| Variabile `MEALY_ENV_FILE` | file d'ambiente passato a compose; default `.env.production` | WP6 | WP6, WP5 (guida) |
| Variabile `SMOKE_PORT` | porta host dello smoke; default `3100` | WP6 | WP4, WP5 |
| Servizi compose | `db`, `app`, `backup` | WP3 | WP6, WP5 |
| Progetti compose | `mealy-prod` (produzione), `mealy-smoke` (prova) | WP3, WP6 | WP5 |
| Percorsi nel container `backup` | script in `/opt/backup/`, dump in `/backups/` | WP3 | WP6, WP5 |
| Nome dei dump | `mealy-<etichetta>-<AAAAMMGG-HHMMSS>.sql.gz`; etichette `daily`, `predeploy`, `manual` | WP3 | WP6, WP5 |
| Script | `scripts/compose-prod.sh`, `scripts/deploy.sh [--no-pull]`, `scripts/smoke-prod.sh <immagine>` | WP6 | WP4, WP5 |

### 0.5 Mappa dei work package

| WP | Titolo | Wave | In parallelo con |
|---|---|---|---|
| WP1 | Bootstrap del database all'avvio e alias in upsert | 1 | WP2 |
| WP2 | Endpoint di salute | 1 | WP1 |
| WP3 | Immagine Docker, stack di produzione e backup | 2 | WP4, WP5 |
| WP4 | CI: job `image` nel gate e workflow `Image` | 2 | WP3, WP5 |
| WP5 | Guida di deploy e allineamento dei documenti | 2 | WP3, WP4 |
| WP6 | Script operativi e prova dello stack | 3 | — |

---

## WP1 — Bootstrap del database all'avvio e alias in upsert (wave 1, parallelo a WP2)

**Obiettivo:** in produzione l'app, prima di servire richieste, applica le migrazioni mancanti e allinea gli alias degli ingredienti; il caricamento degli alias corregge anche quelli già presenti.

### File

- creare `lib/db/bootstrap.ts`
- creare `instrumentation.ts` (nella **radice** del repo, accanto a `next.config.ts`)
- modificare `lib/db/seed-core.ts`
- modificare `lib/db/seed-aliases.ts`
- modificare `lib/db/seed.ts`
- creare `tests/db/bootstrap.test.ts`
- creare `tests/instrumentation.test.ts`
- modificare `tests/db/seed.test.ts`
- modificare `tests/plans/service.test.ts` (solo il limite di tempo, passo 9)
- modificare `lib/domain/types.ts` e `tests/domain/generation-contracts.test.ts` (alias unici, passo 10, dalla code review)

### Pattern di riferimento

- Connessione e drizzle: `lib/db/index.ts`.
- Test DB con salto se il database non risponde: `tests/db/seed.test.ts` (`isDbAvailable`, `describe.skipIf(!dbUp)`, `assertDbMigrated`).
- Test con mock di modulo: `tests/api/settings.test.ts`.

### Passi

**1. Creare `lib/db/bootstrap.ts`** con questo contenuto esatto:

```ts
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from './schema';
import { seedIngredientAliases } from './seed-core';

const DEFAULT_CONNECTION_STRING = 'postgresql://mealy:mealy@localhost:5432/mealy_dev';
const DEFAULT_ATTEMPTS = 30;
const DEFAULT_DELAY_MS = 2000;
const CONNECT_TIMEOUT_SECONDS = 5;

export interface DbBootstrapOptions {
  /** Default: `process.env.DATABASE_URL`, poi l'URL di sviluppo. */
  connectionString?: string;
  /** Default: `<cwd>/lib/db/migrations`. */
  migrationsFolder?: string;
  /** Tentativi di connessione prima di rinunciare. Default 30. */
  attempts?: number;
  /** Attesa tra due tentativi, in millisecondi. Default 2000. */
  delayMs?: number;
}

export interface DbBootstrapReport {
  /** Alias inseriti o corretti da questo avvio (0 se erano già allineati). */
  aliasesWritten: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Prepara il database all'avvio in produzione: aspetta che Postgres risponda, applica le
 * migrazioni mancanti e carica gli alias degli ingredienti. Idempotente. Usa una connessione
 * propria, chiusa alla fine: non tocca il pool dell'app (`lib/db/index.ts`).
 */
export async function runDbBootstrap(options: DbBootstrapOptions = {}): Promise<DbBootstrapReport> {
  const connectionString =
    options.connectionString ?? (process.env.DATABASE_URL || DEFAULT_CONNECTION_STRING);
  const migrationsFolder =
    options.migrationsFolder ?? path.join(process.cwd(), 'lib', 'db', 'migrations');
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;

  const sql = postgres(connectionString, {
    max: 1,
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    // Dopo ogni connessione fallita postgres-js allunga da solo l'attesa prima della successiva,
    // fino a 20 secondi: qui il ritmo dei tentativi lo decide soltanto `delayMs`.
    backoff: () => 0,
    onnotice: () => {},
  });

  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await sql`select 1`;
        break;
      } catch (err) {
        if (attempt >= attempts) throw err;
        console.log(`[bootstrap] database non ancora pronto (tentativo ${attempt}/${attempts})`);
        await sleep(delayMs);
      }
    }

    const bootstrapDb = drizzle(sql, { schema });
    await migrate(bootstrapDb, { migrationsFolder });
    const aliasesWritten = await seedIngredientAliases(bootstrapDb);
    return { aliasesWritten };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
```

Regole incorporate nel codice, da non cambiare:
- il log "non ancora pronto" esce a ogni tentativo fallito **tranne l'ultimo** (con `attempts: 2` esce una volta sola, con `tentativo 1/2`);
- esauriti i tentativi, la funzione rilancia l'errore di connessione originale;
- un errore di `migrate` o di `seedIngredientAliases` risale al chiamante senza essere catturato;
- la connessione viene chiusa sempre, anche in caso di errore;
- l'attesa crescente che postgres-js mette da solo dopo ogni connessione fallita è disattivata (`backoff: () => 0`): con il valore predefinito trenta tentativi "ogni 2 secondi" durano sei o sette minuti (code review);
- una `DATABASE_URL` vuota vale come assente (`||`, come in `lib/db/index.ts`). Le parentesi sono obbligatorie: in JavaScript `??` e `||` non si possono mescolare senza.

**2. Creare `instrumentation.ts`** nella radice del repo, con questo contenuto esatto:

```ts
// Hook di avvio di Next.js: gira una volta, prima che il server accetti richieste.
// In produzione (DB_BOOTSTRAP_ON_START=true, v. docker-compose.prod.yml) applica le migrazioni
// e carica gli alias degli ingredienti. In sviluppo e nei test non fa nulla: lì restano
// `pnpm db:migrate` e `pnpm db:seed`.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DB_BOOTSTRAP_ON_START === 'true') {
    const { runDbBootstrap } = await import('./lib/db/bootstrap');
    try {
      const report = await runDbBootstrap();
      console.log(
        `[bootstrap] migrazioni applicate; alias inseriti o aggiornati: ${report.aliasesWritten}`
      );
    } catch (err) {
      console.error('[bootstrap] avvio interrotto: migrazioni o alias non applicati', err);
      process.exit(1);
    }
  }
}
```

Note:
- l'import di `./lib/db/bootstrap` deve restare **dinamico e dentro l'`if`**: è il modo documentato da Next per non includere moduli Node nel runtime edge;
- il valore accettato è solo la stringa `true` (non `1`, non `TRUE`);
- non serve alcuna opzione in `next.config.ts`: in Next 15 `instrumentation.ts` è attivo di default.

**3. Modificare `lib/db/seed-core.ts`.**

a) Aggiungere come **prima riga** del file:

```ts
import { sql } from 'drizzle-orm';
```

b) Nell'interfaccia `SeedReport`, sostituire la riga `  aliasesInserted: number;` con:

```ts
  /** Alias inseriti o corretti (v. `seedIngredientAliases`). */
  aliasesInserted: number;
```

c) Sostituire l'intera funzione `seedIngredientAliases` **e il suo commento JSDoc** (la riga `/** Inserisce gli alias delle fixture che mancano … */`) con:

```ts
/**
 * Allinea `ingredient_aliases` alle fixture: inserisce gli alias che mancano e corregge quelli
 * il cui nome canonico è cambiato. Non cancella gli alias tolti dal file. Idempotente; restituisce
 * quante righe ha inserito o corretto (0 se la tabella era già allineata).
 */
export async function seedIngredientAliases(executor: DbExecutor = db): Promise<number> {
  const written = await executor
    .insert(ingredient_aliases)
    .values(FIXTURE_INGREDIENT_ALIASES)
    .onConflictDoUpdate({
      target: ingredient_aliases.alias,
      set: { canonical_name: sql`excluded.canonical_name` },
      setWhere: sql`${ingredient_aliases.canonical_name} is distinct from excluded.canonical_name`,
    })
    .returning({ alias: ingredient_aliases.alias });
  return written.length;
}
```

Il `setWhere` è ciò che mantiene il contratto esistente "la seconda chiamata restituisce 0": le righe già corrette non vengono riscritte e non compaiono in `returning`. Non toglierlo. Il resto del file (`seedDatabase`) non cambia.

**4. Modificare `lib/db/seed-aliases.ts`:** sostituire la riga

```ts
    console.log(`Alias completati — inseriti: ${inserted}`);
```

con

```ts
    console.log(`Alias completati — inseriti o aggiornati: ${inserted}`);
```

**5. Modificare `lib/db/seed.ts`:** nella stringa del `console.log`, sostituire il frammento `alias inseriti: ${report.aliasesInserted}` con `alias inseriti o aggiornati: ${report.aliasesInserted}`. Nient'altro.

**6. Creare `tests/db/bootstrap.test.ts`** con questo contenuto esatto:

```ts
// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { isDbAvailable, assertDbMigrated } from '@/tests/helpers/db';
import { runDbBootstrap } from '@/lib/db/bootstrap';
import { client } from '@/lib/db';
import { FIXTURE_INGREDIENT_ALIASES } from '@/fixtures';

const dbUp = await isDbAvailable();

const MIGRATIONS_FOLDER = path.join(process.cwd(), 'lib', 'db', 'migrations');
// Porta 1: nessun Postgres in ascolto, la connessione viene rifiutata.
const UNREACHABLE_DATABASE = 'postgresql://mealy:mealy@127.0.0.1:1/mealy';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function readJournalEntries(): JournalEntry[] {
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf-8')
  ) as { entries: JournalEntry[] };
  return journal.entries;
}

async function countMigrations(sql: postgres.Sql = client): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from drizzle.__drizzle_migrations
  `;
  return rows[0].n;
}

describe('migrations journal', () => {
  it('lists migrations in strictly increasing order, one entry per SQL file', () => {
    // Il migratore applica solo le migrazioni con `when` maggiore dell'ultima applicata:
    // una voce fuori ordine verrebbe saltata in silenzio su un database già popolato.
    const entries = readJournalEntries();
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
      if (i > 0) expect(entry.when).toBeGreaterThan(entries[i - 1].when);
    });

    // Nei due sensi: un file .sql assente dal journal non verrebbe mai applicato.
    const sqlFiles = fs
      .readdirSync(MIGRATIONS_FOLDER)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.slice(0, -'.sql'.length))
      .sort();
    expect(sqlFiles).toEqual(entries.map((entry) => entry.tag).sort());
  });
});

describe('runDbBootstrap with an unreachable database', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives up after the configured attempts and rethrows the connection error', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      runDbBootstrap({ connectionString: UNREACHABLE_DATABASE, attempts: 2, delayMs: 10 })
    ).rejects.toThrow();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[bootstrap] database non ancora pronto (tentativo 1/2)');
  }, 30_000);

  it('paces the attempts with delayMs alone', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const startedAt = Date.now();

    await expect(
      runDbBootstrap({ connectionString: UNREACHABLE_DATABASE, attempts: 8, delayMs: 10 })
    ).rejects.toThrow();

    // Con l'attesa crescente di postgres-js otto tentativi richiedono più di 15 secondi.
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 30_000);
});

describe.skipIf(!dbUp)('runDbBootstrap on a migrated database', () => {
  beforeAll(async () => {
    await assertDbMigrated();
    // Su un database indietro di una migrazione runDbBootstrap la applicherebbe davvero, sotto
    // gli altri file di test in esecuzione: meglio fermarsi qui con un messaggio chiaro.
    if ((await countMigrations()) !== readJournalEntries().length) {
      throw new Error(
        'Database di sviluppo non allineato: esegui `pnpm db:migrate` prima dei test.'
      );
    }
  });

  it('applies nothing new and is idempotent', async () => {
    const migrationsBefore = await countMigrations();

    await runDbBootstrap({ attempts: 1 });
    const second = await runDbBootstrap({ attempts: 1 });

    expect(second).toEqual({ aliasesWritten: 0 });
    expect(await countMigrations()).toBe(migrationsBefore);
  });

  it('rejects when the migrations folder does not exist', async () => {
    await expect(
      runDbBootstrap({ attempts: 1, migrationsFolder: '/cartella/che/non/esiste' })
    ).rejects.toThrow(/_journal\.json/);
  });
});

describe.skipIf(!dbUp)('runDbBootstrap on a database one migration behind', () => {
  // Database usa-e-getta: quello di sviluppo, usato dagli altri file di test, non viene toccato.
  const databaseName = `mealy_bootstrap_${process.pid}_${Date.now()}`;
  const url = new URL(
    process.env.DATABASE_URL || 'postgresql://mealy:mealy@localhost:5432/mealy_dev'
  );
  url.pathname = `/${databaseName}`;
  const connectionString = url.toString();

  let scratch: postgres.Sql | undefined;
  let previousReleaseFolder: string | undefined;

  beforeAll(async () => {
    await client.unsafe(`create database "${databaseName}"`);
    scratch = postgres(connectionString, { max: 1, onnotice: () => {} });

    // Le migrazioni com'erano al rilascio precedente: il journal senza l'ultima voce.
    previousReleaseFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'mealy-migrations-'));
    fs.cpSync(MIGRATIONS_FOLDER, previousReleaseFolder, { recursive: true });
    const journalPath = path.join(previousReleaseFolder, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as {
      entries: JournalEntry[];
    };
    journal.entries.pop();
    fs.writeFileSync(journalPath, JSON.stringify(journal));
  }, 30_000);

  afterAll(async () => {
    await scratch?.end({ timeout: 5 });
    await client.unsafe(`drop database if exists "${databaseName}" with (force)`);
    if (previousReleaseFolder) fs.rmSync(previousReleaseFolder, { recursive: true, force: true });
  }, 30_000);

  it('applies the missing migration and loads the aliases', async () => {
    const total = readJournalEntries().length;
    await migrate(drizzle(scratch!), { migrationsFolder: previousReleaseFolder! });
    expect(await countMigrations(scratch)).toBe(total - 1);

    const report = await runDbBootstrap({ connectionString, attempts: 1 });

    expect(await countMigrations(scratch)).toBe(total);
    expect(report).toEqual({ aliasesWritten: FIXTURE_INGREDIENT_ALIASES.length });
  }, 30_000);
});
```

Note:
- il `describe` `'migrations journal'` non usa il database: gira sempre. Con il journal di oggi passa (i cinque `when` sono in ordine crescente);
- il controllo nel `beforeAll` fa sì che `pnpm test` non migri mai da solo il database di sviluppo. Oggi il database ha 5 righe in `drizzle.__drizzle_migrations` e il journal 5 voci;
- il controllo del journal vale nei due sensi: ogni voce ha il suo file `.sql` e ogni file `.sql` ha la sua voce (code review);
- `'paces the attempts with delayMs alone'` fallisce se si toglie `backoff: () => 0` da `bootstrap.ts` (provato: 25,8 s contro il limite di 10);
- il `describe` `'runDbBootstrap on a database one migration behind'` crea un database usa-e-getta (`mealy_bootstrap_<pid>_<istante>`) accanto a quello di sviluppo, lo porta alla penultima migrazione con una copia della cartella delle migrazioni dal journal accorciato, poi lancia `runDbBootstrap` con la cartella vera. Alla fine cancella database e cartella temporanea. Serve un utente che possa creare database: è così in sviluppo e nel gate (`POSTGRES_USER`). È il percorso che ogni nuova migrazione farà sul Raspberry (code review).

**7. Creare `tests/instrumentation.test.ts`** con questo contenuto esatto:

```ts
// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { register } from '@/instrumentation';
import { runDbBootstrap } from '@/lib/db/bootstrap';

vi.mock('@/lib/db/bootstrap', () => ({
  runDbBootstrap: vi.fn(),
}));

describe('instrumentation register()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does nothing outside the nodejs runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('DB_BOOTSTRAP_ON_START', 'true');

    await register();

    expect(runDbBootstrap).not.toHaveBeenCalled();
  });

  it.each(['', 'false', '1', 'TRUE'])(
    'does nothing when DB_BOOTSTRAP_ON_START is "%s"',
    async (value) => {
      vi.stubEnv('NEXT_RUNTIME', 'nodejs');
      vi.stubEnv('DB_BOOTSTRAP_ON_START', value);

      await register();

      expect(runDbBootstrap).not.toHaveBeenCalled();
    }
  );

  it('runs the bootstrap once and logs the outcome when enabled', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DB_BOOTSTRAP_ON_START', 'true');
    vi.mocked(runDbBootstrap).mockResolvedValueOnce({ aliasesWritten: 3 });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await register();

    expect(runDbBootstrap).toHaveBeenCalledTimes(1);
    expect(runDbBootstrap).toHaveBeenCalledWith();
    expect(log).toHaveBeenCalledWith(
      '[bootstrap] migrazioni applicate; alias inseriti o aggiornati: 3'
    );
  });

  it('logs the error and exits with code 1 when the bootstrap fails', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DB_BOOTSTRAP_ON_START', 'true');
    const failure = new Error('boom');
    vi.mocked(runDbBootstrap).mockRejectedValueOnce(failure);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await register();

    expect(error).toHaveBeenCalledWith(
      '[bootstrap] avvio interrotto: migrazioni o alias non applicati',
      failure
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});
```

**8. Modificare `tests/db/seed.test.ts`:** aggiungere questo test come **ultimo `it`** del `describe` esistente, cioè subito dopo la chiusura `});` del test `'seedIngredientAliases is idempotent and inserts no recipes'` e prima della `});` finale del file. Gli import necessari (`db`, `ingredient_aliases`, `eq`, `FIXTURE_INGREDIENT_ALIASES`, `seedIngredientAliases`) sono già presenti nel file.

```ts

  it('seedIngredientAliases corrects an alias whose canonical name changed', async () => {
    // In una transazione annullata alla fine: la riga sbagliata non è mai visibile agli altri test.
    const target = FIXTURE_INGREDIENT_ALIASES[0];
    class Rollback extends Error {}
    let written: number | undefined;
    let canonicalAfter: string | undefined;

    await expect(
      db.transaction(async (tx) => {
        await seedIngredientAliases(tx);
        await tx
          .update(ingredient_aliases)
          .set({ canonical_name: 'nome canonico sbagliato di prova' })
          .where(eq(ingredient_aliases.alias, target.alias));

        written = await seedIngredientAliases(tx);
        const row = await tx.query.ingredient_aliases.findFirst({
          where: eq(ingredient_aliases.alias, target.alias),
        });
        canonicalAfter = row?.canonical_name;
        throw new Rollback();
      })
    ).rejects.toBeInstanceOf(Rollback);

    expect(written).toBe(1);
    expect(canonicalAfter).toBe(target.canonical_name);
  });
```

Gli altri test del file non vanno modificati: restano validi (in particolare `secondReport.aliasesInserted` resta `0` e la seconda chiamata di `seedIngredientAliases` resta `0`).

**9. Modificare `tests/plans/service.test.ts`:** subito dopo l'ultima riga di import (`import { insertTestRecipes } from '@/tests/helpers/plans';`) aggiungere una riga vuota e queste tre righe:

```ts
// Questo file fa più generazioni di piano per test sul database: nella suite completa, con i
// file in parallelo, i 5 s di default di Vitest non bastano sempre.
vi.setConfig({ testTimeout: 15_000 });
```

`vi` è già importato alla riga 3. Nient'altro in quel file: nessun test va toccato. Motivo: l'11 ottobre, sul codice di `main`, la suite completa ha dato un `Test timed out in 5000ms` a macchina scarica (`:382`, 5250 ms) e undici sotto carico, mentre il file da solo passa 30/30. Con le tre righe, una copia del file ha passato 30/30 dentro una suite completa lenta (125 s).

**10. (dalla code review) Alias unici nelle fixture.** In `lib/domain/types.ts`, `IngredientAliasesFileSchema` diventa:

```ts
export const IngredientAliasesFileSchema = z.object({
  aliases: z
    .array(IngredientAliasSchema)
    .min(15)
    // Il seed carica gli alias con un solo INSERT … ON CONFLICT DO UPDATE: Postgres lo rifiuta
    // se la stessa chiave compare due volte, e in produzione l'app non partirebbe.
    .refine((aliases) => new Set(aliases.map((a) => a.alias)).size === aliases.length, {
      message: 'Lo stesso alias compare più di una volta.',
    }),
});
```

In `tests/domain/generation-contracts.test.ts`, subito dopo il test `'validates IngredientAliasesFileSchema requiring at least 15 aliases'`, si aggiunge:

```ts
    it('rejects IngredientAliasesFileSchema when the same alias appears twice', () => {
      const aliases = Array.from({ length: 15 }, (_, i) => ({
        alias: `alias_${i}`,
        canonical_name: `name_${i}`,
      }));
      // Stesso alias e stesso nome canonico: il seed fallirebbe comunque (v. types.ts).
      const withDuplicate = [...aliases, { ...aliases[0] }];

      const result = IngredientAliasesFileSchema.safeParse({ aliases: withDuplicate });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe('Lo stesso alias compare più di una volta.');
    });
```

Motivo: con `onConflictDoUpdate` Postgres rifiuta un `INSERT` che contiene due volte la stessa chiave (errore 21000), e in produzione l'app non partirebbe. Lo schema ferma il duplicato al caricamento delle fixture, con un messaggio leggibile.

### Contratti esposti

- `runDbBootstrap(options?: DbBootstrapOptions): Promise<DbBootstrapReport>` da `@/lib/db/bootstrap`, con `DbBootstrapReport = { aliasesWritten: number }`.
- `register(): Promise<void>` da `instrumentation.ts`; attivo solo con `NEXT_RUNTIME === 'nodejs'` e `DB_BOOTSTRAP_ON_START === 'true'`.
- Riga di log `[bootstrap] migrazioni applicate; alias inseriti o aggiornati: <n>` (lo smoke di WP6 cerca il testo `alias inseriti o aggiornati: 0`).
- `seedIngredientAliases(executor?)`: firma invariata; ora inserisce **e corregge**; restituisce le righe scritte.

### Dipendenze

Nessuna.

### Criteri di accettazione

- `pnpm exec vitest run tests/db/bootstrap.test.ts tests/instrumentation.test.ts tests/db/seed.test.ts` verde, con i test DB **eseguiti** (non saltati).
- `pnpm test` (suite completa, senza altri carichi sulla macchina) non mostra nessun `Test timed out`; `tests/plans/service.test.ts` passa 30/30.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdi.
- Dopo `pnpm build` esiste `.next/server/instrumentation.js`.
- `pnpm dev` e `pnpm test` non eseguono migrazioni da soli (la variabile non è impostata).

### Fuori ambito

- Non toccare `drizzle.config.ts`, lo script `db:migrate`, `lib/db/index.ts`, lo schema, le migrazioni.
- Non cancellare gli alias assenti dalle fixture.
- Non rinominare `aliasesInserted`.
- Non aggiungere il bootstrap a `pnpm dev`, non creare opzioni in `next.config.ts`.
- Non creare household o ricette nel bootstrap.
- In `tests/plans/service.test.ts` si aggiungono solo le tre righe del passo 9.

---

## WP2 — Endpoint di salute (wave 1, parallelo a WP1)

**Obiettivo:** `GET /api/health` dice se l'app risponde e raggiunge il database.

### File

- creare `lib/health/service.ts`
- creare `app/api/health/route.ts`
- creare `tests/health/service.test.ts`
- creare `tests/api/health.test.ts`

### Pattern di riferimento

- Rotta e gestione degli errori: `app/api/settings/route.ts`.
- Busta d'errore: `errorResponse` in `lib/http/responses.ts`.
- Test di rotta con servizio simulato: `tests/api/settings.test.ts`.

### Passi

**1. Creare `lib/health/service.ts`** con questo contenuto esatto:

```ts
import { client } from '@/lib/db';

const DEFAULT_TIMEOUT_MS = 2000;

/** Risolve se il database risponde a `select 1` entro `timeoutMs`; altrimenti lancia. */
export async function checkDatabase(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`database: nessuna risposta in ${timeoutMs} ms`)),
      timeoutMs
    );
  });
  try {
    await Promise.race([client`select 1`, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
```

**2. Creare `app/api/health/route.ts`** con questo contenuto esatto:

```ts
import { errorResponse } from '@/lib/http/responses';
import { checkDatabase } from '@/lib/health/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HTTP_SERVICE_UNAVAILABLE = 503;

export async function GET(): Promise<Response> {
  try {
    await checkDatabase();
    return Response.json({ status: 'ok' }, { status: 200 });
  } catch (err) {
    console.error('[api/health]', err);
    return errorResponse(HTTP_SERVICE_UNAVAILABLE, 'db_unavailable', 'Database non raggiungibile.');
  }
}
```

Il corpo della risposta 200 deve serializzarsi esattamente come `{"status":"ok"}`: gli script di WP6 lo confrontano come stringa. Non aggiungere altri campi (versione, uptime, orario).

**3. Creare `tests/health/service.test.ts`** con questo contenuto esatto. Il mock usa `vi.hoisted` e **non** `vi.mocked(client)`: con il tipo di `client` di postgres-js `vi.mocked` fa fallire `tsc` (errore TS2589).

```ts
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkDatabase } from '@/lib/health/service';

// `client` di postgres-js è una funzione usata come tagged template: qui basta un vi.fn().
const { clientMock } = vi.hoisted(() => ({ clientMock: vi.fn() }));

vi.mock('@/lib/db', () => ({
  client: clientMock,
}));

describe('checkDatabase', () => {
  beforeEach(() => {
    clientMock.mockReset();
  });

  it('resolves when the database answers', async () => {
    clientMock.mockResolvedValueOnce([{ ok: 1 }]);

    await expect(checkDatabase()).resolves.toBeUndefined();
    expect(clientMock).toHaveBeenCalledTimes(1);
  });

  it('rejects with the database error', async () => {
    clientMock.mockRejectedValueOnce(new Error('connection refused'));

    await expect(checkDatabase()).rejects.toThrow('connection refused');
  });

  it('rejects when the database does not answer within the timeout', async () => {
    clientMock.mockReturnValueOnce(new Promise(() => {}));

    await expect(checkDatabase(20)).rejects.toThrow('database: nessuna risposta in 20 ms');
  });
});
```

**4. Creare `tests/api/health.test.ts`** con questo contenuto esatto:

```ts
// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET, runtime, dynamic } from '@/app/api/health/route';
import { checkDatabase } from '@/lib/health/service';

vi.mock('@/lib/health/service', () => ({
  checkDatabase: vi.fn(),
}));

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports correct route segment configurations', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
  });

  it('returns 200 with status ok when the database answers', async () => {
    vi.mocked(checkDatabase).mockResolvedValueOnce(undefined);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('returns 503 db_unavailable without leaking the original error', async () => {
    vi.mocked(checkDatabase).mockRejectedValueOnce(new Error('secret connection string boom'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: { code: 'db_unavailable', message: 'Database non raggiungibile.' },
    });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(error).toHaveBeenCalled();
  });
});
```

### Contratti esposti

- `GET /api/health` → 200 `{"status":"ok"}`; 503 `{"error":{"code":"db_unavailable","message":"Database non raggiungibile."}}`.
- `checkDatabase(timeoutMs?: number): Promise<void>` da `@/lib/health/service`.

### Dipendenze

Nessuna.

### Criteri di accettazione

- `pnpm exec vitest run tests/health/service.test.ts tests/api/health.test.ts` verde.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdi; nell'elenco delle rotte di `pnpm build` compare `ƒ /api/health`.

### Fuori ambito

- Nessun controllo dell'LLM, delle migrazioni o della versione nell'endpoint.
- Nessuna modifica a `lib/http/responses.ts` né al guard di onboarding.
- Nessuna voce di interfaccia: l'endpoint non compare nell'app.

---

## WP3 — Immagine Docker, stack di produzione e backup (wave 2, parallelo a WP4 e WP5)

**Obiettivo:** un'immagine dell'app in modalità standalone e un file compose che avvia app, PostgreSQL e backup notturno.

### File

- modificare `next.config.ts`
- creare `Dockerfile`
- creare `.dockerignore`
- creare `docker-compose.prod.yml`
- creare `docker/backup/entrypoint.sh`
- creare `docker/backup/backup.sh`
- creare `.env.production.example`
- creare `.gitattributes`
- modificare `.gitignore`

### Pattern di riferimento

- Servizio Postgres e nome del volume: `docker-compose.dev.yml`.
- Variabili d'ambiente e stile dei commenti: `.env.example`.

### Passi

**1. Sostituire tutto il contenuto di `next.config.ts`** con:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone solo quando lo chiede il Dockerfile (NEXT_OUTPUT=standalone): la copia dei file
  // tracciati crea symlink, che con pnpm su Windows possono fallire nella build locale.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
};

export default nextConfig;
```

**2. Creare `Dockerfile`** nella radice, con questo contenuto esatto:

```dockerfile
# syntax=docker/dockerfile:1

# Node 24: la stessa versione del gate CI. `ai` 7 richiede Node >= 22.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
RUN apk add --no-cache libc6-compat \
  && npm install -g pnpm@11.14.0
WORKDIR /app

# --- Dipendenze (strato riusato finché non cambia il lockfile) ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# --- Build Next.js in modalità standalone ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT=standalone
RUN pnpm build

# --- Immagine finale: solo l'output standalone ---
FROM node:${NODE_VERSION}-alpine AS runner
LABEL org.opencontainers.image.source="https://github.com/Elverle/Mealy"
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 nodejs \
  && adduser -S -u 1001 -G nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Le migrazioni SQL le legge `lib/db/bootstrap.ts` all'avvio: non fanno parte del bundle.
COPY --from=builder --chown=nextjs:nodejs /app/lib/db/migrations ./lib/db/migrations
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

Note:
- **non** aggiungere `COPY … /app/public`: la cartella `public/` non esiste e la build fallirebbe;
- `HOSTNAME=0.0.0.0` è necessario: senza, il server standalone ascolta sul nome del container e non è raggiungibile dall'esterno;
- la build dell'immagine non ha bisogno del database (solo `/_not-found` è prerenderizzata) ma ha bisogno della rete (pacchetti npm, font di Google).

**3. Creare `.dockerignore`** nella radice, con questo contenuto esatto:

```
.git
.github
.claude
.tokensave
.next
node_modules
docs
tests
backups
.smoke
coverage
*.tsbuildinfo
*.log
.env
.env.*
Dockerfile
.dockerignore
docker-compose.*.yml
```

Le righe `.env` e `.env.*` sono una misura di sicurezza: senza, `next build` leggerebbe `.env.production` e le chiavi finirebbero nell'immagine.

**4. Creare `docker-compose.prod.yml`** nella radice, con questo contenuto esatto:

```yaml
# Stack di produzione (Raspberry Pi). Usalo sempre tramite scripts/compose-prod.sh,
# che passa .env.production e l'immagine corrispondente al commit in uso.
name: mealy-prod

x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: mealy
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Imposta POSTGRES_PASSWORD in .env.production}
      POSTGRES_DB: mealy
      TZ: ${TZ:-Europe/Rome}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mealy -d mealy"]
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 10s
    logging: *default-logging

  app:
    image: ${MEALY_IMAGE:?Imposta MEALY_IMAGE oppure usa scripts/compose-prod.sh}
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "${APP_PORT:-3000}:3000"
    environment:
      DATABASE_URL: postgresql://mealy:${POSTGRES_PASSWORD}@db:5432/mealy
      DB_BOOTSTRAP_ON_START: "true"
      LLM_PROVIDER: ${LLM_PROVIDER:-google}
      LLM_MODEL: ${LLM_MODEL:?Imposta LLM_MODEL in .env.production}
      LLM_TIMEOUT_MS: ${LLM_TIMEOUT_MS:-90000}
      GOOGLE_GENERATIVE_AI_API_KEY: ${GOOGLE_GENERATIVE_AI_API_KEY:-}
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:-}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      LLM_BASE_URL: ${LLM_BASE_URL:-}
      LLM_API_KEY: ${LLM_API_KEY:-}
      TZ: ${TZ:-Europe/Rome}
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 60s
    logging: *default-logging

  backup:
    image: postgres:16-alpine
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      PGHOST: db
      PGUSER: mealy
      PGPASSWORD: ${POSTGRES_PASSWORD}
      PGDATABASE: mealy
      TZ: ${TZ:-Europe/Rome}
      BACKUP_CRON: "${BACKUP_CRON:-0 3 * * *}"
      BACKUP_KEEP: ${BACKUP_KEEP:-7}
    volumes:
      - ./docker/backup:/opt/backup:ro
      - ${BACKUP_DIR:-./backups}:/backups
    entrypoint: ["sh", "/opt/backup/entrypoint.sh"]
    logging: *default-logging

volumes:
  postgres_data:
```

Note:
- il servizio `db` **non** ha `ports`: Postgres è raggiungibile solo dalla rete interna del compose;
- il servizio `app` **non** ha `build`: l'immagine arriva da GHCR o da un `docker build` fatto a parte. Con `build` nel compose, un pull fallito farebbe partire una build sul Raspberry;
- non aggiungere `env_file`, `container_name`, limiti di memoria.

**5. Creare `docker/backup/entrypoint.sh`** (fine riga LF) con questo contenuto esatto:

```sh
#!/bin/sh
# Entrypoint del servizio `backup`: pianifica backup.sh con il crond di busybox e resta in primo piano.
set -eu

BACKUP_CRON="${BACKUP_CRON:-0 3 * * *}"

mkdir -p /backups
# L'output del job va sullo stdout del processo 1 (crond), cioè nei log del container.
echo "${BACKUP_CRON} sh /opt/backup/backup.sh daily > /proc/1/fd/1 2>&1" > /etc/crontabs/root

echo "[backup] pianificato: '${BACKUP_CRON}' (fuso ${TZ:-UTC}), conservati gli ultimi ${BACKUP_KEEP:-7} dump"
exec crond -f -l 8 -L /dev/stdout
```

**6. Creare `docker/backup/backup.sh`** (fine riga LF) con questo contenuto esatto:

```sh
#!/bin/sh
# Dump compresso del database in /backups e rotazione dei dump con la stessa etichetta.
# Uso: sh backup.sh [etichetta]   (default: daily; solo lettere minuscole e cifre)
# Connessione da PGHOST, PGUSER, PGPASSWORD, PGDATABASE (v. docker-compose.prod.yml).
set -eu
set -o pipefail

LABEL="${1:-daily}"
KEEP="${BACKUP_KEEP:-7}"
DIR="/backups"

case "$LABEL" in
  *[!a-z0-9]* | "")
    echo "[backup] etichetta non valida: '$LABEL' (ammesse solo lettere minuscole e cifre)" >&2
    exit 2
    ;;
esac
case "$KEEP" in
  *[!0-9]* | "" | 0*)
    echo "[backup] BACKUP_KEEP non valido: '$KEEP' (serve un intero maggiore di 0, senza zeri iniziali)" >&2
    exit 2
    ;;
esac

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${DIR}/mealy-${LABEL}-${STAMP}.sql.gz"
TMP="${FILE}.tmp"

mkdir -p "$DIR"
trap 'rm -f "$TMP"' EXIT

if ! pg_dump --no-owner --clean --if-exists | gzip -9 > "$TMP"; then
  echo "[backup] pg_dump fallito: nessun dump scritto, i dump esistenti restano dove sono" >&2
  exit 1
fi
if ! gzip -t "$TMP" || [ ! -s "$TMP" ]; then
  echo "[backup] dump non valido: scartato, i dump esistenti restano dove sono" >&2
  exit 1
fi
mv "$TMP" "$FILE"
echo "[backup] scritto ${FILE} ($(wc -c < "$FILE") byte)"

# Rotazione: solo dopo un dump riuscito, e solo tra i file con la stessa etichetta.
ls -1t "${DIR}"/mealy-"${LABEL}"-*.sql.gz | tail -n +"$((KEEP + 1))" | while IFS= read -r old; do
  rm -f "$old"
  echo "[backup] rimosso ${old}"
done
```

Regole incorporate, da non cambiare: codice d'uscita 2 per argomenti non validi, 1 per dump fallito, 0 altrimenti; il file parziale `.tmp` viene sempre rimosso; la rotazione non gira se il dump è fallito; l'etichetta non ammette il trattino, così `mealy-daily-*` non può mai corrispondere ai file di un'altra etichetta.

**7. Creare `.env.production.example`** nella radice, con questo contenuto esatto:

```
# Configurazione di produzione (Raspberry Pi). Copia questo file in .env.production e compilalo:
#   cp .env.production.example .env.production && chmod 600 .env.production
# Lo leggono scripts/compose-prod.sh e scripts/deploy.sh. Non va mai committato.

# Password del database. Solo lettere e cifre (finisce dentro un URL). Generala con: openssl rand -hex 24
# Vale alla prima creazione del database: cambiarla dopo non cambia la password già impostata.
POSTGRES_PASSWORD=

# Provider LLM: google | openrouter | anthropic | openai-compatible
LLM_PROVIDER=google
# Obbligatorio. Verificare che il modello sia disponibile nel proprio piano.
LLM_MODEL=gemini-3.1-flash-lite
# Timeout di una singola chiamata LLM, in millisecondi (un lotto da 3 ricette).
LLM_TIMEOUT_MS=90000

# Serve solo la chiave del provider attivo.
GOOGLE_GENERATIVE_AI_API_KEY=
OPENROUTER_API_KEY=
ANTHROPIC_API_KEY=

# Solo per LLM_PROVIDER=openai-compatible
LLM_BASE_URL=
LLM_API_KEY=

# --- Facoltative (i valori qui sotto sono i default) ---
# Porta dell'app sul Raspberry
# APP_PORT=3000
# Cartella dei backup: relativa alla cartella del repo oppure assoluta (meglio un disco diverso dalla microSD)
# BACKUP_DIR=./backups
# Quanti dump conservare per ciascun tipo (daily, predeploy, manual)
# BACKUP_KEEP=7
# Quando fare il backup notturno, in formato cron
# BACKUP_CRON="0 3 * * *"
# Fuso orario di log e backup
# TZ=Europe/Rome
```

**8. Creare `.gitattributes`** nella radice, con questo contenuto esatto:

```
# Gli script di shell girano in container Linux e sul Raspberry: sempre LF, anche su Windows.
*.sh text eol=lf
```

**9. Modificare `.gitignore`.**

a) Subito dopo la riga `!.env.example` aggiungere la riga:

```
!.env.production.example
```

b) In fondo al file aggiungere:

```

# Deploy
backups/
.smoke/
```

### Contratti esposti

- Immagine: utente `nextjs` (uid 1001), porta 3000, comando `node server.js`, migrazioni in `/app/lib/db/migrations`.
- Compose: servizi `db`, `app`, `backup`; progetto `mealy-prod`; variabili obbligatorie `POSTGRES_PASSWORD`, `LLM_MODEL`, `MEALY_IMAGE`; facoltative `APP_PORT` (3000), `BACKUP_DIR` (`./backups`), `BACKUP_KEEP` (7), `BACKUP_CRON` (`0 3 * * *`), `TZ` (`Europe/Rome`), `LLM_PROVIDER` (`google`), `LLM_TIMEOUT_MS` (90000) e le chiavi LLM.
- Backup a mano: `sh /opt/backup/backup.sh <etichetta>` dentro il servizio `backup`; file in `/backups/mealy-<etichetta>-<AAAAMMGG-HHMMSS>.sql.gz`.

### Dipendenze

- WP1 (`instrumentation.ts`, `lib/db/bootstrap.ts`) e WP2 (`/api/health`) devono essere già nel repo: l'immagine li incorpora e l'healthcheck del compose chiama `/api/health`.

### Criteri di accettazione

Da Git Bash, nella radice del repo:

1. Fine riga: `for f in docker/backup/entrypoint.sh docker/backup/backup.sh; do echo "$f:$(tr -cd '\r' < "$f" | wc -c)"; done` stampa `…:0` per entrambi.
2. `git check-ignore .env.production.example` non stampa nulla (il file non è più ignorato); `git check-ignore .env.production` stampa `.env.production`.
3. Compose valido:
   ```bash
   printf 'POSTGRES_PASSWORD=x\nLLM_MODEL=x\n' > .env.configcheck
   MEALY_IMAGE=mealy-app:smoke docker compose --env-file .env.configcheck -f docker-compose.prod.yml config --quiet && echo "compose OK"
   rm .env.configcheck
   ```
   stampa `compose OK`. Senza `POSTGRES_PASSWORD` nel file lo stesso comando fallisce con il messaggio `Imposta POSTGRES_PASSWORD in .env.production`.
4. Immagine: `docker build -t mealy-app:smoke .` termina con successo (circa 5 minuti la prima volta).
5. Contenuto: `docker run --rm mealy-app:smoke sh -c 'id -un && ls && ls lib/db/migrations'` stampa `nextjs`, un elenco che contiene `server.js` e i 5 file `.sql` più `meta`.
6. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdi; dopo `pnpm build` **non** esiste `.next/standalone` (la variabile `NEXT_OUTPUT` non è impostata in locale).

Lasciare l'immagine `mealy-app:smoke` dov'è: serve a WP6. **Non** avviare lo stack (`docker compose up`): lo prova WP6.

### Fuori ambito

- Script in `scripts/` (WP6), workflow CI (WP4), documentazione (WP5).
- Tailscale, reverse proxy, TLS, immagini multi-architettura, cache di build.
- Creare `public/`, aggiungere `packageManager` a `package.json`, modificare `docker-compose.dev.yml`.

---

## WP4 — CI: job `image` nel gate e workflow `Image` (wave 2, parallelo a WP3 e WP5)

**Obiettivo:** ogni pull request prova che l'immagine si costruisce e che lo stack di produzione parte; ogni push su `main` pubblica l'immagine arm64 su GHCR.

### File

- modificare `.github/workflows/gate.yml`
- creare `.github/workflows/image.yml`

### Pattern di riferimento

- Stile, versioni delle action e commenti: `.github/workflows/gate.yml`.

### Passi

**1. Modificare `.github/workflows/gate.yml`:** aggiungere in fondo al file, dentro `jobs:` e dopo il job `gate` (stessa indentazione di `gate:`, due spazi), questo job. Il job `gate` esistente non cambia.

```yaml

  image:
    name: docker image, production stack smoke
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - uses: actions/checkout@v7

      - run: docker build -t mealy-app:smoke .

      # Avvia lo stack di produzione con l'immagine appena costruita: migrazioni, alias,
      # pagina iniziale, backup e riavvio (v. scripts/smoke-prod.sh).
      - run: bash scripts/smoke-prod.sh mealy-app:smoke
```

**2. Creare `.github/workflows/image.yml`** con questo contenuto esatto:

```yaml
name: Image

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: image-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read
  packages: write

jobs:
  publish:
    name: build arm64 image, push to GHCR
    # Runner arm64 nativo: l'immagine serve al Raspberry Pi (linux/arm64), senza emulazione.
    runs-on: ubuntu-24.04-arm
    timeout-minutes: 30

    env:
      # Il tag è il commit: scripts/compose-prod.sh sul Raspberry chiede esattamente questo nome.
      IMAGE: ghcr.io/elverle/mealy:sha-${{ github.sha }}

    steps:
      - uses: actions/checkout@v7

      - run: docker build -t "$IMAGE" .

      # L'immagine arm64 viene provata prima di essere pubblicata.
      - run: bash scripts/smoke-prod.sh "$IMAGE"

      - name: Log in to GHCR
        # Token e utente passano dall'ambiente, non dal testo del comando.
        env:
          GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GHCR_USER: ${{ github.actor }}
        run: echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

      - run: docker push "$IMAGE"
```

Note:
- il nome dell'immagine è tutto minuscolo (`elverle`, non `Elverle`): GHCR non accetta maiuscole;
- nessun tag `latest`;
- token e utente del login passano da `env:`, non dal testo del comando (code review);
- `'feature/7-*'` nel trigger è provvisorio e voluto: `workflow_dispatch` funziona solo per i workflow già presenti su `main`, quindi senza quel pattern runner arm64, login e push si proverebbero per la prima volta dopo il merge. Lo toglie l'orchestratore nel commit di chiusura, non l'implementer;
- non usare `docker/build-push-action`, `docker/metadata-action` né cache: decisione presa (requirements P10).

### Contratti esposti

- Immagine pubblicata: `ghcr.io/elverle/mealy:sha-<sha completo>` per ogni commit in testa a `main` (e, finché resta il trigger provvisorio, per ogni push sul branch `feature/7-*`).
- Il gate delle PR ha due job: `gate` e `image`.

### Dipendenze

- Di solo contratto, nessun file condiviso: `Dockerfile` (WP3) e `scripts/smoke-prod.sh <immagine>` (WP6). I workflow girano su GitHub solo dopo il push, quando tutti i WP sono nel branch.

### Criteri di accettazione

- I due workflow passano `actionlint` (da Git Bash, nella radice del repo, con Docker Desktop avviato):
  ```bash
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W 2>/dev/null || pwd):/repo" -w /repo rhysd/actionlint:1.7.12 .github/workflows/gate.yml .github/workflows/image.yml; echo "exit=$?"
  ```
  Nessun avviso e `exit=0`. (Nel repo non c'è un parser YAML utilizzabile da riga di comando: né il modulo `yaml` di Node né PyYAML.)
- In `gate.yml` il job `gate` è identico a prima (`git diff .github/workflows/gate.yml` mostra solo righe aggiunte).
- La verifica vera avviene su GitHub: job `image` verde sulla pull request della feature; workflow `Image` verde sul push del branch della feature (prima del merge, grazie al trigger provvisorio) e di nuovo dopo il merge in `main`. L'implementer non può provarla: lo dichiara nel resoconto.

### Fuori ambito

- Deploy automatico sul Raspberry, pulizia dei pacchetti GHCR, immagini amd64 pubblicate, firma o attestazioni.
- Modifiche al job `gate`.

---

## WP5 — Guida di deploy e allineamento dei documenti (wave 2, parallelo a WP3 e WP4)

**Obiettivo:** l'utente ha una guida passo passo per preparare il Raspberry, avviare, aggiornare, salvare e ripristinare; README, CLAUDE.md e ARCHITECTURE dicono come funziona davvero il deploy.

### File

- creare `docs/DEPLOY.md`
- modificare `README.md`
- modificare `CLAUDE.md`
- modificare `docs/ARCHITECTURE.md`

### Pattern di riferimento

- Tono e struttura: `README.md` (italiano, frasi brevi, comandi in blocchi `bash`).

### Passi

**1. Creare `docs/DEPLOY.md`** con questo contenuto esatto (tutto ciò che sta tra le due righe di cinque accenti gravi, escluse):

`````markdown
# Mealy — Deploy sul Raspberry Pi

Guida operativa della v1. Mealy gira su un Raspberry Pi con Docker Compose ed è raggiungibile solo dalla rete di casa e da Tailscale, senza login (`ARCHITECTURE.md §8`).

## 1. Come è fatto

| Container | Cosa fa |
|---|---|
| `app` | Next.js in modalità standalone, porta 3000. All'avvio applica le migrazioni del database e carica gli alias degli ingredienti, poi inizia a rispondere |
| `db` | PostgreSQL 16. I dati stanno nel volume Docker `mealy-prod_postgres_data`. Non è raggiungibile da fuori |
| `backup` | Ogni notte alle 03:00 scrive un dump compresso in `backups/` e tiene gli ultimi 7 |

- **Il Raspberry non costruisce nulla.** A ogni push su `main` GitHub Actions (workflow **Image**) costruisce l'immagine arm64 e la pubblica come `ghcr.io/elverle/mealy:sha-<commit>`. Il Raspberry scarica l'immagine del commit che ha in `git`.
- **Nessun comando `pnpm` sul Raspberry.** Migrazioni e alias li applica l'app da sola. Le ricette di esempio di `pnpm db:seed` non entrano mai in produzione: la libreria parte vuota.
- **Nessuna porta aperta su Internet.** Fuori casa si entra solo con Tailscale. L'app però ascolta su tutte le interfacce di rete del Raspberry, e le porte pubblicate da Docker non passano da `ufw`: in IPv4 la protegge il router di casa. Se la tua rete assegna indirizzi IPv6 pubblici, controlla che il firewall IPv6 del router blocchi le connessioni in ingresso.

## 2. Cosa serve

- Raspberry Pi 4 (bastano 2 GB) con Raspberry Pi OS **a 64 bit** e accesso SSH
- un account GitHub con accesso al repository `Elverle/Mealy` (privato)
- un account Tailscale e l'app Tailscale sul telefono
- la chiave API del provider LLM scelto

## 3. Preparare il Raspberry (una volta sola)

### 3.1 Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
```

Esci dalla sessione SSH e rientra, poi controlla:

```bash
docker compose version
uname -m          # deve stampare aarch64
```

### 3.2 Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=mealy
tailscale ip -4   # l'indirizzo 100.x.y.z del Raspberry
```

Nella console di amministrazione di Tailscale: disattiva la scadenza della chiave per la macchina `mealy` (altrimenti dopo qualche mese smette di essere raggiungibile) e controlla che MagicDNS sia attivo. Sul telefono installa Tailscale ed entra con lo stesso account.

### 3.3 Accesso al repository

Il repository è privato: il Raspberry lo legge con una deploy key in sola lettura. Se `git` manca (su Raspberry Pi OS Lite può non esserci): `sudo apt-get install -y git`.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/mealy_deploy -N "" -C "mealy-raspberry"
cat ~/.ssh/mealy_deploy.pub
```

Su GitHub: repository **Mealy → Settings → Deploy keys → Add deploy key**, incolla la chiave pubblica, lascia **senza** spunta "Allow write access".

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/mealy_deploy
  IdentitiesOnly yes
EOF

sudo mkdir -p /opt/mealy
sudo chown "$USER": /opt/mealy
git clone git@github.com:Elverle/Mealy.git /opt/mealy
cd /opt/mealy
```

### 3.4 Accesso alle immagini

Anche le immagini su GHCR sono private. Su GitHub: **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token**, con il solo scope `read:packages`. Scegli tu la scadenza: quando il token scade, `deploy.sh` si ferma con `denied` e va rifatto questo passo.

```bash
docker login ghcr.io -u Elverle
```

Alla richiesta della password incolla il token. Va fatto una volta: Docker lo ricorda.

### 3.5 Configurazione

```bash
cd /opt/mealy
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -hex 24      # il valore da mettere in POSTGRES_PASSWORD
nano .env.production
```

| Variabile | Obbligatoria | Cosa mettere |
|---|---|---|
| `POSTGRES_PASSWORD` | sì | La password generata sopra. Solo lettere e cifre. Vale alla prima creazione del database: cambiarla dopo non ha effetto |
| `LLM_PROVIDER` | no (default `google`) | `google`, `openrouter`, `anthropic` oppure `openai-compatible` |
| `LLM_MODEL` | sì | Il modello del provider scelto |
| chiave del provider | sì | `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENROUTER_API_KEY` oppure `ANTHROPIC_API_KEY`: solo quella del provider attivo. Con `openai-compatible` serve invece `LLM_BASE_URL`, più `LLM_API_KEY` se il servizio la richiede |
| `LLM_TIMEOUT_MS` | no (default `90000`) | Timeout di una chiamata LLM |
| `APP_PORT` | no (default `3000`) | Porta dell'app sul Raspberry |
| `BACKUP_DIR` | no (default `./backups`) | Cartella dei backup; v. §7 |
| `BACKUP_KEEP` | no (default `7`) | Quanti dump tenere per tipo |
| `BACKUP_CRON` | no (default `0 3 * * *`) | Orario del backup notturno |
| `TZ` | no (default `Europe/Rome`) | Fuso orario di log e backup |

## 4. Primo avvio

1. Su GitHub, scheda **Actions**: il workflow **Image** dell'ultimo commit di `main` deve essere verde.
2. Sul Raspberry:

```bash
cd /opt/mealy
bash scripts/deploy.sh
```

L'ultima riga deve essere `[deploy] fatto: Mealy risponde sulla porta 3000`.

3. Da un dispositivo in casa apri `http://<ip-del-raspberry>:3000`: parte la configurazione iniziale.

La libreria è vuota: il primo **Genera piano** crea tutte le ricette con l'LLM e può richiedere qualche minuto. Dal secondo piano in poi le ricette vengono dalla libreria.

## 5. Verifica

| Cosa | Come |
|---|---|
| I container sono attivi | `bash scripts/compose-prod.sh ps`: `app` e `db` risultano `healthy`, `backup` risulta `Up` |
| Accesso da casa | `http://<ip-del-raspberry>:3000` da PC o telefono in Wi-Fi: si legge e si scrive |
| Accesso fuori casa | Telefono su rete mobile (Wi-Fi spento) con Tailscale attivo: `http://mealy:3000` oppure `http://100.x.y.z:3000`. Scrivi `http://` per esteso: il browser potrebbe provare `https` da solo. Spunta qualche riga della lista |
| Generazione ricette | **Genera piano** arriva in fondo senza errori |
| Backup | `bash scripts/compose-prod.sh exec backup sh /opt/backup/backup.sh manual`, poi `ls -l backups/`: c'è un file `mealy-manual-….sql.gz` |
| Backup notturno | La mattina dopo: `ls -l backups/` mostra un file `mealy-daily-….sql.gz` e `bash scripts/compose-prod.sh logs backup` contiene una riga `[backup] scritto` |
| Riavvio | `sudo reboot`; dopo un paio di minuti l'app risponde di nuovo e i dati ci sono |

## 6. Aggiornare

Quando una modifica arriva su `main`:

1. aspetta che il workflow **Image** sia verde;
2. sul Raspberry:

```bash
cd /opt/mealy
bash scripts/deploy.sh
```

Lo script, nell'ordine: aggiorna il codice (`git pull`), scarica l'immagine di quel commit, fa un dump di sicurezza (`mealy-predeploy-…`), riavvia i container (le migrazioni girano all'avvio dell'app), controlla che `/api/health` risponda e rimuove le immagini vecchie.

Il dump si salta in un solo caso: quando l'app sta già girando con la stessa immagine, e quindi lo schema non può cambiare. Se il dump non riesce, lo script si ferma prima di toccare l'app.

Se dice che l'immagine non è stata trovata, il workflow **Image** non ha ancora finito: riprova tra qualche minuto.

**Dopo una modifica a `.env.production`** non serve scaricare nulla:

```bash
bash scripts/deploy.sh --no-pull
```

**Tornare a una versione precedente:**

```bash
git reflog -3        # subito dopo un aggiornamento, il commit di prima è HEAD@{1}
git checkout <commit>
bash scripts/compose-prod.sh pull app
bash scripts/deploy.sh --no-pull
```

Serve la rete: sul Raspberry resta solo l'immagine in uso, quella precedente viene scaricata di nuovo. L'immagine esiste solo per i commit che sono stati in cima a `main` con il workflow **Image** verde: quello su cui girava l'app lo è di sicuro, un commit qualunque della storia no.

Le migrazioni del database non tornano indietro: se la versione nuova aveva cambiato lo schema, ripristina il dump `mealy-predeploy-…` fatto prima dell'aggiornamento (§7). Scegli quello con l'orario precedente all'aggiornamento: anche il ritorno indietro ne crea uno, con lo schema nuovo. Per riprendere gli aggiornamenti normali: `git checkout main`.

## 7. Backup e ripristino

I dump stanno in `/opt/mealy/backups/` (o in `BACKUP_DIR`):

| File | Quando | Quanti |
|---|---|---|
| `mealy-daily-AAAAMMGG-HHMMSS.sql.gz` | ogni notte alle 03:00 | gli ultimi 7 |
| `mealy-predeploy-AAAAMMGG-HHMMSS.sql.gz` | prima di ogni cambio di versione | gli ultimi 7 |
| `mealy-manual-AAAAMMGG-HHMMSS.sql.gz` | a mano | gli ultimi 7 |

I file appartengono a `root`: per spostarli o cancellarli serve `sudo`.

**Backup a mano:**

```bash
bash scripts/compose-prod.sh exec backup sh /opt/backup/backup.sh manual
```

**Dove tenerli.** Di default i dump stanno sulla stessa microSD del database: se la scheda si rompe si perdono entrambi. Meglio un disco USB (imposta `BACKUP_DIR=/mnt/usb/mealy-backups` in `.env.production`, poi `bash scripts/deploy.sh --no-pull`) oppure una copia periodica su un altro computer:

```bash
scp "<utente>@mealy:/opt/mealy/backups/mealy-daily-*.sql.gz" .
```

Con un disco USB, controlla che sia montato (`mountpoint /mnt/usb`) prima di avviare: se non lo è, Docker crea la cartella sulla microSD e i dump finiscono lì senza alcun avviso.

**Ripristino.** Sostituisce tutto il contenuto del database con quello del dump. È una transazione unica: se qualcosa va storto, il database resta com'era.

Prima metti da parte lo stato di adesso, nel caso il dump scelto fosse quello sbagliato:

```bash
cd /opt/mealy
bash scripts/compose-prod.sh exec -T backup sh /opt/backup/backup.sh manual < /dev/null
```

Poi il ripristino. I comandi sono concatenati: se uno fallisce, i successivi non partono.

```bash
DUMP=backups/mealy-daily-AAAAMMGG-HHMMSS.sql.gz
gzip -t "$DUMP" \
  && bash scripts/compose-prod.sh stop app \
  && ( echo 'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;'
       gunzip -c "$DUMP" ) \
     | bash scripts/compose-prod.sh exec -T db psql -U mealy -d mealy -q -v ON_ERROR_STOP=1 --single-transaction \
  && echo "ripristino riuscito"
bash scripts/compose-prod.sh start app
```

Se non compare `ripristino riuscito`, il database è rimasto com'era.

## 8. Comandi utili

Tutti da `/opt/mealy`. `scripts/compose-prod.sh` è `docker compose` con il file d'ambiente e l'immagine giusti.

| Comando | Cosa fa |
|---|---|
| `bash scripts/compose-prod.sh ps` | Stato dei container |
| `bash scripts/compose-prod.sh logs -f app` | Log dell'app |
| `bash scripts/compose-prod.sh logs backup` | Esito dei backup |
| `bash scripts/compose-prod.sh restart app` | Riavvia l'app |
| `bash scripts/compose-prod.sh exec db psql -U mealy -d mealy` | Console SQL |
| `bash scripts/compose-prod.sh down` | Ferma tutto. I dati restano nel volume. Per ripartire: `bash scripts/deploy.sh --no-pull` |
| `docker image ls ghcr.io/elverle/mealy` | Immagini dell'app sul Raspberry. Di norma una sola: le altre si tolgono con `docker image rm <IMAGE ID>` |

**Mai** `down -v`: cancella il volume, cioè il database.

## 9. Se qualcosa non va

| Sintomo | Causa probabile | Rimedio |
|---|---|---|
| `Manca .env.production` | File di configurazione assente | §3.5 |
| `Non riesco a leggere il commit con git` | Script lanciato con `sudo`, oppure da una cartella che non è la copia clonata | Lancialo da `/opt/mealy`, senza `sudo` |
| `Imposta POSTGRES_PASSWORD…` o `Imposta LLM_MODEL…` | Variabile obbligatoria vuota | Compila `.env.production` |
| `immagine non trovata per il commit …` | Workflow **Image** non finito o fallito | Controlla la scheda Actions e riprova |
| `denied` o `unauthorized` durante il pull | Token GHCR scaduto o mancante | §3.4 |
| `git pull` fallisce con `Permission denied (publickey)` | Deploy key non configurata | §3.3 |
| `git pull` dice che non sei su un branch | Sei rimasto su un commit dopo un ritorno indietro | `git checkout main` |
| `backup non riuscito`, oppure `il database o il servizio di backup non partono` | La cartella dei backup non è scrivibile (disco staccato o pieno), oppure il database non parte | L'app non è stata toccata. Controlla `BACKUP_DIR` e `bash scripts/compose-prod.sh logs backup db`, poi rilancia lo script |
| `lo stack non è diventato sano entro 180 secondi` | L'app non parte | Leggi i log stampati dallo script: `[bootstrap] avvio interrotto` indica un problema di database o di migrazioni. Una migrazione fallita non modifica il database: torna alla versione precedente (§6) senza ripristinare nulla. Fa eccezione un errore che cita `ingredient_aliases`: lì le migrazioni sono già applicate, e per tornare indietro serve anche il dump `predeploy` (§7) |
| `avviso: non sono riuscito a rimuovere le immagini vecchie` | Un'immagine vecchia è ancora usata da un altro container | Il deploy è riuscito. `docker image ls ghcr.io/elverle/mealy` mostra cosa è rimasto: ciò che non serve si toglie con `docker image rm <IMAGE ID>` |
| `password authentication failed` nei log dell'app | `POSTGRES_PASSWORD` cambiata dopo la prima creazione | Rimetti la password originale |
| La porta 3000 è occupata | Un altro servizio sul Raspberry | `APP_PORT=3001` in `.env.production`, poi `bash scripts/deploy.sh --no-pull` |
| Fuori casa non risponde | Tailscale spento sul telefono, o chiave del Raspberry scaduta | Apri l'app Tailscale; sul Raspberry `tailscale status` |

## 10. Note per chi sviluppa

- **Prova locale dello stack di produzione** (PC con Docker): `docker build -t mealy-app:smoke . && bash scripts/smoke-prod.sh mealy-app:smoke`. Usa la porta 3100 e un progetto compose a parte (`mealy-smoke`), che smonta alla fine.
- **Il gate delle pull request** fa la stessa prova (job `image`).
- **Migrazioni**: una migrazione arrivata su `main` non si modifica, se ne aggiunge una nuova. Il migratore guarda solo l'orario dell'ultima applicata: un test (`tests/db/bootstrap.test.ts`) controlla che il journal resti in ordine e applica l'ultima migrazione a un database fermo a quella precedente.
- **Cartella `public/`**: oggi non esiste e il `Dockerfile` non la copia. Se viene creata, va aggiunta la riga `COPY --from=builder --chown=nextjs:nodejs /app/public ./public` nello stadio `runner`.
- **Spazio su GHCR**: ogni push su `main` pubblica un'immagine nuova. Quelle vecchie si cancellano a mano da GitHub (profilo → **Packages → mealy → Package settings**).
`````

**2. Modificare `README.md`.**

a) Nella tabella "Comandi", sostituire la riga

```
| `pnpm db:seed:aliases` | Inserisce solo gli alias degli ingredienti usati dalla lista della spesa (idempotente); è il comando per la produzione |
```

con

```
| `pnpm db:seed:aliases` | Inserisce o corregge gli alias degli ingredienti usati dalla lista della spesa (idempotente). In produzione lo stesso caricamento avviene da solo all'avvio dell'app |
```

b) Sostituire **tutto il paragrafo** sotto il titolo `## Deploy` (quello che comincia con "La v1 gira su Raspberry Pi con Docker Compose, raggiungibile solo via LAN/Tailscale" e finisce con "che inserisce anche le ricette di esempio.") con:

```markdown
La v1 gira su Raspberry Pi con Docker Compose (app Next.js standalone, PostgreSQL 16, backup notturno), raggiungibile solo via LAN/Tailscale e senza autenticazione (`docs/ARCHITECTURE.md §8`). La guida operativa è [`docs/DEPLOY.md`](docs/DEPLOY.md).

- L'immagine dell'app la costruisce GitHub Actions a ogni push su `main` (workflow `Image`, `ghcr.io/elverle/mealy:sha-<commit>`); il Raspberry la scarica con `bash scripts/deploy.sh`.
- All'avvio in produzione l'app applica le migrazioni e carica gli alias degli ingredienti (`DB_BOOTSTRAP_ON_START=true`, `lib/db/bootstrap.ts`): sul Raspberry non si lancia nessun comando `pnpm`. Le ricette di esempio di `pnpm db:seed` non entrano mai in produzione.
- Prova locale dello stack di produzione: `docker build -t mealy-app:smoke . && bash scripts/smoke-prod.sh mealy-app:smoke`.
```

Non toccare la sezione "Stato" né il numero di versione: li aggiorna la chiusura della feature.

**3. Modificare `CLAUDE.md`.**

a) Nella lista "Documenti autoritativi", dopo la riga 5 (`docs/planning/feature-index.md`) aggiungere:

```
6. `docs/DEPLOY.md` — guida operativa del deploy sul Raspberry Pi
```

b) Nel paragrafo che comincia con `Deploy v1:`, aggiungere in coda, sulla stessa riga, questa frase:

```
 Guida operativa: `docs/DEPLOY.md`. L'immagine arm64 la costruisce il workflow `Image` (GHCR); all'avvio in produzione l'app applica migrazioni e alias (`instrumentation.ts` → `lib/db/bootstrap.ts`).
```

c) Nel blocco "Comandi", sostituire la riga che comincia con `pnpm db:seed:aliases` con:

```
pnpm db:seed:aliases # solo gli alias degli ingredienti: inserisce e corregge (idempotente). In produzione li carica l'app all'avvio; mai db:seed, che inserisce anche le ricette di esempio
```

e, subito dopo la riga `pnpm llm:record …`, aggiungere:

```
docker build -t mealy-app:smoke . && bash scripts/smoke-prod.sh mealy-app:smoke   # prova lo stack di produzione in locale (porta 3100)
bash scripts/deploy.sh   # solo sul Raspberry: codice, immagine, backup, riavvio, verifica (docs/DEPLOY.md)
```

d) Sostituire la frase `Lo stesso gate gira in CI su ogni pull request (\`.github/workflows/gate.yml\`).` con:

```
Lo stesso gate gira in CI su ogni pull request (`.github/workflows/gate.yml`), insieme al job `image` che costruisce l'immagine Docker e prova lo stack di produzione.
```

**4. Modificare `docs/ARCHITECTURE.md`, §8:** nella tabella dell'Opzione C sostituire la riga

```
| Rischi/Ops | Manutenzione container su Raspberry, aggiornamenti via script/git pull, storage locale affidabile |
```

con

```
| Rischi/Ops | Manutenzione container su Raspberry; immagine arm64 costruita da GitHub Actions e pubblicata su GHCR, aggiornamenti con `scripts/deploy.sh` (git pull + pull dell'immagine); migrazioni applicate all'avvio dell'app; storage locale affidabile. Guida operativa: `DEPLOY.md` |
```

Nient'altro in ARCHITECTURE.

### Contratti esposti

Nessuno verso il codice. `docs/DEPLOY.md` è il riferimento per le attività dell'utente sul Raspberry.

### Dipendenze

- Di solo contratto (nomi di script, variabili, servizi: §0.4). Nessun file condiviso con altri WP.

### Criteri di accettazione

- `docs/DEPLOY.md` esiste con le 10 sezioni del testo qui sopra.
- Il blocco di ripristino di `docs/DEPLOY.md §7` è lo stesso, comando per comando, del criterio 5 di WP6 (cambia solo il percorso del dump): se uno dei due cambia, cambia anche l'altro.
- `grep -n "feature-7/spec.md" README.md` non trova nulla.
- `grep -c "docs/DEPLOY.md" README.md CLAUDE.md` dà almeno 1 per ciascun file.
- Ogni script, variabile, servizio e percorso citato nei documenti coincide con la tabella del §0.4.
- `pnpm lint` verde (i documenti non lo influenzano; conferma che non è stato toccato altro).

### Fuori ambito

- La wiki (`docs/wiki/`): la aggiorna `feature-documenter` in chiusura.
- `docs/BACKLOG.md`, `docs/planning/`, `spec.md`, sezione "Stato" e versione del README.
- Istruzioni per Vercel, HTTPS, port forwarding.

---

## WP6 — Script operativi e prova dello stack (wave 3, da solo)

**Obiettivo:** tre script — un involucro di `docker compose` per la produzione, l'aggiornamento a comando singolo, la prova dello stack — e la verifica end-to-end in locale.

### File

- creare `scripts/compose-prod.sh`
- creare `scripts/deploy.sh`
- creare `scripts/smoke-prod.sh`

### Pattern di riferimento

Nessuno script di shell esiste ancora nel repo: valgono i contenuti qui sotto.

### Passi

Tutti e tre i file con fine riga **LF**.

**1. Creare `scripts/compose-prod.sh`** con questo contenuto esatto:

```bash
#!/usr/bin/env bash
# docker compose per lo stack di produzione, con il file d'ambiente e l'immagine giusti.
# Uso: bash scripts/compose-prod.sh <argomenti di docker compose>   es.: ps | logs -f app
#   MEALY_ENV_FILE  file d'ambiente (default: .env.production)
#   MEALY_IMAGE     immagine dell'app (default: quella pubblicata per il commit in uso)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

ENV_FILE="${MEALY_ENV_FILE:-.env.production}"
if [ ! -f "$ENV_FILE" ]; then
  echo "Manca ${ENV_FILE}: copialo da .env.production.example e compilalo." >&2
  exit 1
fi

if [ -z "${MEALY_IMAGE:-}" ]; then
  if ! sha="$(git rev-parse HEAD)"; then
    echo "Non riesco a leggere il commit con git: lancia lo script dalla copia clonata del repository, senza sudo, oppure imposta MEALY_IMAGE." >&2
    exit 1
  fi
  MEALY_IMAGE="ghcr.io/elverle/mealy:sha-${sha}"
fi
export MEALY_IMAGE
# Git Bash su Windows: non convertire i percorsi del container (/opt/backup/...) in percorsi Windows.
export MSYS_NO_PATHCONV=1

exec docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml "$@"
```

**2. Creare `scripts/deploy.sh`** con questo contenuto esatto:

```bash
#!/usr/bin/env bash
# Aggiorna Mealy sul Raspberry: codice, immagine, backup, riavvio, verifica.
# Uso: bash scripts/deploy.sh [--no-pull]
#   --no-pull  non esegue `git pull` né scarica l'immagine: riapplica la configurazione
#              (per esempio dopo una modifica a .env.production) con ciò che c'è già in locale.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

compose() {
  bash scripts/compose-prod.sh "$@"
}

# Tutto in una funzione: bash la legge per intero prima di eseguirla, quindi `git pull`
# può aggiornare questo file senza disturbare l'esecuzione in corso.
main() {
  local pull=1
  case "${1:-}" in
    "") ;;
    --no-pull) pull=0 ;;
    *)
      echo "Argomento sconosciuto: $1. Uso: bash scripts/deploy.sh [--no-pull]" >&2
      exit 2
      ;;
  esac

  if [ "$pull" -eq 1 ]; then
    echo "[deploy] aggiorno il codice"
    git pull --ff-only
    echo "[deploy] scarico l'immagine del commit $(git rev-parse --short HEAD)"
    if ! compose pull app; then
      echo "[deploy] immagine non trovata per il commit $(git rev-parse HEAD)." >&2
      echo "[deploy] Il workflow 'Image' su GitHub potrebbe essere ancora in corso: riprova tra qualche minuto." >&2
      echo "[deploy] Se l'errore parla di accesso negato, rifai 'docker login ghcr.io' (v. docs/DEPLOY.md)." >&2
      exit 1
    fi
  fi

  # Il dump va fatto prima che parta l'immagine nuova, che applica le migrazioni. Si salta solo
  # se l'app sta già girando con la stessa immagine: in quel caso lo schema non può cambiare.
  local running target running_id="" target_id=""
  running="$(compose ps -q --status running app)"
  if [ -n "$running" ]; then
    # Lo stesso nome che scripts/compose-prod.sh passa a docker compose.
    target="${MEALY_IMAGE:-ghcr.io/elverle/mealy:sha-$(git rev-parse HEAD)}"
    running_id="$(docker inspect --format '{{.Image}}' "$running")"
    target_id="$(docker image inspect --format '{{.Id}}' "$target" 2> /dev/null || true)"
  fi

  if [ -n "$running_id" ] && [ "$running_id" = "$target_id" ]; then
    echo "[deploy] l'app usa già questa immagine: nessun backup da fare"
  else
    echo "[deploy] backup prima dell'aggiornamento"
    # Bastano `db` e `backup`: se erano fermi (primo avvio, oppure dopo un `down`) partono qui.
    if ! compose up -d --wait --wait-timeout 120 db backup; then
      echo "[deploy] FALLITO: il database o il servizio di backup non partono. L'app non è stata aggiornata." >&2
      compose logs --no-log-prefix --tail 20 db backup >&2 || true
      exit 1
    fi
    if ! compose exec -T backup sh /opt/backup/backup.sh predeploy; then
      echo "[deploy] FALLITO: backup non riuscito. L'app non è stata aggiornata: controlla la cartella dei backup (BACKUP_DIR)." >&2
      exit 1
    fi
  fi

  echo "[deploy] avvio i container (le migrazioni girano all'avvio dell'app)"
  if ! compose up -d --remove-orphans --wait --wait-timeout 180; then
    echo "[deploy] FALLITO: lo stack non è diventato sano entro 180 secondi. Ultimi log dell'app:" >&2
    compose logs --no-log-prefix --tail 60 app >&2 || true
    exit 1
  fi

  local port
  port="$(compose port app 3000)"
  port="${port##*:}"
  if [ "$(curl -sS --max-time 10 "http://127.0.0.1:${port}/api/health")" != '{"status":"ok"}' ]; then
    echo "[deploy] FALLITO: /api/health non risponde sulla porta ${port}." >&2
    exit 1
  fi

  # Libera spazio: resta solo l'immagine in uso, nessuna versione precedente dell'app.
  # A questo punto il deploy è riuscito: se la pulizia fallisce basta un avviso.
  local current repo
  current="$(docker inspect --format '{{.Config.Image}}' "$(compose ps -q app)")"
  repo="${current%:*}"
  docker image ls --format '{{.Repository}}:{{.Tag}}' "$repo" \
    | { grep -v -F -x -e "$current" -e "${repo}:<none>" || true; } \
    | xargs -r docker image rm > /dev/null \
    || echo "[deploy] avviso: non sono riuscito a rimuovere le immagini vecchie (il deploy è riuscito)." >&2

  echo "[deploy] fatto: Mealy risponde sulla porta ${port}"
}

main "$@"
exit $?
```

Regole incorporate, da non cambiare:
- il dump `predeploy` si fa sempre, dopo aver avviato `db` e `backup`. Si salta solo quando l'app sta già girando con la stessa immagine (confronto degli ID): lì lo schema non può cambiare. Non esiste più il ramo "primo avvio", che scattava anche dopo un `down` o con il servizio `backup` in errore (code review, M1);
- se il dump fallisce lo script si ferma **prima** di toccare l'app;
- il nome dell'immagine attesa è calcolato come in `compose-prod.sh` (`MEALY_IMAGE`, altrimenti il tag del commit): i due punti vanno tenuti allineati. Se divergessero il confronto fallirebbe e lo script farebbe il dump: mai il contrario;
- la pulizia finale delle immagini non è fatale (solo un avviso) e ignora le immagini senza tag;
- il file d'ambiente mancante ferma lo script con il messaggio di `compose-prod.sh`;
- codice d'uscita 2 per un argomento sconosciuto, 1 per ogni fallimento.

**3. Creare `scripts/smoke-prod.sh`** con questo contenuto esatto:

```bash
#!/usr/bin/env bash
# Prova lo stack di produzione con un'immagine già costruita: avvio, migrazioni, alias,
# pagina iniziale, backup con rotazione e riavvio. Usa un progetto compose a parte
# (mealy-smoke) e lo smonta alla fine, volumi compresi. Non tocca lo stack mealy-prod.
# Uso: docker build -t mealy-app:smoke . && bash scripts/smoke-prod.sh mealy-app:smoke
#   SMOKE_PORT  porta host dell'app durante la prova (default: 3100)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

IMAGE="${1:-}"
if [ -z "$IMAGE" ]; then
  echo "Uso: bash scripts/smoke-prod.sh <immagine>" >&2
  exit 2
fi
PORT="${SMOKE_PORT:-3100}"
BASE_URL="http://127.0.0.1:${PORT}"

rm -rf .smoke
mkdir -p .smoke/backups
cat > .smoke/env <<ENVEOF
POSTGRES_PASSWORD=smokepassword123
LLM_PROVIDER=google
LLM_MODEL=smoke-model
APP_PORT=${PORT}
BACKUP_DIR=./.smoke/backups
ENVEOF

export MEALY_ENV_FILE=.smoke/env
export MEALY_IMAGE="$IMAGE"

compose() {
  bash scripts/compose-prod.sh -p mealy-smoke "$@"
}

cleanup() {
  compose down -v --remove-orphans > /dev/null 2>&1 || true
  rm -rf .smoke
}
trap cleanup EXIT

fail() {
  echo "SMOKE FALLITO: $1" >&2
  compose logs --no-log-prefix --tail 60 app >&2 || true
  exit 1
}

query() {
  compose exec -T db psql -U mealy -d mealy -At -c "$1"
}

echo "[smoke] avvio dello stack con ${IMAGE}"
compose up -d --wait --wait-timeout 180 || fail "lo stack non è diventato sano entro 180 secondi"

echo "[smoke] /api/health"
[ "$(curl -sS --max-time 10 "${BASE_URL}/api/health")" = '{"status":"ok"}' ] \
  || fail "/api/health non ha risposto {\"status\":\"ok\"}"

echo "[smoke] migrazioni e alias"
[ "$(query "select to_regclass('public.recipes') is not null")" = "t" ] \
  || fail "la tabella recipes non esiste: migrazioni non applicate"
[ "$(query "select count(*) > 0 from drizzle.__drizzle_migrations")" = "t" ] \
  || fail "nessuna migrazione registrata"
[ "$(query "select count(*) > 0 from ingredient_aliases")" = "t" ] \
  || fail "nessun alias caricato"
[ "$(query "select count(*) from recipes")" = "0" ] \
  || fail "ci sono ricette nel database: il bootstrap non deve inserirne"

echo "[smoke] pagina iniziale"
[ "$(curl -sS -L --max-time 20 -o /dev/null -w '%{http_code}' "${BASE_URL}/")" = "200" ] \
  || fail "la pagina iniziale non risponde 200"

echo "[smoke] backup"
compose exec -T backup sh /opt/backup/backup.sh daily || fail "backup.sh è uscito con errore"
set -- .smoke/backups/mealy-daily-*.sql.gz
{ [ "$#" -eq 1 ] && [ -s "$1" ] && gzip -t "$1"; } || fail "dump mancante o non valido in .smoke/backups"
first_dump="$1"

echo "[smoke] rotazione dei backup"
sleep 1 # il nome del dump ha la precisione del secondo
compose exec -T -e BACKUP_KEEP=1 backup sh /opt/backup/backup.sh daily \
  || fail "il secondo backup è uscito con errore"
set -- .smoke/backups/mealy-daily-*.sql.gz
{ [ "$#" -eq 1 ] && [ "$1" != "$first_dump" ] && gzip -t "$1"; } \
  || fail "la rotazione doveva lasciare solo il dump più recente"

echo "[smoke] riavvio: il bootstrap deve essere idempotente"
compose restart app > /dev/null
compose up -d --wait --wait-timeout 180 || fail "l'app non è tornata sana dopo il riavvio"
# Senza `grep -q`: uscirebbe alla prima riga trovata e, con pipefail, `compose logs` che scrive
# su una pipe già chiusa farebbe fallire il controllo.
compose logs --no-log-prefix app | grep "alias inseriti o aggiornati: 0" > /dev/null \
  || fail "al secondo avvio il bootstrap ha riscritto degli alias"

echo "SMOKE OK"
```

### Contratti esposti

- `bash scripts/compose-prod.sh <argomenti di docker compose>`; variabili `MEALY_ENV_FILE`, `MEALY_IMAGE`.
- `bash scripts/deploy.sh [--no-pull]`; uscita 0 con ultima riga `[deploy] fatto: Mealy risponde sulla porta <porta>`.
- `bash scripts/smoke-prod.sh <immagine>`; uscita 0 con ultima riga `SMOKE OK`; variabile `SMOKE_PORT`.

### Dipendenze

- WP1 (bootstrap, riga di log), WP2 (`/api/health`), WP3 (`Dockerfile`, `docker-compose.prod.yml`, `docker/backup/*.sh`, `.gitignore` con `.smoke/`): tutti già nel repo.

### Criteri di accettazione

Da Git Bash, nella radice del repo. Prima di cominciare: la porta 3100 deve essere libera e Docker Desktop avviato.

1. Fine riga e sintassi:
   ```bash
   for f in scripts/compose-prod.sh scripts/deploy.sh scripts/smoke-prod.sh; do echo "$f:$(tr -cd '\r' < "$f" | wc -c)"; done    # tre righe che finiscono con :0
   bash -n scripts/compose-prod.sh && bash -n scripts/deploy.sh && bash -n scripts/smoke-prod.sh && echo "sintassi OK"
   ```
2. Argomento sconosciuto: `bash scripts/deploy.sh --foo; echo "exit=$?"` stampa `Argomento sconosciuto: --foo. …` e `exit=2`.
3. File d'ambiente mancante: `MEALY_ENV_FILE=.env.nonesiste bash scripts/compose-prod.sh ps; echo "exit=$?"` stampa `Manca .env.nonesiste: …` e `exit=1`.
4. Prova dello stack:
   ```bash
   docker build -t mealy-app:smoke .
   bash scripts/smoke-prod.sh mealy-app:smoke
   ```
   L'ultima riga è `SMOKE OK` e l'output contiene `[backup] rimosso` (la rotazione); al termine `docker ps -a --format '{{.Names}}' | grep smoke` non stampa nulla e la cartella `.smoke` non esiste.
5. Prova di `deploy.sh` senza rete (primo avvio, stessa immagine, ripartenza dopo un `down`; poi ripristino e smontaggio):
   ```bash
   printf 'POSTGRES_PASSWORD=deploytest123\nLLM_MODEL=x\nAPP_PORT=3100\nBACKUP_DIR=./.smoke/deploy-backups\n' > .env.deploytest
   export MEALY_ENV_FILE=.env.deploytest MEALY_IMAGE=mealy-app:smoke
   bash scripts/deploy.sh --no-pull     # contiene "[deploy] backup prima dell'aggiornamento" e finisce con "[deploy] fatto: Mealy risponde sulla porta 3100"
   bash scripts/deploy.sh --no-pull     # contiene "[deploy] l'app usa già questa immagine: nessun backup da fare"
   bash scripts/compose-prod.sh down    # senza -v: i dati restano nel volume
   bash scripts/deploy.sh --no-pull     # contiene "[backup] scritto /backups/mealy-predeploy-"
   ls .smoke/deploy-backups             # due file mealy-predeploy-*.sql.gz
   # Ripristino: i due blocchi di docs/DEPLOY.md §7, sul dump più recente
   bash scripts/compose-prod.sh exec -T backup sh /opt/backup/backup.sh manual < /dev/null
   DUMP="$(ls -1t .smoke/deploy-backups/mealy-predeploy-*.sql.gz | head -n 1)"
   gzip -t "$DUMP" \
     && bash scripts/compose-prod.sh stop app \
     && ( echo 'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;'
          gunzip -c "$DUMP" ) \
        | bash scripts/compose-prod.sh exec -T db psql -U mealy -d mealy -q -v ON_ERROR_STOP=1 --single-transaction \
     && echo "ripristino riuscito"       # deve stamparlo
   bash scripts/compose-prod.sh up -d --wait --wait-timeout 180
   curl -sS http://127.0.0.1:3100/api/health; echo      # {"status":"ok"}
   bash scripts/compose-prod.sh exec -T db psql -U mealy -d mealy -At \
     -c "select count(*) from drizzle.__drizzle_migrations" -c "select count(*) from ingredient_aliases"   # 5 e 35
   bash scripts/compose-prod.sh down -v --remove-orphans
   unset MEALY_ENV_FILE MEALY_IMAGE
   rm -rf .smoke .env.deploytest
   docker image rm mealy-app:smoke
   ```
   Le altre prove fatte dopo la code review (dump corrotto, backup che fallisce, immagine nuova con pulizia non riuscita) sono nella tabella in fondo.
   **Mai** lanciare `bash scripts/deploy.sh` senza `--no-pull` in questo ambiente: farebbe `git pull` sul branch di lavoro.
6. A fine prova `docker ps -a --format '{{.Names}}'` non contiene container `mealy-prod-*` né `mealy-smoke-*`, e `mealy-postgres-dev` è ancora attivo.
7. `git status --short` non mostra `.smoke`, `.env.deploytest` né cartelle `backups`.
8. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdi.

Se un passo fallisce, riportare nel resoconto il comando, l'output completo e i log stampati dallo script; non modificare `Dockerfile`, compose o codice dell'app (sono di altri WP): segnalare. Vale anche per il ripristino del criterio 5: lo stesso testo sta in `docs/DEPLOY.md` (WP5), quindi un comando che non funziona si riporta, non si corregge da soli.

### Fuori ambito

- Script di ripristino, di rollback, di installazione del Raspberry o di Tailscale.
- Unit file systemd, cron sull'host, notifiche.
- Qualunque prova su GHCR o sul Raspberry.

---

## Mappa delle dipendenze

```
Wave 1:  WP1 (bootstrap + alias)   ∥   WP2 (health)
              │                          │
              └────────────┬─────────────┘
Wave 2:  WP3 (immagine, compose, backup)   ∥   WP4 (CI)   ∥   WP5 (documenti)
              │
Wave 3:  WP6 (script + prova dello stack)
```

- **Wave 1 — parallelo.** WP1 e WP2 non condividono file. Gate completo a fine wave.
- **Wave 2 — parallelo.** WP3, WP4 e WP5 non condividono file. WP3 richiede che WP1 e WP2 siano nel repo (li incorpora nell'immagine). WP4 e WP5 dipendono dagli altri solo per i nomi del §0.4. Gate completo a fine wave, più i criteri 3–5 di WP3; il gate parte solo a `docker build` di WP3 concluso (regola 0.3.12). A fine wave l'orchestratore confronta `docs/DEPLOY.md` e `.env.production.example` con i blocchi di questo piano (estrazione del blocco e `diff`): sono gli unici due file che nessun test esegue.
- **Wave 3 — sequenziale.** WP6 richiede WP1, WP2 e WP3. È l'unico WP che avvia lo stack: non va eseguito mentre un altro WP sta facendo `docker build` o modificando file.
- Ordine obbligato: WP1, WP2 → WP3 → WP6.

Dopo la wave 3, su GitHub (orchestratore e utente, non implementer), nell'ordine:

1. push del branch, su conferma dell'utente, e apertura della pull request: devono risultare verdi il job `image` del gate **e** il workflow `Image`, che parte sul branch grazie al trigger provvisorio `'feature/7-*'` — fatto il 12 ottobre: pull request #13, `Image`, `gate` e `image` verdi al primo tentativo;
2. facoltativo, sul Raspberry già preparato (`requirements.md §6`, punti 1–4): `docker pull ghcr.io/elverle/mealy:sha-<sha del branch>` prova token, pacchetto e immagine arm64 prima del merge;
3. **commit di chiusura**: in `.github/workflows/image.yml` la riga torna `branches: [main]` e le tre righe di commento sopra spariscono; `actionlint` di nuovo pulito — fatto: il blocco di WP4 mostra il file com'è dopo la chiusura;
4. dopo il merge, workflow `Image` verde su `main`. Poi le attività dell'utente sul Raspberry (`requirements.md §6`).

## Checklist finale

- [x] **WP1** — `lib/db/bootstrap.ts`, `instrumentation.ts`, upsert in `lib/db/seed-core.ts`, messaggi in `lib/db/seed-aliases.ts` e `lib/db/seed.ts`, test `tests/db/bootstrap.test.ts` (con il controllo del journal), `tests/instrumentation.test.ts`, nuovo caso in `tests/db/seed.test.ts`, limite di tempo in `tests/plans/service.test.ts`
- [x] **WP2** — `lib/health/service.ts`, `app/api/health/route.ts`, test `tests/health/service.test.ts`, `tests/api/health.test.ts`
- [x] **WP3** — `next.config.ts`, `Dockerfile`, `.dockerignore`, `docker-compose.prod.yml`, `docker/backup/entrypoint.sh`, `docker/backup/backup.sh`, `.env.production.example`, `.gitattributes`, `.gitignore`
- [x] **WP4** — job `image` in `.github/workflows/gate.yml`, nuovo `.github/workflows/image.yml` (con il trigger provvisorio `'feature/7-*'`)
- [x] **WP5** — `docs/DEPLOY.md`, `README.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md §8`
- [x] **WP6** — `scripts/compose-prod.sh`, `scripts/deploy.sh`, `scripts/smoke-prod.sh`, `SMOKE OK` in locale, ripristino del dump provato
- [x] **Code review** — `/feature-review 7` dell'11 ottobre: 1 major, 12 minor e 2 domande, tutti corretti (tabella in fondo); `requirements.md` allineato
- [x] **Chiusura** — `docs/DEPLOY.md` e `.env.production.example` confrontati con il piano; `Image` verde sul branch; trigger `'feature/7-*'` tolto da `image.yml`

Copertura dei requisiti della spec:

| Requisito | Dove |
|---|---|
| FR-1 sempre acceso | WP3 (`restart: unless-stopped`), WP1 (ritentativi di connessione dopo un riavvio) |
| FR-2 persistenza e migrazioni automatiche | WP3 (volume), WP1 (bootstrap prima delle richieste) |
| FR-3 backup giornaliero con rotazione | WP3 (`backup`, `backup.sh`) |
| FR-4 LAN e Tailscale | WP3 (porta 3000 sull'host), WP5 (guida); verifica a carico dell'utente |
| FR-5 aggiornamento a comando singolo | WP6 (`deploy.sh`), WP4 (immagine pubblicata) |
| AC-1 immagine standalone | WP3, WP4 (arm64 nel workflow `Image`) |
| AC-2 avvio con migrazioni | WP6 (smoke), WP4 (gate) |
| AC-6 dump valido e rotazione | WP3, WP6 (smoke) |
| AC-3, AC-4, AC-5, AC-7 | utente sul Raspberry, con `docs/DEPLOY.md §5` |
| Limite alias della Feature 6 | WP1 (upsert) |

## Correzioni dalla architecture review (2026-10-11)

Riportate da [`architecture-review-2026-10-11.md`](architecture-review-2026-10-11.md). Gli ID sono quelli della review.

| ID | Cosa è cambiato | Dove | Verifica |
|---|---|---|---|
| R1 | Ripristino in transazione unica, con azzeramento degli schemi `public` e `drizzle`; scelta del dump giusto dopo un ritorno indietro | WP5 (`docs/DEPLOY.md §6`, `§7`), WP6 criterio 5 | SQL e opzioni di `psql` provati in un Postgres 16 usa-e-getta (dump buono e dump troncato). Provato poi attraverso `scripts/compose-prod.sh` (criterio 5 di WP6, 11 ottobre): uscita 0; una riga negli alias e una tabella con chiave esterna verso `households`, create dopo il dump, spariscono; 5 migrazioni e 35 alias; l'app riparte sana |
| R2 | Trigger provvisorio `'feature/7-*'` nel workflow `Image`, tolto nel commit di chiusura | WP4 passo 2, "Mappa delle dipendenze" | `actionlint` 1.7.12 pulito sul file con il pattern. Il 12 ottobre `Image` è risultato verde sul branch (run 38215524294, commit `ee4b134`): runner arm64, `SMOKE OK`, login e push su GHCR. Trigger tolto nel commit di chiusura; `actionlint` di nuovo pulito |
| P3 / R5-a | Limite di 15 s per i test di `tests/plans/service.test.ts`; il gate non gira durante `docker build` o smoke | WP1 passo 9, regole 0.3.12 e 0.3.13 | `tsc` pulito. Una copia del file con le tre righe ha passato 30/30 dentro una suite completa lenta (125 s), senza timeout. Nella stessa esecuzione è fallito una volta un test di interfaccia (`tests/ui/ingredient-prefs-section.test.tsx`, `toHaveFocus`), verde da solo e nella suite rilanciata: per questo la regola 0.3.12 vale per ogni test, non solo per questo file. Dopo WP1, tre suite complete di fila (una per wave, mai insieme a `docker build` o smoke) senza timeout né altri fallimenti: 1140/1140 |
| R3 | Test sull'ordine del journal; nota sulle migrazioni e sul ritorno indietro senza ripristino nella guida | WP1 passo 6, WP5 (`docs/DEPLOY.md §9`, `§10`) | Test eseguito, verde, sul journal attuale; `tsc` pulito |
| R4 | Lo smoke fallisce se nel database ci sono ricette | WP6 passo 3 | Eseguito nello smoke di WP6 (`SMOKE OK`, 0 ricette). Non provato il ramo d'errore, con ricette presenti |
| R5-b | `tests/db/bootstrap.test.ts` si ferma con un messaggio se il database di sviluppo è indietro di una migrazione | WP1 passo 6 | `tsc` pulito; il controllo è stato eseguito sul database di sviluppo (5 righe, 5 voci nel journal) e passa. Non provato il ramo d'errore, con il database indietro di una migrazione |
| R6 | Confronto di `docs/DEPLOY.md` e `.env.production.example` con i blocchi del piano | Wave 2, "Mappa delle dipendenze" | Fatto durante `/feature-dev`, byte per byte, per tutti i file creati dai sei WP: identici ai blocchi del piano |
| R7 | Scadenza del token GHCR; il ritorno indietro richiede la rete | WP5 (`docs/DEPLOY.md §3.4`, `§6`) | Solo testo |
| P4 | `DATABASE_URL` vuota trattata come assente anche nel bootstrap | WP1 passo 1 | Solo lettura del codice: lo conferma il typecheck di WP1 |
| — | Branch da `main`; `docker ps` prima di cominciare | §0.2, regola 0.3.13 | — |
| — | Controllo di fine riga con `tr -cd '\r' \| wc -c` al posto di `grep -c $'\r'` (emerso durante la wave 1 di `/feature-dev`) | Regola 0.3.3, WP3 criterio 1, WP6 criterio 1 | Provato su due file di prova: `grep` stampa `0` sia sul file LF sia sul file CRLF, `tr` stampa `0` e `2` |

Non riportata: **P5** (`next lint` non guarda la radice, `tests/` e `scripts/`), che la review rimanda agli aggiornamenti di dipendenze dopo la Feature 7.

## Correzioni dalla code review (2026-10-11)

Da `/feature-review 7`, eseguita sul branch dopo i sei WP: due reviewer, 31 file, 0 blocker, 1 major, 12 minor, 2 domande. L'utente ha chiesto di correggere tutto. Gli ID sono quelli del resoconto presentato all'utente. I blocchi "contenuto esatto" di questo piano sono stati riallineati ai file corretti e riconfrontati byte per byte.

| ID | Cosa è cambiato | Dove | Verifica |
|---|---|---|---|
| M1 | `deploy.sh` fa sempre il dump `predeploy`, dopo aver avviato `db` e `backup`; se il dump non riesce si ferma prima di toccare l'app. Tolto il ramo "primo avvio", che scattava anche dopo un `down` o con il servizio `backup` in errore | `scripts/deploy.sh`, `docs/DEPLOY.md §6`, `§9`, WP6 criterio 5 | Prova dello stack: al primo avvio dump di un database vuoto (370 byte); dopo un `down` il dump viene fatto (3471 byte, contiene gli alias) e il messaggio di primo avvio non compare. Con il backup che fallisce: uscita 1, `FALLITO: backup non riuscito`, app non avviata, nessun dump aggiunto o cancellato |
| Q1 | Il dump si salta solo se l'app sta già girando con la stessa immagine (confronto degli ID) | `scripts/deploy.sh`, `docs/DEPLOY.md §6`, `§7` | Seconda esecuzione con la stessa immagine: messaggio `l'app usa già questa immagine`, resta un solo dump. Con un'immagine diversa (`mealy-app:smoke2`, ID diverso): dump fatto |
| m1 | La pulizia delle immagini vecchie non è fatale e ignora le immagini senza tag | `scripts/deploy.sh`, `docs/DEPLOY.md §8`, `§9` | Con un'immagine dello stesso repository usata da un altro container: avviso, poi `[deploy] fatto` e uscita 0; l'immagine vecchia non in uso viene rimossa. Non provata l'esclusione delle righe `<none>`: servirebbe un registro |
| m2 | Lo smoke cerca la riga degli alias senza `grep -q` | `scripts/smoke-prod.sh` | `SMOKE OK`. Il falso fallimento da SIGPIPE non era riproducibile a comando |
| m3 | Messaggio esplicito quando `git rev-parse` fallisce | `scripts/compose-prod.sh`, `docs/DEPLOY.md §9` | Copia dello script in una cartella senza `.git`: messaggio e uscita 1, Docker non viene chiamato |
| m4 | Token e utente del login a GHCR passano da `env:`; il commento del trigger provvisorio cita il percorso del piano | `.github/workflows/image.yml` | `actionlint` 1.7.12 pulito sui due workflow. Il login gira solo su GitHub |
| m5 | `BACKUP_KEEP` con zeri iniziali rifiutato | `docker/backup/backup.sh` | `BACKUP_KEEP=00`: uscita 2 con il messaggio, nessun dump cancellato |
| m6 | Attesa crescente di postgres-js disattivata nel bootstrap | `lib/db/bootstrap.ts`, `tests/db/bootstrap.test.ts` | Test nuovo: rosso senza la riga (25,8 s contro il limite di 10), verde con la riga |
| m7 | Lo schema delle fixture rifiuta gli alias duplicati | `lib/domain/types.ts`, `tests/domain/generation-contracts.test.ts` (WP1 passo 10) | Test nuovo verde; le fixture attuali (35 alias) passano |
| m8 | Journal controllato nei due sensi; asserzione sul messaggio per la cartella mancante; ultima migrazione applicata a un database usa-e-getta fermo alla precedente | `tests/db/bootstrap.test.ts` | Verdi. A fine suite nessun database `mealy_bootstrap_*` e nessuna cartella temporanea rimasti; il database di sviluppo ha ancora 5 migrazioni |
| m9 | Ripristino concatenato con `&&`, preceduto da un dump `manual` dello stato corrente | `docs/DEPLOY.md §7`, WP6 criterio 5 | I due blocchi estratti dalla guida ed eseguiti così come sono. Dump corrotto: `ripristino riuscito` non compare, database invariato. Dump buono: `ripristino riuscito`, 5 migrazioni, 35 alias, riga e tabella create dopo il dump sparite, app sana |
| m10 | Lo smoke prova la rotazione dei backup; la verifica della guida ha una riga per il backup notturno | `scripts/smoke-prod.sh`, `docs/DEPLOY.md §5` | Smoke: `[backup] rimosso`, resta solo il dump più recente. Il cron notturno resta da verificare sul Raspberry |
| m11 | Sei lacune della guida: `git` da installare, quale commit per il ritorno indietro, disco USB non montato, utente di `scp`, ripartenza dopo `down`, variabili di `openai-compatible` | `docs/DEPLOY.md §3.3`, `§3.5`, `§6`, `§7`, `§8` | Solo testo, confrontato con script, compose e `lib/llm/model.ts` |
| m12 | `requirements.md` allineato: ripristino, trigger provvisorio, sequenza di `deploy.sh`, passi di chiusura; nuovo §8 con le decisioni della code review | `requirements.md` P6, P10, P15, P16, P18, §5, §7, §8 | Solo testo |
| Q2 | Avvertenza su IPv6 e su Docker che scavalca `ufw` | `docs/DEPLOY.md §1` | Solo testo |
| — | La guida distingue un errore sugli alias da una migrazione fallita (imprecisione segnalata su R3) | `docs/DEPLOY.md §9` | Solo testo |

Gate dopo le correzioni: `pnpm lint`, `pnpm typecheck` e `pnpm build` verdi; `pnpm test` 84 file e 1143 test su 1143 (tre in più di prima), 75 s, senza Docker in esecuzione. Alla prima esecuzione, subito dopo la prova dello stack e con la macchina molto lenta (183 s), due file dell'interfaccia non erano partiti (`Failed to start forks worker` per `tests/ui/plan-screen.test.tsx` e `tests/ui/shopping-screen.test.tsx`): nessun test fallito, ma 82 file su 84. Rilanciati da soli passano 97 su 97; la suite rilanciata è quella verde riportata qui (regola 0.3.12).

Restano non provati: il cron notturno, l'esclusione delle immagini `<none>`, il ramo d'errore del controllo sulle ricette nello smoke (R4), e tutto ciò che gira solo su GitHub o sul Raspberry.
