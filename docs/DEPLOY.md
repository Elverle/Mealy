# Mealy — Deploy sul Raspberry Pi

Guida operativa della v1. Mealy gira su un Raspberry Pi con Docker Compose ed è raggiungibile solo dalla rete di casa e da Tailscale, senza login (`ARCHITECTURE.md §8`).

## 1. Come è fatto

| Container | Cosa fa |
|---|---|
| `app` | Next.js in modalità standalone, porta 3000. All'avvio applica le migrazioni del database e carica gli alias degli ingredienti, poi inizia a rispondere |
| `db` | PostgreSQL 16. I dati stanno nel volume Docker `mealy-prod_postgres_data`. Non è raggiungibile da fuori |
| `backup` | Ogni notte alle 03:00 scrive un dump compresso in `backups/` e tiene gli ultimi 7 |

- **Il Raspberry non costruisce nulla.** A ogni push su `main` GitHub Actions (workflow **Image**) costruisce l'immagine arm64 e la pubblica come `ghcr.io/elverle/mealy:sha-<commit>`. Il Raspberry scarica l'immagine del commit che ha in `git`.
- **Nessun comando `pnpm` sul Raspberry.** Migrazioni e alias li applica l'app da sola. Le ricette di esempio di `pnpm db:seed` non entrano mai in produzione: la libreria parte dal pacchetto iniziale di ricette (`fixtures/recipe-pack.json`), che l'app carica all'avvio.
- **Nessuna porta aperta su Internet.** Fuori casa si entra solo con Tailscale. L'app però ascolta su tutte le interfacce di rete del Raspberry, e le porte pubblicate da Docker non passano da `ufw`: in IPv4 la protegge il router di casa. Se la tua rete assegna indirizzi IPv6 pubblici, controlla che il firewall IPv6 del router blocchi le connessioni in ingresso.

## 2. Cosa serve

- Raspberry Pi 4 (bastano 2 GB) con Raspberry Pi OS **a 64 bit** e accesso SSH
- un account GitHub che possa leggere le immagini `ghcr.io/elverle/mealy`: il repository è pubblico, il pacchetto delle immagini è privato
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

Il repository è pubblico: il Raspberry lo clona in HTTPS, senza chiavi. Se `git` manca (su Raspberry Pi OS Lite può non esserci): `sudo apt-get install -y git`.

```bash
sudo mkdir -p /opt/mealy
sudo chown "$USER": /opt/mealy
git clone https://github.com/Elverle/Mealy.git /opt/mealy
cd /opt/mealy
```

**Raspberry preparato quando il repository era privato** (fino al 5 novembre 2026). Clona in SSH con una deploy key in sola lettura, e continua a funzionare. Per passare a HTTPS:

```bash
git -C /opt/mealy remote set-url origin https://github.com/Elverle/Mealy.git
git -C /opt/mealy pull --ff-only   # deve riuscire senza chiedere credenziali
```

Dopo si possono togliere la deploy key da GitHub (**Mealy → Settings → Deploy keys**) e, sul Raspberry, la voce `Host github.com` con `IdentityFile ~/.ssh/mealy_deploy` da `~/.ssh/config`, insieme ai file `~/.ssh/mealy_deploy*`.

### 3.4 Accesso alle immagini

Le immagini su GHCR invece sono private: la visibilità del pacchetto è separata da quella del repository. Su GitHub: **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token**, con il solo scope `read:packages`. Scegli tu la scadenza: quando il token scade, `deploy.sh` si ferma con `denied` e va rifatto questo passo.

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

La libreria contiene già le ricette del pacchetto iniziale: di solito il primo **Genera piano** le prende da lì, senza chiamare l'LLM. Il modello interviene solo quando la libreria non basta, per esempio con preferenze molto restrittive.

## 5. Verifica

| Cosa | Come |
|---|---|
| I container sono attivi | `bash scripts/compose-prod.sh ps`: `app` e `db` risultano `healthy`, `backup` risulta `Up` |
| Accesso da casa | `http://<ip-del-raspberry>:3000` da PC o telefono in Wi-Fi: si legge e si scrive |
| Accesso fuori casa | Telefono su rete mobile (Wi-Fi spento) con Tailscale attivo: `http://mealy:3000` oppure `http://100.x.y.z:3000`. Scrivi `http://` per esteso: il browser potrebbe provare `https` da solo. Spunta qualche riga della lista |
| Generazione ricette | **Genera piano** arriva in fondo senza errori |
| Classificazione delle ricette | Dopo l'avvio, `bash scripts/compose-prod.sh logs app` mostra `[classify] ricette da classificare: N` e poi `[classify] classificate: X, rimaste: Y`, oppure `[classify] nessuna ricetta da classificare`. Le rimaste si riprovano al riavvio |
| Pacchetto di ricette | Al primo avvio dopo l'aggiornamento, `bash scripts/compose-prod.sh logs app` mostra `[pack] ricette del pacchetto inserite: N, già presenti o simili: M`, con N + M = 200. Ai riavvii successivi N è 0 |
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

Anche i dati possono impedire il ritorno: dalla 0.8 le ricette e le Impostazioni contengono etichette e portate che le versioni precedenti non conoscono, e la Libreria non si aprirebbe. Tornando a una versione precedente alla 0.8, ripristina sempre il dump `mealy-predeploy-…`.

Dalla 0.10 (Feature 11) i piani hanno una portata per piatto e l'household le composizioni dei pasti: tornando a una versione precedente alla 0.10, ripristina sempre il dump `mealy-predeploy-…`.

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
| `git pull` fallisce con `Permission denied (publickey)` | Il clone usa ancora SSH e la deploy key manca o è stata tolta | Passa a HTTPS (§3.3) |
| `git pull` dice che non sei su un branch | Sei rimasto su un commit dopo un ritorno indietro | `git checkout main` |
| `backup non riuscito`, oppure `il database o il servizio di backup non partono` | La cartella dei backup non è scrivibile (disco staccato o pieno), oppure il database non parte | L'app non è stata toccata. Controlla `BACKUP_DIR` e `bash scripts/compose-prod.sh logs backup db`, poi rilancia lo script |
| `lo stack non è diventato sano entro 180 secondi` | L'app non parte | Leggi i log stampati dallo script: `[bootstrap] avvio interrotto` indica un problema di database o di migrazioni. Una migrazione fallita non modifica il database: torna alla versione precedente (§6) senza ripristinare nulla. Fa eccezione un errore che cita `ingredient_aliases`: lì le migrazioni sono già applicate, e per tornare indietro serve anche il dump `predeploy` (§7) |
| `avviso: non sono riuscito a rimuovere le immagini vecchie` | Un'immagine vecchia è ancora usata da un altro container | Il deploy è riuscito. `docker image ls ghcr.io/elverle/mealy` mostra cosa è rimasto: ciò che non serve si toglie con `docker image rm <IMAGE ID>` |
| `password authentication failed` nei log dell'app | `POSTGRES_PASSWORD` cambiata dopo la prima creazione | Rimetti la password originale |
| La porta 3000 è occupata | Un altro servizio sul Raspberry | `APP_PORT=3001` in `.env.production`, poi `bash scripts/deploy.sh --no-pull` |
| Fuori casa non risponde | Tailscale spento sul telefono, o chiave del Raspberry scaduta | Apri l'app Tailscale; sul Raspberry `tailscale status` |
| `[classify] modello non configurato (…): N ricette restano senza portata` nei log dell'app | Mancano le variabili `LLM_*` o la chiave del provider in `.env.production` | Nessun danno: l'app funziona e le ricette restano ammesse nel piano. Compila le variabili (§3.5), poi `bash scripts/deploy.sh --no-pull`: la classificazione riparte all'avvio |
| `[classify] lotto i/n non classificato: …` nei log dell'app | Rete, timeout o risposta non valida del provider LLM | Le ricette di quel lotto restano senza portata e si riprovano al riavvio dell'app. Se si ripete, controlla la chiave API e `LLM_TIMEOUT_MS` |
| `[pack] caricamento interrotto` nei log dell'app | Errore del database durante l'inserimento | Nessuna ricetta del pacchetto è entrata e l'app funziona. Il caricamento si ritenta al riavvio (`bash scripts/deploy.sh --no-pull`); se si ripete, leggi l'errore nei log |

## 10. Note per chi sviluppa

- **Prova locale dello stack di produzione** (PC con Docker): `docker build -t mealy-app:smoke . && bash scripts/smoke-prod.sh mealy-app:smoke`. Usa la porta 3100 e un progetto compose a parte (`mealy-smoke`), che smonta alla fine.
- **Il gate delle pull request** fa la stessa prova (job `image`).
- **Migrazioni**: una migrazione arrivata su `main` non si modifica, se ne aggiunge una nuova. Il migratore guarda solo l'orario dell'ultima applicata: un test (`tests/db/bootstrap.test.ts`) controlla che il journal resti in ordine e applica l'ultima migrazione a un database fermo a quella precedente.
- **Cartella `public/`**: oggi non esiste e il `Dockerfile` non la copia. Se viene creata, va aggiunta la riga `COPY --from=builder --chown=nextjs:nodejs /app/public ./public` nello stadio `runner`.
- **Spazio su GHCR**: ogni push su `main` pubblica un'immagine nuova. Quelle vecchie si cancellano a mano da GitHub (profilo → **Packages → mealy → Package settings**).
