---
title: Servizio di Backup — Dump Compressi, Etichette e Rotazione (backup-service)
type: entity
created: 2026-10-11
updated: 2026-10-11
tags: [backup, pg-dump, cron, rotation, restore, docker, postgres, production, deploy, feature-7]
---

## File e Responsabilità

- **Percorsi file**:
  - `docker/backup/entrypoint.sh`: entrypoint del servizio `backup`. Pianifica il dump notturno con il `crond` di busybox e resta in primo piano.
  - `docker/backup/backup.sh`: scrive un dump compresso del database e ruota i dump con la stessa etichetta.
- **Scopo**: avere sempre un punto di ritorno per i dati, che in produzione sono veri. I dump servono in due casi: un guasto, e un aggiornamento che cambia lo schema, perché le migrazioni girano da sole e non tornano indietro ([[db-bootstrap]]).
- **Dove gira**: nel servizio `backup` di `docker-compose.prod.yml`, sull'immagine `postgres:16-alpine` ([[production-stack]]). I due script sono montati in `/opt/backup` in sola lettura; i dump vanno in `/backups`, cioè nella cartella `BACKUP_DIR` dell'host (default `./backups`).

Perché la stessa immagine del database (requirements P13 della Feature 7): nessuna immagine in più da costruire, e `pg_dump` è sempre della versione del server. In planning è stato verificato che l'immagine contiene `crond`, che il job eredita le variabili d'ambiente del container e che `tzdata` è presente.

## Pianificazione (`entrypoint.sh`)

1. Legge `BACKUP_CRON` (default `0 3 * * *`).
2. Scrive `/etc/crontabs/root` con una sola riga: `<BACKUP_CRON> sh /opt/backup/backup.sh daily > /proc/1/fd/1 2>&1`. L'output del job va sullo stdout del processo 1, cioè nei log del container.
3. Scrive `[backup] pianificato: '<cron>' (fuso <TZ>), conservati gli ultimi <BACKUP_KEEP> dump`.
4. `exec crond -f -l 8 -L /dev/stdout`: `crond` diventa il processo 1 del container.

L'orario è nel fuso `TZ` del container (default `Europe/Rome`).

## Dump (`backup.sh`)

```
sh /opt/backup/backup.sh [etichetta]      # default: daily
```

La connessione viene dalle variabili `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` del servizio.

1. **Controlli sugli argomenti.** L'etichetta ammette solo lettere minuscole e cifre; `BACKUP_KEEP` deve essere un intero maggiore di 0 senza zeri iniziali. In caso contrario messaggio su stderr e uscita **2**, senza toccare nulla.
2. **Dump su file temporaneo.** `pg_dump --no-owner --clean --if-exists | gzip -9` scrive in `<file>.tmp`. Con `set -o pipefail` un `pg_dump` fallito fa fallire la pipeline: messaggio e uscita **1**. Un `trap` rimuove il file temporaneo all'uscita, quindi non restano dump parziali.
3. **Verifica.** `gzip -t` sul file temporaneo e controllo che non sia vuoto; altrimenti il dump viene scartato e lo script esce con **1**.
4. **Scrittura atomica.** `mv` del temporaneo sul nome definitivo, poi `[backup] scritto <file> (<n> byte)`.
5. **Rotazione.** Solo a questo punto, e solo tra i file con la stessa etichetta: tiene i `BACKUP_KEEP` più recenti (`ls -1t`), cancella gli altri e scrive `[backup] rimosso <file>` per ciascuno.

Nome dei file: `mealy-<etichetta>-<AAAAMMGG-HHMMSS>.sql.gz`. L'orario ha la precisione del secondo ed è nel fuso del container.

### Etichette

| Etichetta | Chi la usa | Quando |
|---|---|---|
| `daily` | `crond` nel servizio | Ogni notte, all'orario di `BACKUP_CRON` |
| `predeploy` | `scripts/deploy.sh` | Prima di ogni cambio di immagine ([[deploy-scripts]]) |
| `manual` | Chi opera il Raspberry | A mano, e sempre prima di un ripristino (`docs/DEPLOY.md §7`) |

Lo script accetta qualsiasi etichetta valida: le tre sopra sono una convenzione. Con il default ne restano 7 per ciascuna.

### Perché la rotazione è a conteggio e per etichetta

La spec chiedeva di rimuovere i dump più vecchi di 7 giorni. Il codice tiene gli **ultimi 7 per etichetta** (requirements P14):
- una rotazione per età, se i backup falliscono per giorni, finisce per cancellare gli ultimi dump buoni; quella a conteggio non cancella nulla finché non c'è un dump nuovo riuscito e verificato;
- le etichette non si cancellano a vicenda: sette dump notturni non fanno uscire dalla rotazione il dump fatto prima di un aggiornamento.

## Ripristino

Non c'è uno script di ripristino: è un'operazione rara, documentata come blocco di comandi in **`docs/DEPLOY.md §7`** (requirements P16). Due cose spiegano com'è fatto quel blocco:

- Il dump è scritto con `--clean --if-exists`, quindi all'inizio cancella **solo gli oggetti che conosce**. Caricato così com'è su un database che nel frattempo ha una tabella in più con una chiave esterna, fallisce a metà e lascia il database in uno stato peggiore (riprodotto dalla review architetturale, R1). Per questo la guida azzera prima gli schemi `public` e `drizzle` e carica il dump **nella stessa transazione** (`psql --single-transaction -v ON_ERROR_STOP=1`): se qualcosa va storto il database resta com'era.
- Il blocco è concatenato con `&&` e parte da `gzip -t` (requirements C6): con una transazione unica, un file troncato su un confine di istruzione verrebbe altrimenti confermato come ripristino parziale.

Il dump contiene anche lo schema `drizzle`, cioè la tabella delle migrazioni applicate: dopo il ripristino l'app, al riavvio, riapplica le migrazioni successive al dump.

## Limiti

- **Stessa microSD del database, di default**: un guasto della scheda perde dati e backup. `BACKUP_DIR` permette un altro disco; la scelta è dell'utente (requirements P17). Se il disco indicato non è montato, Docker crea la cartella sulla microSD e i dump finiscono lì senza avvisi (`docs/DEPLOY.md §7`).
- **I file appartengono a `root`**: il container gira come root, e sull'host servono i permessi di amministratore per spostarli o cancellarli.
- **Nessun avviso se il backup notturno fallisce**: l'esito sta solo nei log del servizio (`bash scripts/compose-prod.sh logs backup`).
- **Nessuna copia fuori dal Raspberry**: va fatta a mano.

## Verifiche

Gli script non hanno test Vitest.
- `scripts/smoke-prod.sh` esegue `backup.sh daily`, controlla che il dump esista, non sia vuoto e passi `gzip -t`, poi ne fa un secondo con `BACKUP_KEEP=1` e controlla che resti solo il più recente ([[deploy-scripts]]).
- Provati a mano in locale: tre dump con `BACKUP_KEEP=2` (ne restano 2); etichetta non valida e `BACKUP_KEEP=00` (uscita 2); database spento (uscita 1, nessun file parziale, dump esistenti intatti); il ripristino della guida con dump buono e con dump corrotto.
- **Non verificato**: l'esecuzione notturna di `crond` alle 03:00, che si controlla sul Raspberry la mattina dopo (`docs/DEPLOY.md §5`).

## Vedi anche

- [[e6-deploy]] — Panoramica della Feature 7
- [[production-stack]] — Servizio `backup` nel compose e variabili `BACKUP_*`
- [[deploy-scripts]] — Dump `predeploy` in `deploy.sh` e prova della rotazione nello smoke
- [[db-bootstrap]] — Migrazioni applicate all'avvio, non reversibili
- [[database-schema]] — Cosa contiene il database salvato
