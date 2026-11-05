# Mealy — Funzionalità per la V2

Raccolta delle funzionalità rinviate a dopo la v1. Sono **idee, non ancora pianificate**: nessuna ha una specifica o un posto nel backlog. Le prime nascono dal rework del catalogo.

Stato al 14 ottobre 2026: v1 in prova sul Raspberry (versione 0.6.1). La Feature 9 (ricette su richiesta e cambio con scelta) è sviluppata e anticipa parte di 1.2 e 2.3.

## 0. Feedback per la versione attuale

Emersi dai primi test, da affrontare prima della V2:

- **Seed con 100–200 ricette**: un pacchetto iniziale preso dal dataset, pulito e caricato in libreria. Risponde al problema osservato: con 26 ricette il piano ruota sempre sulle stesse, perché sopra la soglia di 9 ricette fresche per tipo di pasto il planner non genera più. È la Feature 10 (era la 8 fino al 14 ottobre 2026): specifica in `planning/feature/feature-10/spec.md`.
- **Più tipi di pasto**: le voci del campo "Tipo di pasti" nelle impostazioni sono poche. Oggi sono sette: veloce, salutare, proteico, leggero, comfort food, economico, piatto unico. Deciso di aggiungerne cinque **prima del seed**, perché la pulizia le assegna a ogni ricetta: tradizionale, dal mondo, pochi ingredienti, si prepara in anticipo, piatto freddo. Sono un elenco chiuso in `lib/domain/types.ts`. Le porta la Feature 8 insieme alla portata delle ricette (piatto unico, primo, secondo, contorno): `planning/feature/feature-8/spec.md`. La composizione del pasto (primo o secondo con contorno) è la Feature 11: `planning/feature/feature-11/brainstorm-prompt.md`.
- **Chiedere una ricetta e scegliere dal piano**: il solo cambio casuale non basta, e non c'è modo di chiedere una ricetta precisa. È la Feature 9, sviluppata il 14 ottobre 2026: anticipa senza il catalogo la strada "inventare" di 1.2 e il cambio con scelta di 2.3 (`planning/feature/feature-9/spec.md`).

## 1. Ricette

### 1.1 Ricerca nel catalogo

Cercare una ricetta nel catalogo per nome, ingrediente o etichetta, e aggiungerla alla propria libreria.

- **Perché**: oggi le ricette entrano in libreria quando il planner le genera o, dalla Feature 9, quando le si chiede all'LLM. Non c'è modo di sceglierne una tra ricette già scritte fuori dalla libreria.
- **Come**: ricerca sugli ingredienti normalizzati e sulle etichette, senza modelli. "Zucchine" restituisce subito le ricette che le contengono.
- **Dipende da**: il catalogo.

### 1.2 Richieste libere

Scrivere una richiesta in linguaggio naturale, per esempio "una cena leggera con le zucchine che ho in frigo", e ricevere proposte.

- **Perché**: prima della Feature 9 non esisteva. La generazione partiva solo dal piano e dallo swap, e l'API accettava numero di ricette, tipo di pasto e vincoli, senza testo libero.
- **Come**: è il punto in cui l'LLM ha il suo posto a runtime. Due strade, combinabili:
  - **cercare nel catalogo**: filtrare per ingredienti e vincoli, poi ordinare le candidate per pertinenza alla richiesta (qui un modello decisionale come Jev è plausibile);
  - **inventare**: se nel catalogo non c'è nulla di adatto, il modello generativo crea una ricetta nuova.
- **Dipende da**: il catalogo per la prima strada; l'adattatore LLM che c'è già per la seconda.
- **Deciso (Feature 9)**: la ricetta inventata entra in libreria solo dopo conferma.
- **Anticipato dalla Feature 9**: la strada "inventare". Dal campo di ricerca della Libreria e dal selettore del Piano si chiede una ricetta con un testo libero; l'LLM ne propone una, che entra in libreria solo con *Aggiungi alla libreria* o *Metti nel piano*. **Resta per il catalogo**: cercare tra le ricette del catalogo e ordinarle per pertinenza alla richiesta.
- **Da valutare (critica Impeccable del 14 ottobre 2026)**:
  - **la proposta come pagina, non come sheet**: è il momento in cui la libreria cresce, e oggi un tap sullo sfondo la chiude. Una pagina con il proprio «indietro» (o una card nell'elenco) la renderebbe più difficile da perdere;
  - ***Un'altra* che tiene le proposte già viste**: oggi ogni *Un'altra* butta la proposta corrente e ne costa un'altra da 10–30 s. Due o tre proposte da scorrere avanti e indietro farebbero sentire l'attesa come un guadagno;
  - **le sheet impilate come una pila navigabile** (selettore, dettaglio, proposta): un solo sfondo, un «indietro» e la profondità annunciata, invece di modali indipendenti uno sopra l'altro.

### 1.3 Inserimento manuale di una ricetta

Aggiungere una ricetta propria, con l'LLM che su richiesta la cerca o la completa.

- **Perché**: oggi non si può. L'origine `manual` esiste solo nel modello dati come predisposizione (`ARCHITECTURE §9`); non c'è una schermata né un'API, e l'unico codice che la usa è il seed di sviluppo.
- **Come**: un form con titolo, ingredienti e passi. L'aiuto dell'LLM è facoltativo: da un nome o da un testo incollato compila i campi strutturati (quantità nelle unità dell'app, reparti, etichette, tempo), che poi si correggono a mano.
- **Da decidere**: se partire dal solo form e aggiungere l'aiuto dell'LLM dopo.

### 1.4 Correzione di una ricetta

Modificare una ricetta esistente, o segnalarla come sbagliata.

- **Perché**: con il catalogo la qualità dipende tutta dalla pulizia fatta a monte. Un errore (una quantità sbagliata, un'etichetta fuori posto) resta finché qualcuno non lo corregge.
- **Come**: lo stesso form dell'inserimento manuale, aperto su una ricetta esistente.
- **Dipende da**: 1.3.

### 1.5 Intero dataset, pulito con Jev

Portare nell'app tutte le ricette adatte del dataset (2.578), non solo il pacchetto iniziale, usando Jev per la pulizia.

- **Perché**: è il passaggio dal seed al catalogo vero. Il seed della versione attuale ne è la prova generale, con lo stesso procedimento su 100–200 ricette.
- **Come**: Jev assegna etichette e reparti, che sono classificazione; la confidenza indica quali ricette rivedere a mano.
- **Da verificare prima**: l'accuratezza di Jev su un centinaio di ricette etichettate a mano. Per dividere i passi e stimare i tempi serve comunque un modello generativo o una regola, perché Jev non scrive testo ed è debole con i numeri. Le esigenze alimentari restano ricavate per regola.

## 2. Planner

### 2.1 Stile nella scelta

Le etichette di stile scelte nelle impostazioni (veloce, salutare, leggero, …) entrano nel peso con cui il planner sceglie.

- **Perché**: oggi arrivano solo al modello che genera le ricette. Con ricette prese da un catalogo, senza questo passaggio una ricetta elaborata ha la stessa probabilità di una veloce.

### 2.2 Quota di scoperte

Ogni settimana un numero fisso di pasti, per esempio 2–3, arriva dal catalogo; il resto dalla rotazione.

- **Perché**: è il modo in cui la rotazione cresce senza che le preferite vengano sommerse dalle ricette nuove.

### 2.3 Cambio ricetta: rapido o con scelta

Sostituire una ricetta del piano in due modi: il cambio rapido di oggi, oppure scegliendola.

- **Perché**: prima della Feature 9 *Cambia* proponeva solo una ricetta sorteggiata, e per arrivare a quella giusta bisognava cambiare più volte. Dai primi test: il solo cambio casuale non basta.
- **Come**:
  - **cambio rapido**: resta com'è, un tap e una nuova proposta;
  - **cambio con scelta**: apre la libreria, filtrata per tipo di pasto e vincoli, e si sceglie da lì. Se in libreria non c'è nulla di adatto si cerca a mano, con l'LLM (vedi 1.1 e 1.2).
- **Design (deciso nella Feature 9)**: sulla card le azioni sono tre, *Cambia* · *Scegli* · ★. *Cambia* resta a un tap, quindi "cambiare idea su una cena deve costare un tap, non un menù" vale ancora per il cambio rapido (`DESIGN.md §3`).
- **Anticipato dalla Feature 9**: il cambio con scelta dalla libreria, con la richiesta all'LLM quando la ricetta non c'è. **Resta per il catalogo**: la ricerca nel catalogo (1.1) dal selettore, che è il punto in cui aggiungerla.

### 2.4 Ripeti più raggiungibile

"Duplica settimana" esiste già: è *Ripeti*, che copia un piano sulla settimana da pianificare e riempie gli slot rimasti vuoti. Il problema è che il pulsante si vede poco.

- **Quando compare oggi**:
  - *Ripeti questo piano*, sopra un piano con almeno una ricetta, solo se la settimana mostrata non è quella da pianificare e quest'ultima non è già confermata;
  - *Ripeti questa settimana*, sotto "Nessun piano in programma", se la settimana in corso ha un piano.
- **In pratica**: da lunedì a venerdì la settimana da pianificare è quella in corso, quindi il pulsante compare solo sfogliando una settimana passata, e solo finché il piano in corso è una bozza. Sabato e domenica la settimana da pianificare diventa la successiva, e il pulsante compare sul piano in corso.
- **Da decidere**: se serve renderlo raggiungibile anche durante la settimana, per esempio per preparare in anticipo la successiva.

### 2.5 Segnale implicito dallo swap

Una ricetta che viene sostituita spesso perde punti, anche senza un voto esplicito. Con il cambio a scelta (2.3) la ricetta scelta al suo posto ne guadagna.

- **Perché**: è un giudizio che l'utente dà già, senza accorgersene. `ARCHITECTURE §10` lo cita tra le revisioni possibili della formula di peso.
- **Dove**: per la scelta a mano il punto in cui registrarlo è `assignSlotRecipe` (`lib/plans/service.ts`, Feature 9), che oggi non lo fa.

### 2.6 LLM opzionale a runtime

Senza un modello configurato l'app funziona solo a catalogo; con un modello, lo usa per le richieste libere e per i vincoli che il catalogo non copre.

- **Perché**: toglie dal Raspberry la dipendenza più fragile, senza perdere la rete di sicurezza per i vincoli stretti.
- **Da decidere**: dopo qualche settimana d'uso, in base a quante volte il modello è davvero intervenuto.

## 3. Già previste altrove

Non sono descritte qui, solo richiamate:

| Funzionalità | Dove |
|---|---|
| Login e autenticazione | `ARCHITECTURE §8`, `CLAUDE.md` |
| Uso condiviso in due | `ARCHITECTURE §9` |
| PWA e lista della spesa offline | `ARCHITECTURE §9` |
| Export e stampa di piano e lista | `ARCHITECTURE §9` |

## 4. Ordine suggerito

Prima, nella versione attuale: il seed con 100–200 ricette (§0).

1. Catalogo con l'intero dataset pulito (1.5): è la base di quasi tutto il resto.
2. Planner sul catalogo: stile nel peso e quota di scoperte (2.1, 2.2).
3. Ricerca nel catalogo (1.1), anche dal selettore del Piano. Il cambio con scelta dalla libreria (2.3) c'è già, dalla Feature 9.
4. Inserimento manuale e correzione (1.3, 1.4).
5. Richieste libere sul catalogo (1.2): ordinare le candidate per pertinenza alla richiesta. La strada "inventare" c'è già, dalla Feature 9.
6. *Ripeti* più raggiungibile (2.4), se dopo qualche weekend d'uso risulta ancora scomodo.
7. Segnale dallo swap e scelta finale sull'LLM a runtime (2.5, 2.6).
