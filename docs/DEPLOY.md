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
- **Nessuna porta aperta su Internet.** Fuori casa si entra solo con Tailscale.

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

Il repository è privato: il Raspberry lo legge con una deploy key in sola lettura.

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
| chiave del provider | sì | `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENROUTER_API_KEY` oppure `ANTHROPIC_API_KEY`: solo quella del provider attivo |
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

Se dice che l'immagine non è stata trovata, il workflow **Image** non ha ancora finito: riprova tra qualche minuto.

**Dopo una modifica a `.env.production`** non serve scaricare nulla:

```bash
bash scripts/deploy.sh --no-pull
```

**Tornare a una versione precedente:**

```bash
git checkout <commit>
bash scripts/compose-prod.sh pull app
bash scripts/deploy.sh --no-pull
```

Serve la rete: sul Raspberry resta solo l'immagine in uso, quella precedente viene scaricata di nuovo.

Le migrazioni del database non tornano indietro: se la versione nuova aveva cambiato lo schema, ripristina il dump `mealy-predeploy-…` fatto prima dell'aggiornamento (§7). Scegli quello con l'orario precedente all'aggiornamento: anche il ritorno indietro ne crea uno, con lo schema nuovo. Per riprendere gli aggiornamenti normali: `git checkout main`.

## 7. Backup e ripristino

I dump stanno in `/opt/mealy/backups/` (o in `BACKUP_DIR`):

| File | Quando | Quanti |
|---|---|---|
| `mealy-daily-AAAAMMGG-HHMMSS.sql.gz` | ogni notte alle 03:00 | gli ultimi 7 |
| `mealy-predeploy-AAAAMMGG-HHMMSS.sql.gz` | prima di ogni aggiornamento | gli ultimi 7 |
| `mealy-manual-AAAAMMGG-HHMMSS.sql.gz` | a mano | gli ultimi 7 |

I file appartengono a `root`: per spostarli o cancellarli serve `sudo`.

**Backup a mano:**

```bash
bash scripts/compose-prod.sh exec backup sh /opt/backup/backup.sh manual
```

**Dove tenerli.** Di default i dump stanno sulla stessa microSD del database: se la scheda si rompe si perdono entrambi. Meglio un disco USB (imposta `BACKUP_DIR=/mnt/usb/mealy-backups` in `.env.production`, poi `bash scripts/deploy.sh --no-pull`) oppure una copia periodica su un altro computer:

```bash
scp "pi@mealy:/opt/mealy/backups/mealy-daily-*.sql.gz" .
```

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

## 8. Comandi utili

Tutti da `/opt/mealy`. `scripts/compose-prod.sh` è `docker compose` con il file d'ambiente e l'immagine giusti.

| Comando | Cosa fa |
|---|---|
| `bash scripts/compose-prod.sh ps` | Stato dei container |
| `bash scripts/compose-prod.sh logs -f app` | Log dell'app |
| `bash scripts/compose-prod.sh logs backup` | Esito dei backup |
| `bash scripts/compose-prod.sh restart app` | Riavvia l'app |
| `bash scripts/compose-prod.sh exec db psql -U mealy -d mealy` | Console SQL |
| `bash scripts/compose-prod.sh down` | Ferma tutto. I dati restano nel volume |

**Mai** `down -v`: cancella il volume, cioè il database.

## 9. Se qualcosa non va

| Sintomo | Causa probabile | Rimedio |
|---|---|---|
| `Manca .env.production` | File di configurazione assente | §3.5 |
| `Imposta POSTGRES_PASSWORD…` o `Imposta LLM_MODEL…` | Variabile obbligatoria vuota | Compila `.env.production` |
| `immagine non trovata per il commit …` | Workflow **Image** non finito o fallito | Controlla la scheda Actions e riprova |
| `denied` o `unauthorized` durante il pull | Token GHCR scaduto o mancante | §3.4 |
| `git pull` fallisce con `Permission denied (publickey)` | Deploy key non configurata | §3.3 |
| `git pull` dice che non sei su un branch | Sei rimasto su un commit dopo un ritorno indietro | `git checkout main` |
| `lo stack non è diventato sano entro 180 secondi` | L'app non parte | Leggi i log stampati dallo script: `[bootstrap] avvio interrotto` indica un problema di database o di migrazioni. Una migrazione fallita non modifica il database: torna alla versione precedente (§6) senza ripristinare nulla |
| `password authentication failed` nei log dell'app | `POSTGRES_PASSWORD` cambiata dopo la prima creazione | Rimetti la password originale |
| La porta 3000 è occupata | Un altro servizio sul Raspberry | `APP_PORT=3001` in `.env.production`, poi `bash scripts/deploy.sh --no-pull` |
| Fuori casa non risponde | Tailscale spento sul telefono, o chiave del Raspberry scaduta | Apri l'app Tailscale; sul Raspberry `tailscale status` |

## 10. Note per chi sviluppa

- **Prova locale dello stack di produzione** (PC con Docker): `docker build -t mealy-app:smoke . && bash scripts/smoke-prod.sh mealy-app:smoke`. Usa la porta 3100 e un progetto compose a parte (`mealy-smoke`), che smonta alla fine.
- **Il gate delle pull request** fa la stessa prova (job `image`).
- **Migrazioni**: una migrazione arrivata su `main` non si modifica, se ne aggiunge una nuova. Il migratore guarda solo l'orario dell'ultima applicata: un test (`tests/db/bootstrap.test.ts`) controlla che il journal resti in ordine.
- **Cartella `public/`**: oggi non esiste e il `Dockerfile` non la copia. Se viene creata, va aggiunta la riga `COPY --from=builder --chown=nextjs:nodejs /app/public ./public` nello stadio `runner`.
- **Spazio su GHCR**: ogni push su `main` pubblica un'immagine nuova. Quelle vecchie si cancellano a mano da GitHub (profilo → **Packages → mealy → Package settings**).
