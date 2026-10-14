# Mealy — Rework: catalogo di ricette da dataset

Proposta di cambio di rotta: le ricette non le inventa più il modello durante l'uso, arrivano da un **catalogo** costruito in anticipo a partire da un dataset di ricette reali. L'LLM si sposta a monte, nella pulizia del dataset, e a runtime diventa opzionale.

Stato al 12 ottobre 2026: **solo ragionamento, nessuna modifica al codice**. Il primo passo è un seed di 100–200 ricette nella versione attuale; il catalogo con l'intero dataset è per la V2 e potrà vivere su un fork. Le funzionalità che ne discendono sono in [`v2-funzionalita.md`](v2-funzionalita.md).

## 1. Perché

- **Il motivo d'origine dell'LLM era trovare ricette.** Con un dataset di ricette reali quel lavoro lo fa meglio un catalogo con una ricerca.
- **La generazione è il punto fragile della v1.** Con libreria vuota il primo piano fa partire 8 chiamate in parallelo (lotti da 3 ricette, timeout di 90 s ciascuna): con un modello lento va in timeout, come successo al primo avvio sul Raspberry.
- **Senza LLM a runtime** spariscono attese, timeout, costi e chiave API sul Raspberry: il piano esce subito, sempre.

## 2. Il dataset

File: `docs/recipe.csv` (10,2 MB). Origine: [Italian Food Recipes su Kaggle](https://www.kaggle.com/datasets/edoardoscarpaci/italian-food-recipes), versione 1 dell'8 gennaio 2022, senza descrizione, licenza indicata come "Unknown".

> Il file **non va committato**: contiene i testi di GialloZafferano e oggi non è ignorato da git. Va spostato in una cartella ignorata o aggiunto a `.gitignore`.

### 2.1 Contenuto

5.939 ricette, tutte di `ricette.giallozafferano.it`. Colonne:

| Colonna | Contenuto |
|---|---|
| (indice) | Numero progressivo |
| `Nome` | Titolo, senza duplicati |
| `Categoria` | Una di 12 categorie (2 righe vuote) |
| `Link` | URL della ricetta originale |
| `Persone/Pezzi` | Intero; mescola persone e pezzi (fino a 40) |
| `Ingredienti` | Lista di coppie `[nome, quantità]`, con la quantità come testo (`'750g'`, `'q.b.'`, `'2'`) |
| `Steps` | Procedimento in un blocco unico di testo (4 righe vuote) |

Categorie: Dolci 1.744 · Primi piatti 1.314 · Antipasti 887 · Secondi piatti 831 · Lievitati 329 · Piatti Unici 271 · Contorni 175 · Torte salate 105 · Salse e Sughi 91 · Bevande 71 · Marmellate e Conserve 62 · Insalate 57.

### 2.2 La parte utile

Adatte a pranzo e cena: **2.578 ricette** (primi, secondi, piatti unici, torte salate, insalate). Su queste:

| Misura | Valore |
|---|---|
| Liste di ingredienti leggibili | tutte (1 ricetta senza ingredienti) |
| Quantità già in g, ml, kg, l, pezzi o "q.b." | 95,3% |
| Quantità in cucchiai, cucchiaini, pizzichi | 3,1% |
| Quantità illeggibili o composte | 1,5% |
| Ricette con ogni quantità convertibile in modo meccanico | 2.204 (85%) |
| Nomi di ingrediente distinti | 1.116 |
| Ingredienti per ricetta (mediana) | 11 |
| Ricette con al massimo 8 ingredienti | 542 |
| Ricette con più di 12 porzioni | 53 |

### 2.3 Cosa manca e cosa è sporco

Campi che l'app richiede (`GeneratedRecipeSchema` in `lib/domain/types.ts`) e che il dataset non ha:

- tempo di preparazione, e stima delle calorie
- pranzo/cena, etichette di stile (veloce, salutare, proteico, leggero, comfort-food, economico, piatto-unico)
- esigenze alimentari ed elettrodomestici necessari
- per ogni ingrediente: nome canonico e reparto del supermercato
- passi separati (il procedimento è un blocco unico, mediana di circa 1.200 caratteri, con la punteggiatura in parte persa)

Errori dello scraping:

- **Virgole decimali perse**: `'025g'` per 0,25 g. Quando c'è lo zero iniziale si riconosce; `'25g'` per 2,5 g no.
- **Unità perse**: `'2'` di parmigiano, dove l'originale diceva 2 cucchiai.
- **Quantità concatenate**: `'250g1kg'`.

Sono poche (decine di casi riconoscibili), ma una parte è silenziosa.

Stile: sono ricette da sito di cucina, spesso lunghe ed elaborate. Senza il tempo di preparazione non si può filtrare per "veloce" finché non lo si stima.

## 3. L'idea

### 3.1 Tre livelli

| Livello | Cos'è | Chi lo riempie |
|---|---|---|
| **Catalogo** | Il dataset pulito e convertito nel formato dell'app. Uguale per tutti. | La pulizia, una volta sola, fuori dall'app |
| **Libreria** | La tua rotazione: le ricette entrate nei tuoi piani, votate, preferite. | Il planner, pescando dal catalogo; tu, aggiungendo a mano |
| **Punteggi** | Voti, preferite, numero di usi, ultimo uso. | Tu, usando l'app |

Scelta presa: **rotazione che cresce**. Il piano non pesca ogni settimana da tutto il catalogo, ma dalla tua libreria, che il catalogo alimenta poco per volta.

### 3.2 Perché non caricare tutto in libreria

Con 2.500 ricette nella libreria attuale:

- **Le preferite spariscono.** Il peso di una preferita è 1,5, quello di una ricetta mai usata 1,2: dieci preferite contro 2.500 ricette nuove escono a spanne una volta ogni tre mesi.
- **Lo stile non conta.** Le etichette di stile oggi arrivano solo al modello che genera; il planner non le usa quando sceglie.
- **La schermata Libreria non regge**: elenca tutto in una pagina.

### 3.3 Punteggi accanto al catalogo, non dentro

Nel catalogo sta ciò che è vero per tutti (ingredienti, tempo, etichette). I punteggi stanno in una tabella a parte, per due motivi:

- rilanciando la pulizia con uno script migliore si ricarica il catalogo senza perdere i punteggi;
- la tabella esiste già (`recipe_prefs`) e il planner calcola già il peso da voto, preferita, uso recente, novità e ingredienti graditi (`ARCHITECTURE §5.2`).

Etichette come leggero o economico fanno parte della pulizia: si assegnano una volta e restano nel catalogo.

## 4. La pulizia del dataset

Si esegue una volta, sul PC, e produce il catalogo. Passi proposti:

1. **Filtro**: solo le categorie adatte a pranzo e cena; via le ricette senza ingredienti o senza procedimento.
2. **Quantità**: conversione meccanica (kg → g, l → ml, numero senza unità → pezzi, "q.b." → qb); cucchiai e pizzichi convertiti con una tabella; casi sospetti segnalati.
3. **Ingredienti**: una mappa unica nome → nome canonico e reparto, sui 1.116 nomi distinti. Si fa una volta per ingrediente, non per ricetta.
4. **Etichette**: pranzo/cena, stile, elettrodomestici. È classificazione (vedi §6).
5. **Esigenze alimentari**: ricavate **per regola** dagli ingredienti normalizzati, non da un modello. Sono filtri vincolanti.
6. **Passi e tempo**: divisione del procedimento in passi brevi e stima dei minuti. Serve un modello generativo, oppure una regola più grezza.
7. **Validazione** con lo schema dell'app; le ricette che non passano restano fuori.
8. **Controllo a campione** e, per un primo pacchetto ridotto, revisione dei titoli a mano.

Il primo giro, il seed della versione attuale, si ferma a 100–200 ricette scelte e riviste (quantità pulite, pochi ingredienti, bilanciate per ingrediente principale): lo script è lo stesso che poi gira sul resto. Il planner evita di riproporre una ricetta per circa 4 settimane, quindi servono almeno 28 ricette per tipo di pasto.

## 5. Cosa cambia nell'app

- **Tabella del catalogo**, separata dalla libreria, con il link all'originale.
- **Planner**: quando la libreria non basta pesca dal catalogo invece di chiamare il modello, filtrando per vincoli. In più:
  - **stile nel peso**: le etichette di stile entrano nella scelta;
  - **quota di scoperte**: per esempio 2–3 pasti a settimana dal catalogo, il resto dalla rotazione. Protegge le preferite meglio di un gioco di pesi.
- **Caricamento del catalogo** all'avvio dell'app, senza duplicare ciò che c'è già.
- **LLM a runtime opzionale**: senza modello configurato l'app gira solo a catalogo. Dopo qualche settimana si guarda quante volte è intervenuto e si decide se toglierlo.
- **Documenti**: il principio "le ricette generate sono la libreria" (`ARCHITECTURE §1.3`) va riscritto.

Il planner resta una funzione pura con pesi espliciti, spiegabili e testabili.

## 6. Il ruolo dei modelli

| Dove | Modello | Giudizio |
|---|---|---|
| Pulizia: etichette e reparti | Decisionale (Jev) o generativo | Sì. È classificazione; la confidenza indica cosa rivedere a mano |
| Pulizia: passi e tempi | Generativo | Sì. Jev non scrive testo ed è debole con i numeri |
| Esigenze alimentari | Nessuno: regola sugli ingredienti | Un modello probabilistico non basta per un filtro vincolante |
| Scelta settimanale del piano | Nessuno: formula del planner | No a un modello: scatola chiusa, dipendenza di rete, e i voti dell'utente sono un segnale migliore |
| Richieste libere | Generativo, con eventuale riordino di Jev | Vedi `v2-funzionalita.md` |

**Jev** (TypeSafe AI, uscito il 15 settembre 2026) è un modello decisionale: riceve uno stato e domande tipizzate (sì/no, scelta, punteggio) e restituisce numeri con una confidenza, senza testo. Da verificare prima dell'uso:

- l'accuratezza riportata è intorno al 68% sul benchmark del produttore: etichettare a mano un centinaio di ricette e confrontare;
- si usa tramite l'API di TypeSafe (nessuna conferma che sia su OpenRouter): servirebbe un adattatore separato da `lib/llm/`.

Fonti: [Simon Willison](https://simonwillison.net/2026/Sep/21/jev/), [DataCamp](https://www.datacamp.com/blog/system-one-models-jev).

## 7. Rischi e limiti

- **Qualità tutta a monte**: un errore della pulizia resta nel catalogo finché non viene corretto. Serve un modo per correggere una ricetta (vedi V2).
- **Vincoli molto stretti**: con "vegano e sola friggitrice ad aria" il catalogo potrebbe avere poche ricette. Quanto sia stretto si misura dopo la conversione.
- **Diritti**: i procedimenti sono testi di GialloZafferano. Per uso personale il rischio pratico è minimo; riscrivere i passi riduce il problema, e i dati restano comunque fuori dal repository.
- **Dataset fermo al 2022**: nessun aggiornamento, 2.578 piatti. A 14 pasti la settimana sono più di tre anni senza ripetizioni.

## 8. Decisioni prese e aperte

Prese:

- Rotazione che cresce, alimentata da un catalogo separato dalla libreria.
- Punteggi in una tabella a parte.
- Etichette assegnate durante la pulizia.
- In due tempi: prima un seed di 100–200 ricette riviste nella versione attuale, poi l'intero dataset nella V2.
- Jev per la pulizia dell'intero dataset, dopo averne verificato l'accuratezza (§6).

Aperte:

- Quale modello generativo per passi e tempi, che Jev non copre.
- Passi riscritti da un modello o divisi per regola.
- Dimensione della quota di scoperte e peso dello stile.
- LLM a runtime: opzionale o rimosso.
- Fork o branch per il rework.

Quando si passa dal ragionamento alla specifica: `/feature-brainstorm`, poi la pipeline abituale.
