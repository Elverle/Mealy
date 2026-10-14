---
title: Riquadro di Richiesta e Sheet di Proposta — RecipeRequestBox e RecipeProposalSheet (recipe-proposal-sheet)
type: entity
created: 2026-10-14
updated: 2026-10-14
tags: [ui, components, recipes, llm, proposal, sheet, abort-controller, accessibility, feature-9]
---

## File e Responsabilità

- **Percorsi file**:
  - `components/recipes/recipe-request-box.tsx` (`"use client"`): `RecipeRequestBox`, il riquadro *Chiedi una ricetta per «…»*.
  - `components/recipes/recipe-proposal-sheet.tsx` (`"use client"`): `RecipeProposalSheet`, la sheet che chiede una proposta all'LLM, la mostra in sola lettura e offre l'azione primaria.
- **Scopo**: i due pezzi condivisi della richiesta libera ([[f9-ricette-su-richiesta]]). Gli stessi componenti servono la Libreria ([[library-screen]], azione *Aggiungi alla libreria*) e il selettore del Piano ([[slot-recipe-picker]], azione *Metti nel piano*).
- **Confini**: importano solo codice sicuro per il client: `recipeRequestText` e `appendProposedTitle` (`lib/domain/library.ts`, [[library-service]]), `requestRecipeProposal` (`lib/library/client.ts`), `apiErrorMessage` ([[http-helpers]]), `proposalToRecipeDetail` ([[recipe-sheet]]) e i messaggi di attesa di `components/plan/generation-progress.tsx` ([[plan-screen]]). La sheet di proposta **non scrive nulla da sola**: salvare o assegnare è compito di chi passa `onAccept`.

## `RecipeRequestBox`

```ts
export interface RecipeRequestBoxProps {
  query: string;                                // testo cercato, così com'è nel campo
  onRequest: (text: string) => void;            // riceve il testo senza spazi ai bordi
  buttonRef?: React.Ref<HTMLButtonElement>;     // per riportarci il focus
  className?: string;
}
```

- Rende **nulla** se `recipeRequestText(query)` è `null`, cioè con meno di `RECIPE_REQUEST_MIN` (3) caratteri dopo il trim o più di `LIBRARY_QUERY_MAX` (100).
- Altrimenti una `<section aria-label="Chiedi una ricetta">` con bordo tratteggiato, il testo `Non c'è quello che cerchi?` e un `Button` `outline` in `text-basil` con icona `Sparkles` ed etichetta `` `Chiedi una ricetta per «${testo}»` ``; il pulsante va a capo (`whitespace-normal`, `break-words`) e resta alto almeno 44 px.
- Il testo dell'utente è reso come testo React, mai come HTML (test dedicato).

## `RecipeProposalSheet`

```ts
export interface RecipeProposalSheetProps {
  request: string | null;      // testo della richiesta; null = sheet chiusa. Un testo nuovo fa ripartire la sequenza
  mealType: MealType | null;   // imposto dal Piano; null = lo decide il modello (Libreria)
  servings: number;            // porzioni su cui mostrare le quantità
  acceptLabel: string;         // «Aggiungi alla libreria» oppure «Metti nel piano»
  onAccept: (recipe: GeneratedRecipe) => Promise<void>;
  onClose: () => void;
}
```

### Stati
`status`: `pending` → `proposal` oppure `error`. Tutti e tre stanno nello **stesso** `RecipeSheet` (requirements P15): attesa ed errore passano come `placeholder`, la proposta come `recipe`, così il pannello non si rimonta e l'animazione d'ingresso non riparte.

| Stato | Titolo | Contenuto |
|---|---|---|
| `pending` | `«richiesta»` | `role="status"` con `Cerco una ricetta…` e poi, a rotazione, i `GENERATION_MESSAGES` (`useRotatingMessage`, 2,5 s); tre righe scheletro `aria-hidden` con `motion-reduce:animate-none` |
| `error` | `«richiesta»` | `role="alert"` con il messaggio dell'API (`apiErrorMessage`) e il pulsante `Riprova` |
| `proposal` | titolo della ricetta | la ricetta in sola lettura (`proposalToRecipeDetail(recipe, servings)`): tempo, chip, descrizione, ingredienti scalati, passi. **Nessun** voto, ★, *Non proporre più* né 👍/👎: la ricetta non è in libreria |

Con una proposta il `footer` contiene `Un'altra` (`outline`) e, se non è un doppione, il pulsante primario con `acceptLabel`. Con `duplicate_of` il `notice` mostra `` `Questa ce l'hai già: «${duplicate_of.title}»` `` (`role="status"`, bordo `saffron`) e l'azione primaria è nascosta: restano *Un'altra* e la chiusura (spec FR-2.6).

### Richiesta, sequenza e annullamento
- `load(text)` annulla la richiesta in corso (`AbortController`), torna a `pending` e chiama `requestRecipeProposal({ request, mealType, excludeTitles }, signal)`. Una risposta arrivata dopo l'annullamento è ignorata (`signal.aborted`): il client la riceve come `network_error`, quindi il controllo è sul segnale e non sul codice (requirements P13).
- **Sequenza di *Un'altra***: `titlesRef` tiene i titoli già proposti; a ogni proposta `appendProposedTitle` aggiunge il titolo in coda, toglie un eventuale doppione per titolo normalizzato e conserva gli ultimi `PROPOSAL_EXCLUDE_MAX` (10). *Un'altra* e *Riprova* rifanno la richiesta con lo stesso testo e quei titoli.
- **Apertura e nuovo testo**: l'effetto su `request` azzera la sequenza e chiama `load`; la sua pulizia annulla la richiesta in corso. Quando `request` cambia (apertura, chiusura, testo nuovo) lo stato della proposta precedente si azzera **durante il render** (`shownRequest`), così non compare nemmeno per un frame.
- **Chiusura durante l'attesa**: `request` passa a `null`, l'effetto annulla la `fetch` e niente viene salvato. Lato server la rotta riceve l'annullamento (`request.signal`) e risponde `499` senza log ([[recipe-proposal-service]]).

### Azione primaria
- `handleAccept` imposta `accepting`: *Un'altra* e il pulsante primario sono disattivati (nessun doppio invio) e la sheet **ignora** ✕, Esc e sfondo finché la promessa di `onAccept` non si chiude (fix della code review, commit `9cf6948`): l'esito tardivo di un salvataggio agirebbe altrimenti su una proposta successiva, chiudendola o azzerandola.
- La sheet non si chiude da sola: chi chiama porta `request` a `null` quando ha finito. Se `onAccept` rigetta, i pulsanti tornano attivi e la proposta resta a schermo. I messaggi (toast) li mostra chi chiama.

## Uso

| Chi lo usa | `mealType` | `acceptLabel` | `onAccept` |
|---|---|---|---|
| [[library-screen]] | `null` | `Aggiungi alla libreria` | `requestSaveRecipe`; al successo nuova card, filtri azzerati, toast `«titolo» è in libreria`, sheet chiusa; all'errore toast e rilancio (la sheet resta aperta, compreso `recipe_duplicate`) |
| [[slot-recipe-picker]] | pasto dello slot | `Metti nel piano` | `requestSaveRecipe` e poi `requestAssignSlotRecipe` (v. la pagina del selettore per gli esiti) |

## Test

- `tests/ui/recipe-request-box.test.tsx`: nessun riquadro per `""`, `"ab"`, `"  ab  "`; testo rifilato inviato al clic; `buttonRef`; markup nel testo reso come testo.
- `tests/ui/recipe-proposal-sheet.test.tsx` (client mockato): nessuna richiesta con `request: null`; attesa; tipo di pasto inviato; proposta in sola lettura con quantità scalate e senza controlli di giudizio; *Un'altra* con i titoli già proposti; avviso di doppione senza azione primaria; errore come `alert` e *Riprova* con gli stessi titoli; annullamento alla chiusura con risposta tardiva ignorata; riapertura che riparte dall'attesa; sequenza che riparte con un testo nuovo; azioni disattivate durante `onAccept`; chiusura ignorata durante `onAccept`; proposta conservata se `onAccept` rigetta; rotazione dei messaggi.

## Vedi anche

- [[recipe-sheet]] — `RecipeSheet` con `placeholder`, `notice`, `footer` e `proposalToRecipeDetail`
- [[recipe-proposal-service]] — Rotte e servizio chiamati dalla sheet
- [[library-service]] — `recipeRequestText`, `appendProposedTitle`, client `requestRecipeProposal`
- [[library-screen]] — Uso dalla Libreria
- [[slot-recipe-picker]] — Uso dal selettore del Piano
- [[sheet-primitive]] — Pila delle sheet: la proposta si apre sopra il selettore
- [[f9-ricette-su-richiesta]] — Panoramica della Feature 9
