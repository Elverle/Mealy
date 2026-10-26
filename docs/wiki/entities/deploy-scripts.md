---
title: Script Operativi — compose-prod.sh, deploy.sh e smoke-prod.sh (deploy-scripts)
type: entity
created: 2026-10-11
updated: 2026-10-26
tags: [scripts, bash, deploy, compose, smoke-test, backup, raspberry-pi, ghcr, production, recipe-pack, feature-7, feature-10]
---

## File e Responsabilità

- **Percorsi file**:
  - `scripts/compose-prod.sh`: `docker compose` per lo stack di produzione, con il file d'ambiente e l'immagine giusti.
  - `scripts/deploy.sh [--no-pull]`: aggiornamento a comando singolo sul Raspberry.
  - `scripts/smoke-prod.sh <immagine>`: prova lo stack di produzione con un'immagine già costruita.
- **Scopo**: ridurre il deploy a un comando e rendere lo stesso stack provabile su un PC e in CI. I tre script si lanciano sempre con l'interprete (`bash scripts/….sh`): su Windows non si può contare sul bit di esecuzione, e `.gitattributes` impone il fine riga LF (requirements P19 della Feature 7).

Ogni script si sposta per prima cosa nella radice del repository, quindi funziona da qualsiasi cartella. Le procedure per chi opera il Raspberry sono in `docs/DEPLOY.md` (§4 primo avvio, §6 aggiornamento, §8 comandi utili, §9 guasti).

## `scripts/compose-prod.sh`

```bash
bash scripts/compose-prod.sh <argomenti di docker compose>     # es.: ps | logs -f app
```

Esegue `docker compose --env-file <file> -f docker-compose.prod.yml "$@"` dopo aver risolto due valori:

| Variabile | Default | Significato |
|---|---|---|
| `MEALY_ENV_FILE` | `.env.production` | File d'ambiente. Se manca: `Manca <file>: copialo da .env.production.example e compilalo.` e uscita 1 |
| `MEALY_IMAGE` | `ghcr.io/elverle/mealy:sha-<git rev-parse HEAD>` | Immagine del servizio `app`. Se `git rev-parse` fallisce (script lanciato con `sudo`, o da una cartella che non è la copia clonata): messaggio e uscita 1, senza chiamare Docker |

Esporta anche `MSYS_NO_PATHCONV=1`, perché Git Bash su Windows non converta i percorsi del container (`/opt/backup/…`) in percorsi Windows.

**Perché il tag viene dal commit** (requirements P9): il compose e gli script in `git` e l'immagine in esecuzione sono sempre della stessa versione. Se il workflow `Image` non ha ancora pubblicato l'immagine di quel commit, il pull fallisce invece di avviare un'immagine vecchia; tornare a una versione precedente è un `git checkout` ([[ci-workflows]]).

Il compose di produzione va usato **sempre** attraverso questo script: chiamato a mano senza `MEALY_IMAGE` si ferma con `Imposta MEALY_IMAGE oppure usa scripts/compose-prod.sh` ([[production-stack]]).

## `scripts/deploy.sh`

```bash
bash scripts/deploy.sh              # aggiornamento completo
bash scripts/deploy.sh --no-pull    # riapplica la configurazione con ciò che c'è già in locale
```

Un argomento diverso fa uscire con 2. Il corpo sta in una funzione `main`: bash la legge per intero prima di eseguirla, quindi `git pull` può aggiornare il file dello script senza disturbare l'esecuzione in corso.

| # | Passo | Se fallisce |
|---|---|---|
| 1 | `git pull --ff-only` (saltato con `--no-pull`) | Lo script si ferma (`set -e`) |
| 2 | `compose pull app`: scarica l'immagine del commit (saltato con `--no-pull`) | `immagine non trovata per il commit …`, con il suggerimento di attendere il workflow `Image` o rifare `docker login ghcr.io`; uscita 1 |
| 3 | **Dump `predeploy`**, a meno che l'app stia già girando con la stessa immagine | v. sotto |
| 4 | `compose up -d --remove-orphans --wait --wait-timeout 180` | `FALLITO: lo stack non è diventato sano entro 180 secondi`, ultime 60 righe di log dell'app, uscita 1 |
| 5 | `curl` su `http://127.0.0.1:<porta>/api/health` (limite 10 s); la porta viene da `compose port app 3000` | `FALLITO: /api/health non risponde sulla porta <porta>`, uscita 1 ([[health-check]]) |
| 6 | Rimozione delle immagini dell'app non più in uso | Solo un avviso: il deploy è riuscito |

In fondo: `[deploy] fatto: Mealy risponde sulla porta <porta>`.

### Passo 3: il dump prima delle migrazioni

Le migrazioni partono da sole quando si avvia l'immagine nuova e non tornano indietro ([[db-bootstrap]]): il dump è il punto di ritorno (requirements P15).

- **Quando si salta**: solo se l'app è in esecuzione **e** l'ID dell'immagine del container coincide con l'ID dell'immagine da avviare (`docker inspect` sul container, `docker image inspect` sul nome dell'immagine). Con la stessa immagine lo schema non può cambiare. Saltarlo evita che le riesecuzioni con `--no-pull` facciano uscire dalla rotazione il dump con lo schema precedente (requirements C1).
- **In ogni altro caso** (immagine diversa, primo avvio, app ferma dopo un `down`):
  1. `compose up -d --wait --wait-timeout 120 db backup`: avvia solo database e servizio di backup. Se non partono: `FALLITO: il database o il servizio di backup non partono. L'app non è stata aggiornata.` e uscita 1;
  2. `compose exec -T backup sh /opt/backup/backup.sh predeploy` ([[backup-service]]). Se fallisce: `FALLITO: backup non riuscito. L'app non è stata aggiornata…` e uscita 1.

Il dump **non dipende** dal fatto che il servizio `backup` fosse già acceso: lo avvia lo script. In nessun caso l'app viene aggiornata senza un dump riuscito. Al primo avvio il dump è quello di un database vuoto.

### Passo 6: pulizia

Sul Raspberry resta solo l'immagine in uso, per non riempire la microSD. Lo script elenca le immagini dello stesso repository, esclude quella in uso e le righe senza tag (`<none>`), e rimuove le altre. Un errore di `docker image rm` (per esempio un'immagine ancora usata da un altro container) produce `avviso: non sono riuscito a rimuovere le immagini vecchie (il deploy è riuscito)` e non cambia l'esito (requirements C2).

Conseguenza: **tornare a una versione precedente richiede la rete** e un token GHCR valido, perché l'immagine vecchia va scaricata di nuovo.

### Cosa non fa

- **Nessun ritorno indietro automatico.** Se un passo fallisce lo script si ferma e lo dice; la procedura è in `docs/DEPLOY.md §6`.
- Non costruisce nulla e non esegue `pnpm`.
- Non controlla che il workflow `Image` sia verde: se l'immagine non c'è, se ne accorge al passo 2.

## `scripts/smoke-prod.sh`

```bash
docker build -t mealy-app:smoke . && bash scripts/smoke-prod.sh mealy-app:smoke
```

Avvia **lo stesso `docker-compose.prod.yml`** della produzione, passando da `compose-prod.sh`, ma in un progetto compose a parte (`-p mealy-smoke`) che smonta alla fine, volumi compresi. Non tocca lo stack `mealy-prod`.

Preparazione: crea `.smoke/env` (password di prova, `LLM_MODEL=smoke-model`, nessuna chiave, `APP_PORT` = `SMOKE_PORT`, default **3100**, `BACKUP_DIR=./.smoke/backups`) ed esporta `MEALY_ENV_FILE` e `MEALY_IMAGE`. Un `trap` esegue `down -v` e cancella `.smoke/` in ogni caso.

Controlli, nell'ordine. Al primo che fallisce: `SMOKE FALLITO: <motivo>`, ultime 60 righe di log dell'app, uscita 1.

| # | Controllo |
|---|---|
| 1 | `up -d --wait --wait-timeout 180`: lo stack diventa sano |
| 2 | `GET /api/health` risponde esattamente `{"status":"ok"}` |
| 3 | La tabella `recipes` esiste e `drizzle.__drizzle_migrations` ha almeno una riga: migrazioni applicate |
| 4 | `ingredient_aliases` ha almeno una riga: alias caricati |
| 5 | **`recipes` ha 0 righe**: il bootstrap non deve inserire ricette di esempio |
| 6 | La pagina iniziale risponde 200 seguendo i redirect (con il database vuoto porta al wizard `/benvenuto`) |
| 7 | `backup.sh daily` scrive un solo dump, non vuoto e valido per `gzip -t` |
| 8 | Un secondo `backup.sh daily` con `BACKUP_KEEP=1` lascia solo il dump più recente: rotazione |
| 9 | `restart app`, lo stack torna sano e nei log compare `alias inseriti o aggiornati: 0`: il bootstrap è idempotente |

In fondo: `SMOKE OK`.

**Dalla Feature 10** (pacchetto iniziale di ricette, [[recipe-pack]]) cambiano due controlli; la tabella sopra resta quella della Feature 7:
- il **5** diventa: `recipes` ha **tante righe quante sono le ricette di `fixtures/recipe-pack.json`**. Il numero atteso lo legge lo script dal file con `node -e` (requirements P22 della Feature 10): lo smoke gira dalla copia del repository, dove Node c'è, e il controllo vale con qualunque versione del pacchetto. Se il file non si legge: `non riesco a leggere fixtures/recipe-pack.json`; se il conteggio non torna: `le ricette nel database non sono quelle del pacchetto (attese <n>)`. L'intestazione della sezione nel log è `[smoke] migrazioni, alias e pacchetto`;
- il **9** controlla anche che nei log ci sia `ricette del pacchetto inserite: 0` e che dopo il riavvio il conteggio delle ricette sia lo stesso: anche il caricamento è idempotente.

Con il pacchetto lo stack locale contiene 200 ricette dopo il primo avvio e, dopo l'onboarding, un piano completo esce senza il modello (prova manuale di chiusura della Feature 10).

Lo smoke **non prova l'LLM** (modello finto, nessuna chiave) né nulla che dipenda dal Raspberry o da Tailscale. Il controllo 5 è l'unica verifica, sul percorso di produzione, della regola "le ricette di esempio non entrano mai in produzione": il codice che le inserirebbe è nell'immagine, perché il bootstrap importa `seed-core.ts` ([[db-bootstrap]], [[fixtures-and-seed]]). *Nota (Feature 10): con il pacchetto il controllo 5 conta le ricette del pacchetto. Una ricetta d'esempio in più farebbe comunque fallire il conteggio, ma solo se non è simile a una del pacchetto, che altrimenti salterebbe al suo posto: la regola non ha più un controllo dedicato.*

Lo stesso script gira in tre posti: in locale, nel job `image` del gate (immagine amd64) e nel workflow `Image` prima del push (immagine arm64) ([[ci-workflows]]).

## Verifiche

Gli script non hanno test Vitest: sono stati provati eseguendoli, in locale su Docker Desktop (Windows con Git Bash, amd64).

- `smoke-prod.sh`: `SMOKE OK`.
- `deploy.sh --no-pull`: primo avvio (dump di un database vuoto); dopo un `down` (dump fatto); seconda esecuzione con la stessa immagine (`l'app usa già questa immagine`, nessun dump in più); immagine diversa (dump fatto); backup che fallisce (uscita 1, app non avviata, nessun dump aggiunto o cancellato); pulizia con un'immagine ancora in uso (avviso, uscita 0).
- `compose-prod.sh` in una cartella senza `.git`: messaggio e uscita 1.

**Non verificati**: i passi 1 e 2 di `deploy.sh` (`git pull` e pull da GHCR), che richiedono il Raspberry e un'immagine pubblicata; l'esclusione delle righe `<none>` nella pulizia; il ramo d'errore del controllo 5 dello smoke, con ricette presenti.

## Vedi anche

- [[e6-deploy]] — Panoramica della Feature 7
- [[production-stack]] — Il compose che gli script avviano
- [[backup-service]] — `backup.sh` e le etichette dei dump
- [[health-check]] — `GET /api/health` e il suo corpo
- [[db-bootstrap]] — Migrazioni e alias all'avvio, riga di log cercata dallo smoke
- [[ci-workflows]] — Dove lo smoke gira in CI e dove nasce l'immagine
- [[recipe-pack]] — Feature 10: il pacchetto che lo smoke si aspetta dopo il primo avvio
