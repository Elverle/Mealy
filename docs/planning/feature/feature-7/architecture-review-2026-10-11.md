# Architecture review — Feature 7 (E6 Deploy: Raspberry Pi + Tailscale)

**Data:** 2026-10-11 · **Piano esaminato:** [`plan.md`](plan.md) (+ [`requirements.md`](requirements.md), [`spec.md`](spec.md)) · **Contesto:** as-built di F1–F6 e del fix `lista-ordine-stabile` (`main`, commit `9bc43b5`, v0.5.1), `docs/ARCHITECTURE.md` (§7, §8), `docs/planning/execution-strategy.md` (§3 Feature 7, §4), review di F6 (P3, R4), `CLAUDE.md`.

**Esito in una riga:** nel codice attuale non c'è nulla di bloccante e il piano poggia su fatti veri (tutte le ipotesi della §0.2 controllate sotto). C'è però un difetto riprodotto nella guida che il piano fa scrivere: **il ripristino documentato fallisce e lascia il database a metà proprio nel caso per cui esiste** (R1). Va corretto prima, ed è solo testo. Altre due cose conviene sistemarle prima di partire: la pubblicazione dell'immagine si prova solo dopo il merge (R2) e il gate locale oggi è al limite del timeout (P3/R5).

> **Nota sugli ID.** `P1…P5` e `R1…R7` sono gli ID di questa review. Le decisioni di `requirements.md` (che usa anch'esso `P1…P28` e `U1…U4`) sono sempre citate come «req. P*n*» / «req. U*n*».

## Metodo e prove raccolte

- **Stato del repo.** La cartella di lavoro è sul branch `fix/lista-ordine-stabile` (`3e9f387`); `main` è al merge `9bc43b5` e ha lo stesso contenuto (`git diff main --stat` mostra solo i due file di planning non committati). Non committati: `plan.md` e `requirements.md` di F7, `feature-index.md`, e `.claude/agentic-feature-factory.local.md` con `implementer: sonnet → haiku`.
- **Gate sul codice attuale** (Postgres di sviluppo `mealy-postgres-dev` sulla 5432, già acceso; `smart-portfolio-db` spento): `lint` ✅, `typecheck` ✅, `build` ✅. **`test` non è uscito verde**:
  - prima esecuzione, mentre in parallelo giravano le mie prove su un secondo container Postgres: 80 file, **11 falliti su 1122**, tutti `Test timed out in 5000ms` in `tests/plans/service.test.ts` (209 s);
  - seconda esecuzione, da sola: **1 fallito su 1122**, `tests/plans/service.test.ts:382` a 5250 ms (77 s);
  - il solo file `tests/plans/service.test.ts`: 30/30 verdi in 34 s.
  - Nessuna asserzione fallita: sono solo timeout. Le esecuzioni documentate prima di oggi erano verdi (835/835 nella review di F6; 1139/1139 sul prototipo del piano). Vedi P3.
- **Conti del piano.** 1122 test oggi + 17 nuovi (3 bootstrap, 7 instrumentation, 1 seed, 3 + 3 health) = 1139 in 84 file: coincide con `requirements.md §5`.
- **Ipotesi della §0.2 verificate sul codice.** `next.config.ts` vuoto, Next 15.5.25, drizzle-orm 0.45.3, postgres 3.4.9; `lib/db/index.ts` (`client`, `db`, `DbExecutor`, ripiego sull'URL di sviluppo); `seedIngredientAliases(executor = db)` con `onConflictDoNothing` (`lib/db/seed-core.ts:15-22`); 5 migrazioni e journal; 35 alias in `fixtures/ingredient-aliases.json`; `.gitignore` con `.env.*`; nessun `public/`, `Dockerfile`, `instrumentation.ts`, `middleware.ts`; in `scripts/` c'è solo `llm-record.ts`; `pnpm-workspace.yaml` esiste (lo copia il Dockerfile).
- **Ancore dei documenti di WP5.** Le righe da sostituire esistono con il testo citato dal piano: `README.md:77` e `:85`, `CLAUDE.md:19`, `:32`, `:36`, `docs/ARCHITECTURE.md:324`.
- **Confini dei WP.** Gli elenchi "File" dei sei WP non si sovrappongono, né dentro una wave né tra wave.
- **Migratore letto in `node_modules`.** `drizzle-orm/pg-core/dialect.js:56-71` e `drizzle-orm/migrator.js:3-30`: vedi P1.
- **Ripristino provato** in un Postgres 16 usa-e-getta (`postgres:16-alpine`, senza porte pubblicate, rimosso a fine prova), con le migrazioni vere del repo e un dump fatto con le stesse opzioni di `backup.sh`: vedi R1.
- **Non verificato:** la build dell'immagine e lo smoke (mi affido al prototipo di `requirements.md §5`), l'esecuzione arm64, GHCR, tutto ciò che dipende dal Raspberry. Il rimedio di R1 l'ho provato con `psql` dentro il container, non attraverso `scripts/compose-prod.sh`, che ancora non esiste.

---

## 1. Problemi attuali (ordinati per impatto)

### P1 — Il migratore decide per orario, non per elenco, e nessun test guarda il journal · **da tenere d'occhio**

**File:** `node_modules/drizzle-orm/pg-core/dialect.js:56-62`, `lib/db/migrations/meta/_journal.json`, `tests/db/schema.test.ts:371-380`.

- Il migratore legge **solo l'ultima** riga di `drizzle.__drizzle_migrations` e applica le migrazioni il cui `when` è più grande. Non confronta l'elenco e non controlla gli hash.
- Conseguenza: una migrazione con un `when` più vecchio dell'ultima applicata viene saltata in silenzio. Succede se due branch generano migrazioni e si fondono nell'ordine inverso, o se un `when` viene ritoccato a mano. Nel journal il `when` della prima voce è `1700000000000`, cioè scritto a mano: la pratica esiste già.
- Stessa cosa per una migrazione modificata dopo essere stata applicata: non viene rieseguita e nessuno se ne accorge.
- L'unico test sul journal controlla che esista e abbia almeno una voce.
- Finora non contava: un database di sviluppo si rifà. Con dati veri no.

### P2 — Alias (dato di produzione) e ricette di esempio (dato di sviluppo) vivono nello stesso modulo · **da tenere d'occhio**

**File:** `lib/db/seed-core.ts:1-5`, `:15-22`, `:24-79`; `fixtures/index.ts:13-15`.

- `seedIngredientAliases` e `seedDatabase` (household + 18 ricette) stanno a dieci righe di distanza. Il modulo importa i repository di ricette e household e `@/fixtures`, che all'import valida con Zod **entrambi** i file JSON.
- È il residuo di P3 della review di F6: il canale separato c'è (`db:seed:aliases`), il modulo no.
- La regola "le ricette di esempio non entrano mai in produzione" (README, `CLAUDE.md`, req. P7) oggi è garantita solo dal fatto che nessuno chiama la funzione sbagliata. C'è un test che lo controlla per `seedIngredientAliases` (`tests/db/seed.test.ts:66-94`), nessuno sul percorso di produzione.

### P3 — Il gate locale è al limite del timeout e usa un database condiviso · **da tenere d'occhio**

**File:** `vitest.config.ts` (nessun `testTimeout`: vale il default di 5000 ms), `tests/plans/service.test.ts` (30 test su DB, 54 s dentro la suite completa), `tests/helpers/db.ts:9-19`.

- Misurato oggi: 1 timeout a macchina scarica, 11 con un secondo container Postgres al lavoro, 0 con il file da solo (dettaglio in "Metodo"). Il test che cede per primo fa due `generatePlan` di fila (`:382`).
- Il database dei test è quello di sviluppo, condiviso tra i file che girano in parallelo. L'ho trovato pulito (1 household, 18 ricette, 35 alias): i test ripuliscono, quindi la lentezza non viene da dati accumulati.
- Se il database non risponde, i test DB si saltano e la suite resta verde; in CI lo impedisce `pnpm db:migrate` prima dei test (`.github/workflows/gate.yml:55-57`), in locale no. Il piano lo sa e lo scrive (regola 0.3.6).
- Perché è un problema adesso: `/feature-dev` fa un commit per WP solo a gate verde, e un rosso casuale blocca la pipeline o manda un implementer a "correggere" un test sano.

### P4 — La configurazione della connessione è ripetuta · **cosmetico**

**File:** `lib/db/index.ts:5-6`, `drizzle.config.ts:8`.

- L'URL di sviluppo di ripiego è scritto in due file; se `DATABASE_URL` manca in produzione l'app prova `localhost` invece di fermarsi con un messaggio. Il compose del piano la imposta sempre, quindi non si vede.

### P5 — `next lint` guarda solo `app`, `components`, `lib` · **cosmetico**

**File:** `node_modules/next/dist/lib/constants.js:291-297`, `.eslintrc.json`.

- `tests/`, `scripts/` e i file nella radice non passano dal lint. Vale anche per `instrumentation.ts`, che F7 aggiunge. Il typecheck li copre tutti.

### Aree senza problemi da segnalare

- **Fuso orario.** La logica usa un fuso esplicito (`APP_TIME_ZONE = 'Europe/Rome'`, `lib/domain/planner-config.ts:50`, `todayInTimeZone` in `lib/domain/week.ts:21`). La variabile `TZ` dei container tocca solo log e backup, come dice il commento di `.env.production.example`.
- **Guard di onboarding.** Sta in `app/(app)/layout.tsx:11-13` e non c'è `middleware.ts`: `/api/health` non viene intercettata.
- **Rotte API.** Tutte dichiarano `runtime` e `dynamic` e usano le buste di `lib/http/responses.ts`; la rotta di WP2 segue lo stesso schema.
- **Configurazione LLM.** Letta da `process.env` a ogni richiesta (`lib/llm/model.ts:46`): le variabili del compose valgono senza ricostruire l'immagine.
- **HTTP senza TLS (req. P20).** `crypto.randomUUID` compare solo in codice server (`lib/recipes/generate.ts:55`, `lib/db/repositories/recipe-repo.ts:110`, `:140`); nei componenti non c'è clipboard né service worker.
- **Upsert degli alias e test esistenti.** I test che scrivono alias propri usano nomi casuali (`tests/db/shopping-repo.test.ts:267-270`, `tests/shopping/service.test.ts:366-369`): l'upsert non li tocca.
- **Pool dell'app.** `postgres()` si connette alla prima query: importare `seed-core` dal bootstrap non apre connessioni in più.

---

## 2. Rischi introdotti o amplificati dalla feature

### R1 — Il ripristino della guida fallisce dopo una migrazione che aggiunge una tabella · **bloccante per la guida (WP5), non per il codice**

**Piano:** WP5, `docs/DEPLOY.md §7` ("Ripristino") e `§6` ("Tornare a una versione precedente"); req. P15 e P16.

- `§6` manda l'utente a ripristinare il dump `predeploy` quando la versione nuova ha cambiato lo schema. Il dump è fatto con `--clean --if-exists`: cancella solo gli oggetti che conosce.
- Prova: schema alle migrazioni 0000–0003, dump, poi 0004 (tabella `ingredient_prefs` con chiave esterna verso `households`), poi il comando di `§7` così com'è scritto.
  - Esito: `ERROR: cannot drop constraint households_pkey … because other objects depend on it`, uscita 3.
  - Stato dopo: chiavi esterne da 9 a 1, indici da 21 a 2, dati non ripristinati, tabella delle migrazioni ancora a 5 righe. Il comando non è una transazione: quello che ha cancellato prima dell'errore resta cancellato. Rilanciarlo dà lo stesso errore.
- Il prototipo del piano ha provato il ripristino sullo stesso schema (req. P16), dove funziona.
- Rimedio provato: azzerare gli schemi `public` e `drizzle` e caricare il dump nella stessa transazione.
  - Dump buono: uscita 0, 8 chiavi esterne, 20 indici, 4 migrazioni, dati tornati; la 0004 si riapplica senza errori.
  - Dump troncato: errore, e il database resta identico a prima.

### R2 — La pubblicazione dell'immagine si prova per la prima volta dopo il merge · **da tenere d'occhio**

**Piano:** WP4 passo 2 (`image.yml`, `on.push.branches: [main]` + `workflow_dispatch`); "Dopo la wave 3"; `requirements.md §5` ("Non provato su questo repo").

- Il workflow `Image` è l'unica strada con cui il software arriva sul Raspberry. Runner `ubuntu-24.04-arm`, login a GHCR, push, legame pacchetto–repository: nessuno di questi passi gira nella pull request.
- `workflow_dispatch` non aiuta prima del merge: GitHub lo offre solo per i workflow presenti sul branch di default.
- Se qualcosa non va, `main` contiene la feature ma nessuna immagine, e la correzione è un'altra pull request.

### R3 — Il percorso di aggiornamento non è provato da nessuna parte · **da tenere d'occhio** — amplifica P1

**Piano:** WP1 (`runDbBootstrap` → `migrate`), WP6 (`smoke-prod.sh`), WP4 (job `image`).

- Lo smoke e il gate partono sempre da un database vuoto, dove il migratore applica tutto. Il test di WP1 gira su un database già allineato, dove non applica nulla. Il caso reale di ogni deploy dopo il primo (database alla versione N, immagine alla N+1) non lo esegue nessuno.
- Con le migrazioni applicate all'avvio e senza nessuno a guardare, il difetto di P1 diventa: l'app parte, `/api/health` risponde 200 (`select 1`), `deploy.sh` stampa `fatto`, e le rotte che usano la colonna mancante danno errore.
- Nota a favore del piano, verificata sul migratore: tutte le migrazioni in attesa girano in **una transazione** (`dialect.js:60-71`). Una migrazione che fallisce non lascia il database a metà, e si torna alla versione precedente senza ripristinare nulla. La guida non lo dice.

### R4 — Il codice di avvio in produzione importa il modulo delle ricette di esempio · **da tenere d'occhio** — amplifica P2

**Piano:** WP1 passo 1 (`import { seedIngredientAliases } from './seed-core'`).

- Con F7 `seed-core.ts`, i 18 esempi di `fixtures/recipes.json` e `seedDatabase` entrano nell'immagine di produzione e vengono caricati a ogni avvio. Non vengono eseguiti.
- Lo smoke controlla che gli alias ci siano, non che le ricette **non** ci siano. È la regola di prodotto scritta in tre documenti, e sul percorso di produzione non ha un controllo.

### R5 — Più test DB e build Docker sulla stessa macchina · **da tenere d'occhio (processo)** — amplifica P3

**Piano:** regola 0.3.11 (gate verde per ogni WP), WP3 e WP6 (`docker build`, circa 5 minuti), `tests/db/bootstrap.test.ts`.

- Gli 11 timeout li ho visti con un secondo container Postgres al lavoro sulla stessa macchina. Un gate lanciato durante un `docker build` o uno smoke è una condizione più pesante di quella.
- Effetto collaterale minore: `runDbBootstrap({ attempts: 1 })` nel test migra davvero il database di sviluppo se è indietro di una migrazione (`assertDbMigrated` controlla solo `recipes` e `pg_trgm`). Il test fallisce una volta ("applies nothing new") dopo aver cambiato lo schema sotto gli altri file in esecuzione, e alla seconda passa. Contraddice il criterio "`pnpm test` non esegue migrazioni da solo".

### R6 — "Copiare così com'è" non ha verifica per i file che sono solo testo · **cosmetico (processo)**

**Piano:** regola 0.3.1; WP5 (`docs/DEPLOY.md`, 235 righe); WP3 (`.env.production.example`); configurazione locale con `implementer: haiku`.

- Codice, compose e script sono coperti da test, `bash -n`, `actionlint` e smoke: una trascrizione sbagliata si vede. La guida e il file d'esempio no, e sono i due file che l'utente segue sul Raspberry con `sudo`.

### R7 — Due scadenze che la guida non nomina · **cosmetico**

**Piano:** `docs/DEPLOY.md §3.4`, `scripts/deploy.sh` (rimozione delle immagini vecchie).

- Il token classico di GitHub nasce con una scadenza (il modulo ne propone una di default). Quando scade, `deploy.sh` fallisce con `denied`; la tabella dei guasti lo copre, il passo di creazione no.
- `deploy.sh` tiene solo l'immagine in uso: tornare indietro richiede sempre GHCR e un token valido. È una scelta sensata per la microSD (233 MB per immagine); basta saperlo.

### Complessità e scorciatoie

Non ho trovato complessità sproporzionata. Le scelte vanno tutte verso il meno: comandi `docker` semplici invece di action di terze parti, ripristino documentato invece di uno script, nessuna pulizia automatica di GHCR, un solo script di smoke usato in locale, nel gate e prima del push. Il job `image` aggiunge una build Docker a ogni pull request, ma è una decisione dell'utente (req. U4) ed è l'unico punto in cui `output: 'standalone'` viene esercitato.

Tre scorciatoie consapevoli, da dire come sono: `aliasesInserted` conta anche le correzioni (req. P27); i backup di default stanno sulla stessa microSD del database (req. P17, scelta dell'utente); il percorso di aggiornamento non ha un test (R3), e il suo paracadute è il dump `predeploy`. Per questo R1 pesa più di quanto sembri.

---

## 3. Proposte e punto di innesto

Le correzioni a testi "da copiare" vanno **prima riportate in `plan.md`**: così la regola 0.3.1 resta vera e il confronto di R6 ha un solo riferimento.

| ID | Proposta concreta | Dimensione | Dove si innesta | Quando |
|---|---|---|---|---|
| **R1** | In `docs/DEPLOY.md §7` sostituire il paragrafo "Ripristino" e il suo blocco con il testo riportato sotto la tabella. In `§6`, dopo "ripristina il dump `mealy-predeploy-…` fatto prima dell'aggiornamento (§7)", aggiungere: "Scegli quello con l'orario precedente all'aggiornamento: anche il ritorno indietro ne crea uno, con lo schema nuovo." In WP6, criterio 5, dopo il secondo `deploy.sh --no-pull`: eseguire il blocco di ripristino sul dump `predeploy` appena creato, poi `bash scripts/compose-prod.sh up -d --wait` e controllare `/api/health`. | Piccola | **WP5** passo 1 (`§6`, `§7`); **WP6** criterio 5 | **Prima** (è testo del piano) |
| **R2** | In `image.yml` scrivere `branches: [main, 'feature/7-*']`. Al push del branch (su conferma dell'utente) partono sia il gate della PR sia `Image`: si vedono verdi runner arm64, smoke arm64, login e push. Facoltativo ma utile: sul Raspberry, `docker pull ghcr.io/elverle/mealy:sha-<sha del branch>` prova anche token e pacchetto. Nel commit di chiusura la riga torna `branches: [main]`. Aggiornare i criteri di WP4 e il paragrafo "Dopo la wave 3". | Piccola | **WP4** passo 2 e criteri; commit di chiusura di `/feature-dev` | **Prima** (trigger) e **dopo** la wave 3 (rimozione) |
| **P3 / R5-a** | In testa a `tests/plans/service.test.ts`, dopo gli import: `vi.setConfig({ testTimeout: 15_000 });`. `vi` è già importato (`:3`). Alternativa equivalente: `testTimeout: 15_000` in `vitest.config.ts`. Non l'ho provata: la conferma è una suite completa verde. Regola per l'orchestratore, da aggiungere alla §0.3: "il gate non si lancia mentre gira un `docker build` o lo smoke; un `Test timed out` in `tests/plans/service.test.ts` si verifica rilanciando quel file da solo prima di trattarlo come regressione". | Minima | **WP1** (file in più: `tests/plans/service.test.ts`), oppure commit a parte prima della wave 1; §0.3 del piano | **Prima** (ogni gate della pipeline ne dipende) |
| **R3** (+P1) | In `tests/db/bootstrap.test.ts` un `describe` senza database (codice sotto la tabella): le voci del journal hanno `idx` consecutivi, `when` strettamente crescente e un file `.sql` ciascuna. In `docs/DEPLOY.md §10` una riga: "**Migrazioni**: una migrazione arrivata su `main` non si modifica, se ne aggiunge una nuova; il migratore guarda solo l'orario dell'ultima applicata." Nella tabella di `§9`, alla riga "lo stack non è diventato sano", aggiungere al rimedio: "Una migrazione fallita non modifica il database: torna alla versione precedente (§6) senza ripristinare nulla." | Piccola | **WP1** passo 6; **WP5** passo 1 (`§9`, `§10`) | Durante |
| **R4** (+P2) | In `scripts/smoke-prod.sh`, nel blocco "migrazioni e alias", una verifica in più: `[ "$(query "select count(*) from recipes")" = "0" ] \|\| fail "ci sono ricette nel database: il bootstrap non deve inserirne"`. Separare `seedIngredientAliases` in un modulo senza le ricette resta possibile dopo, e non lo considero necessario: questa riga prova la regola sull'immagine vera. | Minima | **WP6** passo 3 | Durante |
| **R5-b** | Nel `beforeAll` del secondo `describe` di `tests/db/bootstrap.test.ts`: se `countMigrations()` è diverso dal numero di voci del journal, lanciare `'Database di sviluppo non allineato: esegui \`pnpm db:migrate\` prima dei test.'`. Così il test non migra mai da solo. | Minima | **WP1** passo 6 | Durante. Facoltativa |
| **R6** | A fine wave 2 l'orchestratore confronta `docs/DEPLOY.md` e `.env.production.example` con i blocchi di `plan.md` (estrazione del blocco e `diff`), come ha fatto il planning per il codice. | Minima | Gate di fine wave 2 | Dopo WP3 e WP5 |
| **R7** | In `docs/DEPLOY.md §3.4`, dopo "con il solo scope `read:packages`": "Scegli tu la scadenza: quando il token scade, `deploy.sh` si ferma con `denied` e va rifatto questo passo." In `§6`, in coda a "Tornare a una versione precedente": "Serve la rete: sul Raspberry resta solo l'immagine in uso." | Minima | **WP5** passo 1 | Durante |
| **P4** | In `lib/db/bootstrap.ts` usare `\|\|` al posto di `??` dopo `process.env.DATABASE_URL`, come `lib/db/index.ts:6`: una variabile vuota porta allo stesso URL nei due moduli. | Minima | **WP1** passo 1 | Durante. Facoltativa |
| **P5** | Nessuna azione in F7. Da riprendere con gli aggiornamenti di dipendenze dopo la feature (req. P25): `next lint` è deprecato e il passaggio all'ESLint CLI è il momento per includere radice, `tests/` e `scripts/`. | — | Fuori da F7 | Dopo |
| **—** | Il branch `feature/7-<slug>` va creato da `main` (`9bc43b5`), non dal branch corrente. Prima di cominciare: `docker ps` (5432 di `mealy-postgres-dev`, 3100 libera per lo smoke). | Minima | Avvio di `/feature-dev 7` | Prima |

**Testo per R1** (`docs/DEPLOY.md §7`):

````markdown
**Ripristino.** Sostituisce tutto il contenuto del database con quello del dump. È una transazione unica: se qualcosa va storto, il database resta com'era.

```bash
cd /opt/mealy
DUMP=backups/mealy-daily-AAAAMMGG-HHMMSS.sql.gz
gzip -t "$DUMP" && echo "dump integro"     # se non lo stampa, fermati qui
bash scripts/compose-prod.sh stop app
( echo 'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;'
  gunzip -c "$DUMP" ) \
  | bash scripts/compose-prod.sh exec -T db psql -U mealy -d mealy -q -v ON_ERROR_STOP=1 --single-transaction
bash scripts/compose-prod.sh start app
```
````

Il controllo `gzip -t` non è decorativo: con `--single-transaction` un file che finisce a metà su un confine di istruzione verrebbe confermato come ripristino parziale.

**Codice per R3** (`tests/db/bootstrap.test.ts`, con `import fs from 'node:fs'` e `import path from 'node:path'` in testa):

```ts
describe('migrations journal', () => {
  it('lists migrations in strictly increasing order, each with its SQL file', () => {
    // Il migratore applica solo le migrazioni con `when` maggiore dell'ultima applicata:
    // una voce fuori ordine verrebbe saltata in silenzio su un database già popolato.
    const folder = path.join(process.cwd(), 'lib', 'db', 'migrations');
    const journal = JSON.parse(
      fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf-8')
    ) as { entries: { idx: number; when: number; tag: string }[] };

    journal.entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
      expect(fs.existsSync(path.join(folder, `${entry.tag}.sql`))).toBe(true);
      if (i > 0) expect(entry.when).toBeGreaterThan(journal.entries[i - 1].when);
    });
  });
});
```

Il journal di oggi lo supera (`1700000000000 < 1789480265545 < 1790596533704 < 1790681198301 < 1791218715544`). Non l'ho eseguito: va nel gate di WP1.

---

## 4. Se potessi migliorare solo 3 cose prima di procedere

1. **R1 — Il ripristino.** Il piano applica le migrazioni da solo, senza ritorno, e indica il dump `predeploy` come punto di ritorno. La procedura che lo usa oggi si rompe alla prima migrazione che aggiunge una tabella e peggiora lo stato del database. È l'unico difetto di questa review che ho riprodotto, e si chiude cambiando dieci righe di guida e aggiungendo una prova a WP6.
2. **R2 — Vedere `Image` verde prima del merge.** Tutto il resto del piano è stato provato su un prototipo; la pubblicazione no, e non può esserlo in una pull request. Un pattern di branch nel trigger, tolto nel commit di chiusura, sposta la scoperta di un problema di runner, permessi o pacchetto a prima del merge, e permette all'utente di provare il `pull` dal Raspberry con un'immagine vera.
3. **P3 / R5-a — Un gate che non diventa rosso da solo.** Oggi `pnpm test` ha un timeout su 1122 a macchina scarica e undici sotto carico. La pipeline fa almeno un gate per WP più quelli di fine wave, con `docker build` in mezzo: un rosso casuale è probabile, e costa più della riga che lo evita.

**R3** viene subito dopo: un test di dodici righe copre il modo più comune in cui una migrazione viene saltata in silenzio, che dopo F7 succederebbe in produzione e non in sviluppo. **R4** è una riga nello smoke. R5-b, R6, R7 e P4 si possono saltare senza danni strutturali; P5 non riguarda questa feature.
