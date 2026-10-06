# Feature 5 — E2 Libreria e preferenze: Requisiti e Decisioni

Memoria del "perché" dietro `plan.md`. Story: `docs/BACKLOG.md` S2.1–S2.3. Riferimenti: `docs/ARCHITECTURE.md §4.2, §5.1, §5.2, §5.4, §6`, `docs/DESIGN.md §3, §4.2, §4.4, §4.5, §5, §6`, `docs/planning/execution-strategy.md §3 Feature 5 e §4`, requirements di F4 (U4, P3, P17 e "F3 R1 accettato così"), review architetturale di F4 (R4, R6, P4).

## 1. Layout e identità
- **Layout**: `docs/planning/` (da `.claude/agentic-feature-factory.local.md`), cartella `docs/planning/feature/feature-5/`.
- **Titolo**: Feature 5 — E2 Libreria e preferenze (ricetta + ingredienti).
- **Prerequisiti**: Feature 1–4 implementate e in `main` (v0.3.0, commit `ffee6f3`). Vale "il codice reale vince".

## 2. Decisioni prese con l'utente (2026-10-05)
| # | Decisione | Motivo |
|---|---|---|
| U1 | **Preferenze attive in Piano e in Libreria**: ★ rapida sulla card-pasto e sulla card di libreria; voto, *Preferita*, *Non proporre più* e 👍/👎 sugli ingredienti nel dettaglio aperto da entrambe le pagine | DESIGN §3 e §4.2; le preferenze ingrediente si esprimono "dalle ricette proposte", cioè dal piano. Chiude U4 di F4 |
| U2 | **Il piano in corso non cambia**: bloccare una ricetta o scartare un ingrediente vale da prossima generazione, rigenerazione, *Ripeti* o *Cambia*. Un toast lo dice | Coerente con "F3 R1 accettato così" di F4; nessuna modifica al servizio dei piani, nessuna sorpresa sui piani confermati |
| U3 | **Filtri: riga rapida + pannello**. Sempre visibili *Preferite*, *Pranzo*, *Cena* e il pulsante *Filtri* con contatore; il pannello contiene tipo di pasti (7), dieta (5) e *Bloccate* | 16 chip in una riga sola finirebbero fuori schermo; *Bloccate* deve restare raggiungibile |
| U4 | **Ordinamento: preferite in alto, poi le più recenti** (a parità, titolo A–Z) | Scelta dell'utente; l'ordine si ricalcola subito quando una ★ cambia |

## 3. Decisioni prese in planning (motivate)
| # | Decisione | Motivo |
|---|---|---|
| P1 | Moduli: `lib/domain/{library,prefs}.ts` (puri), `lib/db/repositories/ingredient-pref-repo.ts` + aggiunte a `recipe-repo.ts`, `lib/library/{service,client}.ts`, `lib/prefs/{ingredient-prefs,service,client}.ts`. **Nessun barrel** | Stesso schema di `lib/plans/` e `lib/settings/`: i componenti client importano solo i `client.ts`, mai il DB |
| P2 | `ingredient_prefs` ha chiave `(household_id, canonical_name)`, non il solo `canonical_name` di ARCHITECTURE §4.2 | Le ricette sono per household e `loadIngredientPreferences(householdId)` lo prevede già; con una tabella globale un 👎 inserito da un file di test cambierebbe i piani dei test che girano in parallelo. WP2 aggiorna ARCHITECTURE |
| P3 | Il `canonical_name` delle preferenze è sempre normalizzato con `normalizeCanonicalName`; **gli alias non si risolvono** | È la stessa regola con cui il planner confronta gli ingredienti; gli alias servono al consolidamento della spesa (F6) |
| P4 | **Conteggio d'impatto** = ricette **non bloccate** della libreria che contengono l'ingrediente, calcolato in memoria dalla funzione pura `countRecipesByIngredient` | Stessa normalizzazione del planner, senza riscriverla in SQL; la libreria è già caricata intera a ogni piano |
| P5 | L'impatto si mostra **prima** della conferma perché arriva con il dettaglio (`GET /api/recipes/:id` restituisce pref e conteggio di ogni ingrediente). La `PUT` restituisce comunque il conteggio aggiornato. **Nessun endpoint in più** rispetto ad ARCHITECTURE §6 | BACKLOG S2.3 e ARCHITECTURE §5.4 ("la UI mostra l'impatto prima di confermare") |
| P6 | `PUT /api/recipes/:id/pref` accetta un **aggiornamento parziale** (`rating`, `favorite`, `blocked`, almeno uno). `rating: null` toglie il voto; toccare la stella già attiva lo toglie | La ★ della card non deve riscrivere voto e blocco con valori vecchi |
| P7 | **Bloccare toglie dalle preferite** (`blocked ⇒ favorite = false`); regola in una funzione pura usata dal server e dall'aggiornamento ottimistico del client | Una ricetta bloccata non è mai proposta: tenerla preferita non avrebbe senso; un'unica regola evita divergenze |
| P8 | La Libreria è una **pagina server** che passa tutte le card (bloccate comprese) a un componente client; filtri, ricerca e ordinamento si applicano **in memoria** con le stesse funzioni pure usate da `GET /api/recipes` | Filtri istantanei, nessuna corsa tra risposte, una sola logica testata. Stesso schema di `/` e `/impostazioni` (F4 P16) |
| P9 | La card di libreria è un DTO leggero (`LibraryRecipeCard`, con i nomi canonici degli ingredienti per la ricerca); il dettaglio completo si legge con `GET /api/recipes/:id` all'apertura | La libreria cresce senza limite: passi e quantità di tutte le ricette non devono viaggiare a ogni visita |
| P10 | Ricerca: testo senza accenti e minuscolo (`normalizeTitle`), spezzato in parole; ogni parola deve comparire nel titolo o nei nomi canonici degli ingredienti | "Cerca ricetta o ingrediente" (mock di F1), tollerante su accenti e ordine delle parole |
| P11 | Filtri combinati in **AND**. Dieta: una ricetta vegana soddisfa anche il filtro *Vegetariano* (`expandDietFlags`). *Bloccate* acceso mostra solo le bloccate, spento le nasconde | Stesse regole di dieta del planner; "le bloccate restano visibili in Libreria con filtro dedicato" (S2.2) |
| P12 | Un solo componente intelligente, `RecipeDetailSheet`, usato da Piano e Libreria: carica il dettaglio, salva le preferenze in modo ottimistico e avvisa il genitore. `RecipeSheet` resta presentazionale, con sole aggiunte compatibili | Le due pagine devono comportarsi allo stesso modo; le modifiche compatibili tengono verde il gate tra le wave (la pagina finta di F1 continua a compilare) |
| P13 | Nel Piano il dettaglio si apre **subito** con la ricetta già presente nel piano (quantità sulle porzioni dello slot); i 👍/👎 compaiono quando arriva il dettaglio. In Libreria si vede uno scheletro finché il dettaglio arriva; quantità sulle persone dell'household | F4 P17 (nessuna attesa nel Piano); "mai spinner nudo" (DESIGN §5) |
| P14 | Durante un salvataggio i controlli interessati sono disabilitati (barra azioni oppure 👍/👎) | Niente risposte fuori ordine senza contatori di richiesta |
| P15 | Il 👍 e la rimozione di un giudizio non chiedono conferma; solo lo scarto la chiede, con l'impatto. In *I miei ingredienti* la rimozione è a un tap | DESIGN §4.2 e §4.5 |
| P16 | Generazione LLM: tutti i `dislike` vanno nei vincoli (servono anche a `findConstraintViolations`, che scarta le ricette che li contengono); i `like` sono al più 30, in ordine alfabetico. **`lib/llm/` non si tocca**: il prompt ha già le due righe | "Né proposta né generata" è garantito in modo deterministico dallo scarto dopo la generazione, non dalla sola obbedienza del modello |
| P17 | `loadIngredientPreferences` diventa reale in wave 1 (insieme al repository); `buildConstraints` riceve gli insiemi come quarto parametro opzionale | Punto di lettura unico (review F4 R4); `buildConstraints` resta pura |
| P18 | *I miei ingredienti*: `SettingsEditor` riceve `initialIngredientPrefs` **opzionale** (default: liste vuote) e mostra la nuova sezione al posto del segnaposto | La pagina lo passa sempre; i test esistenti che montano `SettingsEditor` senza il parametro restano validi |
| P19 | Errori: nessuna classe nuova. I servizi restituiscono `null` se la ricetta non è dell'household e le rotte rispondono `404 recipe_not_found`; i client lanciano `ApiRequestError` di `lib/http/client.ts` | Un solo codice d'errore di dominio non giustifica una gerarchia; il client generico esiste apposta (review F4 P4) |
| P20 | `GET /api/recipes` esiste e applica i filtri lato server, ma la UI v1 non la chiama (P8) | È un task di S2.1 e una riga di ARCHITECTURE §6; costa una rotta sottile sulle stesse funzioni pure |
| P21 | Nessuna paginazione, nessun filtro nell'URL, nessun contrassegno "contiene un ingrediente scartato" sulle card | Fuori da S2.1–S2.3; libreria di un solo utente |

## 4. Punti aperti dalle feature precedenti, chiusi qui
| Da | Decisione |
|---|---|
| F4 U4 (★, voto, blocca nascosti) | Attivati passando gli handler a `MealCard` (da `PlanSlotCard`) e usando `RecipeDetailSheet` in `PlanScreen` (U1) |
| F4 P17 (nessun `GET /api/recipes/:id`) | Introdotto qui; il Piano continua a mostrare subito la ricetta che ha già (P13) |
| F3 R1 / wiki `settings-service` (le preferenze ingrediente non toccano `households.updated_at`) | Confermato: nessun avviso di "piano superato" per un giudizio (U2) |
| Review F4 R4 (un solo punto di lettura delle preferenze ingrediente) | `lib/prefs/ingredient-prefs.ts`, usato da `lib/plans/service.ts` e da `lib/recipes/generate.ts` (P17) |
