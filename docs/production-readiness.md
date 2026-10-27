# Mealy — Production readiness

Cosa resta da verificare e da decidere prima di considerare chiusa la v1 e, più avanti, prima di rendere pubblico il repository. La decisione sulla visibilità è **rimandata**: prima si prova l'app sul Raspberry.

Stato al 12 ottobre 2026: `main` al commit `22e02f2`, versione 0.6.0, repository privato.

## 1. Prove sul Raspberry

L'app gira sul Raspberry dalla Feature 8 ed è in uso. Aggiornato il 27 ottobre 2026 con le prove confermate dall'utente; i passi sono in `DEPLOY.md §5`.

- [x] Primo deploy con `bash scripts/deploy.sh` (percorso con `git pull` e download dell'immagine da GHCR: in locale è stato provato solo `--no-pull`)
- [x] Accesso dalla rete di casa
- [x] Accesso da fuori casa con Tailscale
- [x] Generazione di un piano dal Raspberry (chiamata al provider LLM)
- [ ] Riavvio del Raspberry: l'app riparte da sola
- [x] Backup notturno: la mattina dopo c'è un file `mealy-daily-…` nella cartella dei backup
- [x] Un secondo deploy dopo un commit nuovo: dump `predeploy` e pulizia delle immagini vecchie (comprese quelle senza tag). Verificati con il deploy del 27 ottobre 2026 (`5710ac5`)

La Feature 7 è `done` dal 27 ottobre 2026: le verifiche che la chiudevano (rete di casa e Tailscale) sono fatte. La voce ancora aperta è una verifica operativa: quando è fatta, spuntarla qui e nello "Stato delle verifiche" di `wiki/topics/e6-deploy.md`.

## 2. Aggiornamento delle dipendenze

Rinviato a dopo la Feature 7, quindi ora è dovuto.

- [ ] 17 vulnerabilità segnalate da Dependabot su `main` (1 critica, 9 alte, 7 moderate)
- [ ] Quattro pull request di Dependabot aperte: #7 `source-map-js`, #9 `next`, #10 `sharp`, #11 `shell-quote`
- [ ] Estendere `pnpm lint` alla radice, a `tests/` e a `scripts/`

Il rischio pratico è basso finché l'app non è esposta su Internet. Con il repository pubblico il lockfile e le pull request mostrano a chiunque le versioni vulnerabili: conviene fare questo giro prima del cambio di visibilità.

## 3. Rendere pubblico il repository

### 3.1 Cosa è stato controllato

Controlli fatti sul commit `22e02f2`. **Vanno rifatti subito prima del cambio**, perché valgono solo per la storia esistente a quella data.

| Controllo | Esito |
|---|---|
| Chiavi API, token e chiavi private in tutta la storia (63 commit) | Nessuno trovato |
| File `.env` mai committati | Solo `.env.example` e `.env.production.example`, con i campi vuoti |
| Password presenti nel repository | Solo quelle finte di sviluppo e dei test (`mealy:mealy`, `smokepassword123`, `deploytest123`) |
| Indirizzi IP e nomi della rete di casa o della tailnet | Nessuno. In `planning/feature/feature-7/spec.md` c'è solo un segnaposto (`mealy.tailnet.ts.net`) |
| Workflow `gate.yml` (parte sulle pull request) | Nessun segreto, permessi di sola lettura: una pull request da un fork non può fare danni |
| Workflow `image.yml` | Parte solo da `main` o a mano. Usa il solo `GITHUB_TOKEN` |
| Contenuto dell'immagine Docker | Niente `.env`, documenti o test (`.dockerignore`) |
| Risposte LLM registrate in `tests/fixtures/llm/` | Nessuna intestazione, chiave o identificativo di account |

Non controllato:

- il commit di Dependabot della pull request #9, che non era nella copia locale;
- i log passati di GitHub Actions, letti solo in parte;
- la visibilità attuale del pacchetto su GHCR (il token usato non aveva il permesso `read:packages`).

Comandi per ripetere i controlli principali, da Git Bash nella cartella del repository:

```bash
git fetch --all --prune

# File .env e simili mai entrati nella storia
git log --all --diff-filter=A --name-only --format= | sort -u | grep -iE '(^|/)\.env|secret|credential|\.pem$|\.key$|id_rsa'

# Chiavi e token in ogni commit
git grep -nIE 'sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{30,}|tskey-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY' $(git rev-list --all)

# Valori assegnati a variabili che sembrano segreti
git grep -hIoE '(API_KEY|_TOKEN|PASSWORD|SECRET|DATABASE_URL)[A-Z_]*\s*[=:]\s*[^ ]{3,}' $(git rev-list --all) -- . ':!pnpm-lock.yaml' | sort | uniq -c | sort -rn

# Identità presenti nei commit
git log --all --format='%an <%ae>' | sort | uniq -c
```

### 3.2 Decisioni aperte

1. **Email personale nei commit.** L'indirizzo personale compare come autore in 59 commit, e in 6 c'è anche nome e cognome. Con il repository pubblico lo legge chiunque.
   - Riscrivere la storia non basta: i commit vecchi restano raggiungibili dalle pull request già chiuse.
   - Per toglierlo davvero serve un repository nuovo con la storia riscritta. Si perdono le 13 pull request, e l'immagine va ricostruita perché cambiano gli hash dei commit.
   - Se non importa: impostare l'indirizzo `noreply` di GitHub per i commit futuri e attivare in GitHub il blocco dei push che espongono l'email.
   - È l'unico punto a cui non si rimedia dopo il cambio.

2. **Licenza.** Oggi non c'è. Senza licenza il codice è visibile ma nessuno può riusarlo legalmente. Se si vuole permetterlo, aggiungere un file `LICENSE` (MIT è la scelta più semplice). `"private": true` in `package.json` non c'entra: impedisce solo la pubblicazione su npm e va lasciato.

3. **Cosa diventa visibile oltre al codice.** Le pull request con le loro descrizioni, i log passati di GitHub Actions, i branch remoti vecchi (`feature/6-e4-lista-spesa`, `feature/7-e6-deploy`, `fix/lista-ordine-stabile`, quelli di Dependabot) e tutta la cartella `docs/`, compresi piani, review e wiki. Decidere se va bene così o se prima va tolto o riletto qualcosa.

4. **Dipendenze.** Vedi la sezione 2.

### 3.3 Da sapere

- **L'immagine su GHCR resta privata.** La visibilità del pacchetto è separata da quella del repository. Un pacchetto reso pubblico non può più tornare privato.
- **Il deploy si semplifica.** Con il repository pubblico il Raspberry clona in HTTPS senza deploy key. Con il pacchetto pubblico non serve nemmeno il token GHCR.
- **Il repository dichiara che l'app non ha autenticazione** e che ascolta sulla porta 3000. Non cambia il rischio finché il Raspberry resta raggiungibile solo dalla rete di casa e da Tailscale (`DEPLOY.md §1`, nota su IPv6).
- **Gli avvisi di Dependabot restano privati.** Diventano pubbliche solo le pull request che apre.
- **I minuti di GitHub Actions diventano illimitati** sui runner standard.

### 3.4 Da fare al momento del cambio

- [ ] Ripetere i controlli della sezione 3.1
- [ ] Attivare la protezione del branch `main`: modifiche solo da pull request, con i due job del gate verdi
- [ ] Attivare secret scanning e il blocco dei push che contengono segreti
- [ ] Controllare che le pull request dai fork richiedano l'approvazione prima di far partire i workflow
- [ ] Aggiornare `DEPLOY.md`: §2 dice che il repository è privato, §3.3 e §3.4 descrivono deploy key e token GHCR
- [ ] Aggiornare il README se si aggiunge la licenza
