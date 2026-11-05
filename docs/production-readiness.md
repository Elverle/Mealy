# Mealy — Production readiness

Cosa resta da verificare prima di considerare chiusa la v1, e come il repository è stato reso pubblico.

Stato al 5 novembre 2026: versione 0.10.0, **repository pubblico** dallo stesso giorno (merge della PR #29, `6b7508b`). I controlli della sezione 3.1 sono stati rifatti prima del cambio, le decisioni della sezione 3.2 sono prese e la checklist della sezione 3.4 è chiusa. Anche le prove sul Raspberry (sezione 1) sono tutte fatte.

## 1. Prove sul Raspberry

L'app gira sul Raspberry dalla Feature 8 ed è in uso. Aggiornato il 27 ottobre 2026 con le prove confermate dall'utente; i passi sono in `DEPLOY.md §5`.

- [x] Primo deploy con `bash scripts/deploy.sh` (percorso con `git pull` e download dell'immagine da GHCR: in locale è stato provato solo `--no-pull`)
- [x] Accesso dalla rete di casa
- [x] Accesso da fuori casa con Tailscale
- [x] Generazione di un piano dal Raspberry (chiamata al provider LLM)
- [x] Riavvio del Raspberry: l'app riparte da sola (5 novembre 2026)
- [x] Backup notturno: la mattina dopo c'è un file `mealy-daily-…` nella cartella dei backup
- [x] Un secondo deploy dopo un commit nuovo: dump `predeploy` e pulizia delle immagini vecchie (comprese quelle senza tag). Verificati con il deploy del 27 ottobre 2026 (`5710ac5`)

La Feature 7 è `done` dal 27 ottobre 2026: le verifiche che la chiudevano (rete di casa e Tailscale) sono fatte. L'ultima verifica operativa, il riavvio del Raspberry, è fatta il 5 novembre 2026 ed è registrata anche nello "Stato delle verifiche" di `wiki/topics/e6-deploy.md`.

## 2. Aggiornamento delle dipendenze

Fatto in due giri: il 27 ottobre 2026 (PR #22–#25) e il 5 novembre 2026 (PR #26 e #27).

- [x] Le 17 vulnerabilità segnalate da Dependabot (1 critica, 9 alte, 7 moderate), più quelle arrivate dopo: chiuse con #22 (Node 24.22.1), #23 (tutte tranne `zod`, alcune con un override in `pnpm-workspace.yaml`) e #25 (`zod` 4). Al 5 novembre l'unico avviso aperto è quello di `minimatch`, lasciato di proposito (sotto).
- [x] Le pull request di Dependabot #7, #9, #10 e #11: chiuse, superate dagli aggiornamenti sopra
- [x] `pnpm lint` esteso a tutto il repository (#24)
- [x] Node 24.22.2 nel `Dockerfile` (#26)
- [x] `next` 15.5.29 (3 correzioni di sicurezza moderate, una per le app installate in proprio) e tutte le versioni patch e minori compatibili con i range di `package.json`

Lasciato aperto di proposito:

- **`minimatch` 10.2.6** ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderata, denial of service). La segnala `pnpm audit` e, dal 5 novembre 2026, anche Dependabot (avviso di sviluppo). Arriva solo da ESLint (`@typescript-eslint/typescript-estree`, che chiede `^10.2.2` anche all'ultima versione): non entra nell'immagine e non legge input esterni. La correzione c'è solo nella 11, che è un modulo ESM, e forzarla con un override rischia di rompere il lint. Si chiude da sola quando typescript-eslint passerà alla 11.
- **Le versioni major**: `next` 16, `typescript` 7, `eslint` 10, `vitest` 5, `postgres` 4, `jsdom` 30, `@vitejs/plugin-react` 6 e altre. Nessuna porta correzioni di sicurezza per le versioni in uso, e ognuna è un lavoro a parte: non servono per la v1.

Per i prossimi giri:

- `.github/dependabot.yml` segue solo `docker` e `github-actions`. Le pull request npm che Dependabot apre per gli avvisi di sicurezza non si chiudono da sole dopo l'aggiornamento: vanno chiuse a mano.
- Gli avvisi di Next.js compaiono prima nelle note di rilascio che negli avvisi di Dependabot e in `pnpm audit`: la 15.5.29 è stata trovata così. Vale la pena guardare le note dell'ultima 15.5.x.

## 3. Rendere pubblico il repository

### 3.1 Cosa è stato controllato

Controlli rifatti il 5 novembre 2026 sul commit `fdb9b63` (147 commit, più i commit delle 28 pull request). La prima volta erano stati fatti il 12 ottobre 2026 su `22e02f2`. Valgono solo per la storia esistente a quella data: prima del cambio basta ripeterli sui commit arrivati dopo.

| Controllo | Esito |
|---|---|
| Chiavi API, token e chiavi private in tutta la storia | Nessuno trovato |
| File `.env` mai committati | Solo `.env.example` e `.env.production.example`, con i campi vuoti |
| Password e chiavi presenti nel repository | Solo quelle finte di sviluppo e dei test (`mealy:mealy`, `smokepassword123`, `deploytest123`, chiavi `test-…-key`) |
| Commit raggiungibili solo dalle pull request | 11, tutti di Dependabot: niente segreti né file sensibili |
| Log di GitHub Actions (tutte le 90 esecuzioni) | Nessun token, email, nome della tailnet o indirizzo IP. I segreti compaiono come `***` |
| Link alle sessioni Claude | Riga `Claude-Session` in 4 commit della Feature 5 (`0045d78`, `aa38826`, `501a0f4`, `358833d`), tutti con la stessa sessione. La sessione è stata eliminata il 5 novembre 2026: il link non apre più niente. Nessun link nei file, nelle pull request, nelle issue o nei log |
| Indirizzi IP e nomi della rete di casa o della tailnet | Nessuno. In `planning/feature/feature-7/spec.md` c'è solo un segnaposto (`mealy.tailnet.ts.net`) |
| Dati personali nei file | Solo lo username `Elverle`, che è già pubblico |
| Workflow `gate.yml` (parte sulle pull request) | Nessun segreto, permessi di sola lettura: una pull request da un fork non può fare danni |
| Workflow `image.yml` | Parte solo da `main` o a mano. Usa il solo `GITHUB_TOKEN` |
| Contenuto dell'immagine Docker | Niente `.env`, documenti o test (`.dockerignore`) |
| Risposte LLM registrate in `tests/fixtures/llm/` | Nessuna intestazione, chiave o identificativo di account |
| Branch remoti | Solo `main`: quelli rimasti dopo i merge sono stati cancellati |

Pacchetto su GHCR: `mealy` è privato e collegato a `Elverle/Mealy` (5 novembre 2026, con `gh api 'user/packages?package_type=container'`; serve il permesso `read:packages`, che si aggiunge con `gh auth refresh -h github.com -s read:packages`).

Comandi per ripetere i controlli principali, da Git Bash nella cartella del repository:

```bash
git fetch --all --prune

# Commit delle pull request (anche quelli che non sono in main diventano pubblici)
prs=$(git ls-remote origin 'refs/pull/*/head' | awk '{print $1}')
git fetch -q origin $prs        # solo se qualcuno manca in locale
git rev-list $prs --not --all   # commit raggiungibili solo dalle pull request

# File .env e simili mai entrati nella storia
git log --all --diff-filter=A --name-only --format= | sort -u | grep -iE '(^|/)\.env|secret|credential|\.pem$|\.key$|id_rsa'

# Chiavi e token in ogni commit, pull request comprese
git grep -nIE 'sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{30,}|tskey-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY' $(git rev-list --all $prs)

# Valori assegnati a variabili che sembrano segreti
git grep -hIoE '(API_KEY|_TOKEN|PASSWORD|SECRET|DATABASE_URL)[A-Z_]*\s*[=:]\s*[^ ]{3,}' $(git rev-list --all) -- . ':!pnpm-lock.yaml' | sort | uniq -c | sort -rn

# Link alle sessioni Claude nei messaggi di commit e nei file
git log --all $prs --format=%B | grep -oE 'session_[0-9A-Za-z]+' | sort | uniq -c
git grep -nIE 'claude\.ai/code|Claude-Session' $(git rev-list --all $prs)

# Identità presenti nei commit
git log --all --format='%an <%ae>' | sort | uniq -c

# Log di GitHub Actions: scaricarli in una cartella temporanea e cercarci gli stessi schemi
for id in $(gh run list --limit 500 --json databaseId --jq '.[].databaseId'); do gh run view $id --log > "logs/$id.log"; done
```

Il plugin secret-box di Claude Code maschera nell'output i valori che coincidono con quelli del `.env` locale: le password finte di sviluppo compaiono come `[REDACTED-SECRET-…]`. Per capire cosa sono senza vederle, sostituire lettere e cifre con `a` e `9` (`sed -E 's/[0-9]/9/g; s/[a-z]/a/g'`) e guardarne la forma.

### 3.2 Decisioni prese

Prese il 5 novembre 2026.

1. **Email personale nei commit: va bene così.** L'indirizzo personale resta visibile come autore nei commit, quelli esistenti (in 17 c'è anche nome e cognome) e quelli futuri: è accettato. Toglierlo dai commit vecchi richiederebbe comunque un repository nuovo con la storia riscritta, perché le pull request chiuse tengono raggiungibili i commit vecchi.

   I 4 commit con la riga `Claude-Session` restano nella storia per la stessa ragione; la sessione a cui puntano è stata eliminata.

2. **Licenza MIT.** File `LICENSE`, campo `"license"` in `package.json` e sezione nel README. `"private": true` in `package.json` resta: impedisce solo la pubblicazione su npm.

3. **Documenti.** Tolti `docs/rework-catalogo.md` e `docs/planning/feature/feature-10/brainstorm-prompt.md`, che nominavano la fonte del dataset delle ricette e ne descrivevano il contenuto; i rimandi negli altri documenti sono stati corretti. Restano nella storia git, come lo spunto della Feature 8 che ne riprendeva la descrizione. Il resto di `docs/` (piani, review, wiki) diventa pubblico così com'è. Il pacchetto `fixtures/recipe-pack.json` contiene solo ricette riscritte, senza link né nome del sito, e lo controlla un test (`tests/fixtures-data/recipe-pack.test.ts`).

4. **Dipendenze.** Aggiornate (sezione 2). Con il repository pubblico il lockfile mostra a chiunque le versioni in uso: subito prima del cambio vanno ricontrollati gli avvisi di Dependabot e `pnpm audit`.

### 3.3 Da sapere

- **L'immagine su GHCR resta privata.** La visibilità del pacchetto è separata da quella del repository. Un pacchetto reso pubblico non può più tornare privato.
- **Il deploy si semplifica.** Con il repository pubblico il Raspberry clona in HTTPS senza deploy key (`DEPLOY.md §3.3`, con il passaggio per un Raspberry già preparato in SSH). Con il pacchetto pubblico non servirebbe nemmeno il token GHCR.
- **Il repository dichiara che l'app non ha autenticazione** e che ascolta sulla porta 3000. Non cambia il rischio finché il Raspberry resta raggiungibile solo dalla rete di casa e da Tailscale (`DEPLOY.md §1`, nota su IPv6).
- **Gli avvisi di Dependabot restano privati.** Diventano pubbliche solo le pull request che apre.
- **I minuti di GitHub Actions diventano illimitati** sui runner standard.
- **Protezione dei branch e secret scanning si attivano solo dopo il cambio.** Su un repository privato del piano gratuito GitHub li rifiuta ("Upgrade to GitHub Pro or make this repository public").

### 3.4 Il cambio

Fatto il 5 novembre 2026, dopo il merge della PR #29.

Prima:

- [x] Ripetere i controlli della sezione 3.1 (5 novembre 2026, su `fdb9b63`, poi sui 5 commit arrivati fino a `6b7508b`)
- [x] Ricontrollare gli avvisi di Dependabot e `pnpm audit` (5 novembre 2026: solo `minimatch`, sezione 2)
- [x] Aggiungere la licenza e aggiornare il README
- [x] Aggiungere `CONTRIBUTING.md` (aperto ai contributi, in italiano)
- [x] Controllare che il pacchetto su GHCR sia privato (5 novembre 2026)

Subito dopo:

- [x] Protezione del branch `main`: modifiche solo da pull request, con i due job del gate obbligatori (`lint, typecheck, test, build` e `docker image, production stack smoke`), senza review obbligatorie. Vale **anche per gli amministratori**; force push e cancellazione del branch sono bloccati
- [x] Secret scanning e blocco dei push che contengono segreti. Al momento dell'attivazione nessun avviso
- [x] *Private vulnerability reporting*, a cui rimanda `CONTRIBUTING.md`
- [x] Approvazione dei workflow per **tutte** le pull request da fork (`all_external_contributors`; prima era solo per chi contribuiva la prima volta)
- [x] `DEPLOY.md` e la wiki (`wiki/topics/e6-deploy.md`) aggiornati: clone in HTTPS, passaggio da SSH per il Raspberry già preparato, token GHCR ancora necessario

Da fare sul Raspberry, quando capita: passare il remote a HTTPS e togliere la deploy key (`DEPLOY.md §3.3`). Finché la deploy key resta su GitHub, il clone in SSH continua a funzionare.
