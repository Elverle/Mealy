# Cosa Mangio Oggi — Design

**Versione:** 1.0 — companion di `ARCHITECTURE.md`

## 1. Soggetto e contesti d'uso

Un'app domestica per pianificare i pasti della settimana. Due momenti d'uso, con esigenze opposte:

1. **Divano, sera** — si genera e ritocca il piano: lettura comoda, immagini mentali del cibo, decisioni rapide (tieni / cambia / valuta)
2. **Supermercato, una mano sola** — si spunta la lista: tap target enormi, contrasto alto, zero fronzoli, niente perdita di stato se l'app va in background

Il design è **mobile-first**; il desktop è un layout a colonne dello stesso sistema.

## 2. Direzione visiva

Tono: quaderno di cucina moderno, non "app di dieta". Caldo ma pulito; il colore segnala lo stato (pianificato, da comprare, fatto), non decora.

### Palette

| Token | Hex | Uso |
|---|---|---|
| `paper` | `#FAF7F2` | Sfondo app |
| `ink` | `#26221B` | Testo primario |
| `basil` | `#3E6B4F` | Primario: azioni, tab attiva, conferme |
| `tomato` | `#C4482F` | Accento: swap, alert, elementi "da decidere" |
| `saffron` | `#E0A83C` | Highlight: preferite (stella), badge |
| `stone` | `#726B5F` | Testo secondario, bordi, disabled (4,9:1 su `paper`, 5,3:1 su bianco: AA per il testo piccolo) |

Dark mode: rimandata (v1 light-only, i contesti d'uso sono diurni/serali in casa e al supermercato illuminato).

### Tipografia

- **Display** (titoli ricetta, giorni): *Fraunces* — serif con carattere "food", usata con parsimonia (H1/H2 e titoli card)
- **Testo e UI**: *Figtree* — sans leggibile, 16 px base, scala 12/14/16/20/24/32
- **Dati** (quantità, tempi): Figtree tabular-nums

### Ritmo

Spaziatura su griglia 4 px; raggio 12 px per le card, 999 px per chip/badge; ombre quasi assenti (bordi `stone` al 20%), profondità data dal colore di sfondo delle card (`#FFFFFF` su `paper`).

## 3. Elemento firma

**La card-pasto con lo swap sempre a portata di pollice.** Ogni slot del piano è una card con: giorno/pasto in eyebrow, titolo Fraunces, chip dei tag (tempo, dieta), e tre azioni — ⟳ *Cambia* (in `tomato`), *Scegli* (in colore neutro) e ★ (preferenza rapida), in quest'ordine. Cambiare idea su una cena deve costare un tap, non un menù: *Cambia* resta a un tap, *Scegli* è la strada per chi vuole una ricetta precisa. Durante lo swap la card fa un flip breve e mostra la nuova proposta con *Tieni / Cambia ancora* e, tra i due, il pulsante con la lente per scegliere dalla libreria.

## 4. Mappa delle schermate

Navigazione: **tab bar inferiore a 4 voci** — Piano · Lista · Libreria · Impostazioni.

### 4.1 Piano (home)
- Header: navigatore ‹ settimana › (storico in sola lettura) + CTA *Genera piano* / *Rigenera* sulla settimana da pianificare
- Lista verticale di card-pasto raggruppate per giorno (pranzo/cena secondo impostazioni)
- Slot con lucchetto (long-press) → sopravvive alla rigenerazione
- *Scegli* apre il selettore *Scegli per ‹giorno› · ‹pasto›*: le ricette della libreria adatte a quel pasto, con ricerca; il tap su una ricetta apre il dettaglio con *Metti nel piano*; le ricette già in un altro pasto della settimana hanno l'etichetta *Già nel piano* e restano selezionabili. Se la ricetta voluta non c'è, dal selettore si chiede all'LLM (vedi 4.4).
- Footer sticky: *Crea lista della spesa* quando il piano è confermato

### 4.2 Dettaglio ricetta (sheet a tutta altezza)
- Titolo, descrizione, tempo, porzioni (scalate sul numero persone household)
- Ingredienti con quantità e, su ogni riga, toggle 👍/👎 discreto per la preferenza sull'ingrediente; passi numerati
- Scartare un ingrediente chiede conferma mostrando l'impatto: "Escluderà 8 ricette dai prossimi piani"
- Barra azioni: rating 1–5, ★ preferita, ⛔ *Non proporre più* (blocca)

### 4.3 Lista della spesa
- Legata a un piano confermato: si crea dal footer del Piano oppure, finché non esiste, dallo stato vuoto della tab *Lista* (*Crea lista della spesa* in entrambi i casi). La tab *Lista* apre l'ultima lista dei piani aperti; quando i piani aperti sono due (weekend) un selettore in alto passa da una settimana all'altra
- Sezioni per reparto nell'ordine del giro al supermercato (vedi ARCHITECTURE §5.5)
- Riga item: checkbox 44×44 px a sinistra, nome + quantità e, sotto il nome, le ricette per cui serve ("Per: …"); tap sulla riga = spunta (tutta la riga è target)
- Item spuntati: barrati, restano al loro posto nella sezione (l'ordine è per nome e non cambia con le spunte, così una riga si ritrova dov'era); progress "12/23" nel riquadro *Progresso spesa* in cima alla lista (con barra) e per sezione
- Pulsante flottante *Aggiungi* per gli articoli a mano: solo il nome (il reparto si deduce dalla libreria, altrimenti *Altro*); si rimuovono con ✕
- *Aggiorna lista* rigenera dalla versione corrente del piano, con conferma se ci sono spunte: sta nell'avviso "Il piano è cambiato" quando serve, altrimenti nell'header. Nessun gesto personalizzato: il pull-to-refresh resta quello del browser
- Senza rete, a pagina già aperta, le spunte restano a schermo e partono da sole quando la connessione torna ("N spunte in attesa di rete")

### 4.4 Libreria
- Ricerca (per titolo o ingrediente) + filtri a chip combinabili: sempre visibili *Preferite*, *Pranzo*, *Cena* e il pulsante *Filtri* (con contatore), che apre il pannello con tipo di pasti, dieta e *Bloccate*
- Card compatte con rating e ★, preferite in alto e poi le più recenti; le bloccate compaiono solo con il filtro *Bloccate*, da dove si sbloccano
- Con almeno 3 caratteri nel campo di ricerca, sotto l'elenco compare *Chiedi una ricetta per «…»*: l'LLM propone una ricetta in una sheet di sola lettura, con *Aggiungi alla libreria* e *Un'altra*. In libreria entra solo ciò che viene aggiunto.

### 4.5 Impostazioni (wizard al primo avvio, poi form)
- Persone · Pasti da pianificare · Tipo pasti · Esigenze alimentari · Elettrodomestici
- Sezione *I miei ingredienti*: due liste (mi piacciono / scartati) con rimozione a un tap — è la vista d'insieme delle preferenze espresse dalle ricette
- Stesso componente per onboarding (a step) e modifica (form unico)

## 5. Stati e microcopy

- **Generazione LLM (10–30 s)**: skeleton delle card + rotazione di microcopy in tono ("Sto sfogliando il ricettario…", "Accendo i fornelli…"); mai spinner nudo
- **Libreria vuota**: "Ancora nessuna ricetta. Genera il primo piano e la libreria si riempie da sola." + CTA
- **Errore LLM**: cosa è successo e cosa fare — "La generazione non è andata a buon fine. Riprova." (niente scuse, niente gergo)
- **Richiesta di una ricetta (10–30 s)**: sheet con "Cerco una ricetta…" e la stessa rotazione di microcopy; in caso di errore il messaggio e *Riprova*. Se la ricetta proposta è già in libreria: "Questa ce l'hai già: «…»"
- Azioni con lo stesso nome per tutto il flusso: *Genera piano* → toast "Piano generato"

## 6. Qualità minima (non negoziabile)

- Tap target ≥ 44 px; contrasto AA su `paper`
- Focus visibile da tastiera (desktop)
- `prefers-reduced-motion`: il flip dello swap degrada a dissolvenza
- La spunta della lista è **optimistic UI** con persistenza immediata: al supermercato la rete è pessima
