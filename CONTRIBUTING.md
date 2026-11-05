# Contribuire a Mealy

Mealy è nato per uso personale, ma i contributi sono benvenuti: segnalazioni di bug, idee, correzioni alla documentazione e pull request.

## Prima di iniziare

- **Bug.** Apri una issue con i passi per riprodurlo, cosa ti aspettavi e cosa è successo. Se riguarda l'interfaccia, indica dispositivo e browser.
- **Modifiche non piccole** (una funzionalità nuova, lo schema del database, le API): apri prima una issue per parlarne, così non lavori su qualcosa che non entrerà. Le idee già raccolte e rinviate sono in [`docs/v2-funzionalita.md`](docs/v2-funzionalita.md).
- **Problemi di sicurezza**: non aprire una issue pubblica. Usa *Report a vulnerability* nella scheda *Security* del repository. Nota: nella v1 l'app non ha autenticazione per scelta, perché gira solo in rete locale e su Tailscale (`docs/ARCHITECTURE.md §8`). Questo, da solo, non è una vulnerabilità.

## Cosa leggere

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): architettura, modello dati, logiche del pianificatore e della lista della spesa, API.
- [`docs/DESIGN.md`](docs/DESIGN.md): design system, schermate, microcopy e requisiti minimi di accessibilità.
- [`docs/wiki/index.md`](docs/wiki/index.md): wiki tecnica del codice, una pagina per modulo.

Il principio guida del prodotto: **le ricette generate non sono usa e getta, sono la libreria** (`ARCHITECTURE §1.3`). Il piano è una selezione pesata dalla libreria; l'LLM interviene solo quando la libreria non basta.

## Ambiente di sviluppo

Requisiti, installazione, variabili d'ambiente e comandi sono nel [README](README.md#requisiti). In breve: Node.js 22 o superiore (la CI usa la 24), pnpm e Docker per il PostgreSQL di sviluppo.

Per i test non serve una chiave API: l'LLM è simulato con risposte registrate. La chiave serve solo per generare ricette mentre usi l'app in sviluppo.

## Regole del codice

Valgono per ogni modifica:

- **I tipi di dominio sono definiti solo in `lib/domain/types.ts`** (schemi Zod). Non ridefinirli altrove.
- **`planner`, `shopping-list` e `prefs` sono funzioni pure più un repository**: niente chiamate all'LLM al loro interno. Solo il modulo `recipes` usa `lib/llm/`.
- **Il provider LLM è configurazione**: si sceglie con `LLM_PROVIDER` e `LLM_MODEL`, e nessun modulo fuori da `lib/llm/` sa quale sia.
- **Ingredienti normalizzati alla fonte**: `canonical_name`, enum `unit` e `category` chiusi (`ARCHITECTURE §4.1`).
- **Test senza rete.** Le risposte dell'LLM sono registrate in `tests/fixtures/llm/` (`pnpm llm:record` ne registra di nuove). Prima di committarle controlla che non contengano chiavi o identificativi di account. I test del database usano il PostgreSQL Docker locale.
- **Schema del database**: modifica `lib/db/schema.ts`, genera la migrazione con `pnpm db:generate` e committala. Non modificare le migrazioni già presenti.

Convenzioni:

- Codice, identificatori e messaggi di commit in **inglese**. I valori di dominio seguono `ARCHITECTURE §4.2` (per esempio `'pranzo'`, `'cena'`, i reparti in italiano).
- Testi dell'interfaccia in **italiano**, con il tono di `DESIGN.md §5`. Documentazione e wiki in italiano.
- **Mobile first**: target di tocco di almeno 44 px, contrasto AA, rispetto di `prefers-reduced-motion` (`DESIGN.md §6`).

## Pull request

1. Crea un branch da `main` con un prefisso che dica il tipo di modifica: `feature/<descrizione>`, `fix/<descrizione>`, `docs/<descrizione>` o `chore/<descrizione>`.
2. Scrivi i messaggi di commit nello stile [Conventional Commits](https://www.conventionalcommits.org/): `tipo(ambito): descrizione`, con tipo `feat`, `fix`, `docs`, `test`, `refactor` o `chore`.
3. Aggiungi o aggiorna i test per il comportamento che cambi.
4. Se cambi comportamento, API o schema, aggiorna la documentazione: README, `docs/ARCHITECTURE.md` e la pagina della wiki interessata.
5. Fai girare il gate in locale, con il PostgreSQL di sviluppo attivo e migrato:

   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm build
   ```

   La CI fa girare lo stesso gate su ogni pull request, più un job che costruisce l'immagine Docker e prova lo stack di produzione. Sulle pull request da un fork i workflow partono dopo l'approvazione del maintainer.
6. Nella descrizione della pull request spiega cosa cambia, perché e come provarlo. Per le modifiche all'interfaccia aggiungi uno screenshot da telefono (circa 360 px di larghezza).

La versione dell'app e le note di rilascio le aggiorna il maintainer.

## Licenza

Contribuendo accetti che il tuo contributo sia distribuito con la [licenza MIT](LICENSE) del progetto.
