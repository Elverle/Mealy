---
title: Selettore di una Ricetta per lo Slot — SlotRecipePicker (slot-recipe-picker)
type: entity
created: 2026-10-14
updated: 2026-10-27
tags: [ui, components, plan, manual-choice, picker, sheet, search, llm, accessibility, courses, side-dish, feature-8, feature-9, feature-11]
---

## File e Responsabilità

- **Percorso file**: `components/plan/slot-recipe-picker.tsx` (`"use client"`)
- **Scopo**: la scelta a mano di una ricetta per uno slot del piano ([[f9-ricette-su-richiesta]]). Elenca le ricette della libreria adatte a quel pasto, con ricerca; il tap su una ricetta apre il dettaglio con *Metti nel piano*; se la ricetta voluta non c'è, la chiede all'LLM, la salva e la assegna.
- **Chi lo monta**: `PlanSlotCard` ([[plan-screen]]), solo a selettore aperto, **fuori** dal `div` con `key` che cambia tra card normale e revisione, così il passaggio tra le due modalità non lo rimonta (requirements P19).
- **Confini**: importa solo codice sicuro per il client: `fetchSlotCandidates` e `requestAssignSlotRecipe` (`lib/plans/client.ts`, [[plan-service]]), `requestSaveRecipe` (`lib/library/client.ts`, [[library-service]]), `filterLibraryCards`, `formatDayLabel`, `ApiRequestError` e `apiErrorMessage` ([[http-helpers]]). Non chiama mai l'LLM direttamente: lo fa [[recipe-proposal-sheet]] tramite `POST /api/recipes/propose`.

## Interfaccia

```ts
export interface SlotRecipePickerProps {
  planId: string;
  slot: PlanSlotView;                          // il componente va montato solo a selettore aperto
  onClose: () => void;                         // chiusura senza assegnazione (✕, Esc, sfondo), oppure dopo onPlanStale
  onAssigned: (plan: PlanView) => void;        // assegnazione riuscita; chi riceve smonta il selettore
  onPlanStale: () => void;                     // slot o piano non più modificabili: chi riceve rilegge il piano
  onNotify: (message: string) => void;         // toast del genitore
  onRecipePrefsChange?: (recipeId: string, changed: RecipePrefChanges) => void;
}
```

## Struttura

Tre sheet impilate, gestite dalla pila della primitiva ([[sheet-primitive]]): l'elenco resta montato mentre il dettaglio o la proposta gli si aprono sopra, quindi chiudendoli si ritrovano testo cercato e posizione (spec FR-6.2, requirements P14). Esc chiude solo la sheet in cima.

1. **Elenco** (`Sheet` sempre aperta, `SheetContent` `h-[92dvh] max-h-[92dvh]`, innesto R3):
   - titolo `` `Scegli per ${formatDayLabel(slot.day)} · ${MEAL_TYPE_LABELS[slot.meal]}` `` (es. `Scegli per Mercoledì 30 · Cena`);
   - campo di ricerca `type="search"` con le stesse classi di `LibraryFilters`, `aria-label="Cerca tra le ricette adatte"`, placeholder `Cerca ricetta o ingrediente…`, `maxLength={LIBRARY_QUERY_MAX}`; **non** prende il focus all'apertura, per non aprire la tastiera del telefono sopra l'elenco (requirements P22). Nessun chip di filtro;
   - in caricamento `role="status"` `aria-label="Caricamento delle ricette"` con tre riquadri scheletro;
   - in errore `role="alert"` con il messaggio dell'API e `Riprova`, qualunque sia il codice (requirements P21);
   - a dati arrivati: nessuna candidata → `Nessun'altra ricetta adatta a questo pasto`; ricerca senza risultati → `Nessuna ricetta trovata`; altrimenti la griglia di `RecipeCard` ([[library-screen]]) **senza** `onToggleFavorite` (la ★ non è un comando: sulle preferite resta l'icona `Preferita`) e con `badge="Già nel piano"` per gli id in `in_plan_recipe_ids`;
   - sotto l'elenco, con i dati arrivati, `RecipeRequestBox` sul testo cercato: compare anche con *Nessuna ricetta trovata* e con *Nessun'altra ricetta adatta*.
2. **Dettaglio**: [[recipe-detail-sheet]] con `servings = slot.servings` e `primaryAction = { label: 'Metti nel piano', onAction: assign, busy: assigning }`. È il dettaglio completo della Libreria, giudizi compresi.
3. **Proposta**: [[recipe-proposal-sheet]] con `mealType = slot.meal`, `servings = slot.servings`, `acceptLabel = 'Metti nel piano'`, `onAccept = acceptProposal`, `onClose` che porta `requestText` a `null` (nessun ritorno del focus qui).

**Dalla Feature 8** (senza modifiche al componente): le ricette solo contorno non arrivano tra le candidate, perché `manualChoiceExclusionReason` le esclude ([[planner]]); le card mostrano il badge di portata di `RecipeCard` ([[library-screen]]) e la proposta chiesta da qui deve avere una portata principale, altrimenti `proposal_unsuitable` ([[recipe-proposal-service]]). Nei test il nome accessibile atteso di una card ammette il badge di portata tra il tempo e il titolo.

**Dalla Feature 11** ([[f11-composizione-pasto]]) il selettore serve anche il contorno: `PlanSlotCard` lo monta con lo slot del contorno quando si tocca la lente della riga ([[side-dish-row]]). Il componente lo riconosce da `slot.course === 'contorno'`, senza props nuove:
- titolo `` `Scegli il contorno per ${formatDayLabel(slot.day)} · ${MEAL_TYPE_LABELS[slot.meal]}` `` invece di `Scegli per …`;
- elenco vuoto: `Nessun altro contorno adatto a questo pasto`;
- la proposta riceve `sideDish={true}`, quindi il modello deve proporre un contorno ([[recipe-proposal-sheet]], [[recipe-proposal-service]]).

L'elenco lo filtra il server per portata ([[plan-service]]): sul principale tutte le ricette con una portata principale (la composizione segue la ricetta scelta), sul contorno solo i contorni; in entrambi i casi senza la ricetta dell'altro piatto dello stesso pasto. La frase della Feature 8 sui contorni che non arrivano tra le candidate vale ora solo per il principale. Al posto della costante locale `STALE_PLAN_CODES` il componente importa `STALE_PLAN_ERROR_CODES` da `lib/plans/errors.ts`, che contiene anche `side_exists`, `side_not_allowed` e `not_a_side_dish` (proposta P3 della review architetturale della Feature 11): nella tabella degli esiti più sotto, «piano non più modificabile» vuol dire ora questi otto codici.

### Caricamento e filtro
- `load()` chiama `fetchSlotCandidates(planId, slotId)`; un contatore (`loadIdRef`) scarta le risposte di una richiesta superata (*Riprova* rapido, ricarica dopo un errore) e `mountedRef` quelle arrivate dopo lo smontaggio.
- `visible = filterLibraryCards(candidates.recipes, { ...EMPTY_LIBRARY_FILTER, q: query })`: stesse regole e stesso ordine della Libreria (ricerca su titolo e ingredienti, preferite prima). Con `EMPTY_LIBRARY_FILTER` le bloccate sono nascoste: una ricetta bloccata dal dettaglio sparisce dall'elenco.
- **Giudizi dal dettaglio** (`handlePrefsChange`): i campi cambiati si fondono nella card (bloccata ⇒ non preferita) e si inoltrano a `onRecipePrefsChange`, che `PlanScreen` collega ad `applyRecipePrefs`.

## Esiti di *Metti nel piano*

### Dal dettaglio (`assign`)
Un ref impedisce il doppio invio; durante la richiesta il pulsante è disattivato (`busy`). `requestAssignSlotRecipe(planId, slotId, recipeId)`:

| Esito | Comportamento |
|---|---|
| successo | `onAssigned(result.plan)`: `PlanSlotCard` chiude il selettore, torna alla card normale, azzera la sequenza degli scarti e riporta il focus su *Scegli* |
| `slot_locked`, `slot_past`, `plan_archived`, `plan_not_found`, `slot_not_found` (piano non più modificabile, requirements P20) | toast, `onPlanStale()` (il Piano fa `router.refresh()`), `onClose()` |
| `recipe_not_eligible`, `recipe_not_found` | toast, chiusura del dettaglio, elenco ricaricato |
| ogni altro errore (rete, 500) | toast; il dettaglio resta aperto e si può riprovare |

### Dalla proposta (`acceptProposal`)
1. `requestSaveRecipe(recipe)`. Se fallisce: toast con il messaggio dell'API, poi
   - `recipe_duplicate`: la proposta si chiude e l'elenco si rilegge, così una ricetta salvata da un tentativo precedente (risposta persa) compare tra le candidate. **Scostamento deliberato** da FR-8, che tiene aperta la sheet: proposto dalla review architetturale (R5) e confermato dall'utente il 2026-10-14; in Libreria FR-8 resta com'è;
   - ogni altro errore (`recipe_unsuitable`, rete, 500): rilancio, quindi la proposta resta aperta con i pulsanti di nuovo attivi.
2. `requestAssignSlotRecipe(planId, slotId, saved.id)`. Successo → `onAssigned`. Se fallisce, la ricetta è comunque in libreria: toast `Ricetta aggiunta alla libreria, ma non sono riuscito a metterla nel piano.`, la proposta si chiude e
   - piano non più modificabile (stessi cinque codici): `onPlanStale()` e `onClose()`;
   - altrimenti l'elenco si ricarica e il selettore resta aperto (decisione U3): la ricetta si rimette nel piano con un tap sul dettaglio.

## Regola di Montaggio

Il selettore è montato **dentro** l'elenco delle card, ma dalla revisione UI del 14 ottobre 2026 le sheet sono rese in un portale su `document.body` ([[sheet-primitive]]): nessun antenato con `opacity`, `transform` o `filter` le può più rendere semitrasparenti o farle finire sotto la tab bar. Il commento-regola su `plan-screen.tsx` (innesto R4) è stato tolto. Il campo di ricerca sta nell'intestazione fissa, sotto il titolo: resta visibile mentre si scorre l'elenco.

## Test

`tests/ui/slot-recipe-picker.test.tsx` (client mockati): titolo, caricamento e card; etichetta *Già nel piano* solo sulle ricette degli altri slot; filtro per titolo e per ingrediente senza chip; campo di ricerca senza focus all'apertura; messaggio senza candidate con il riquadro di richiesta; nessun risultato con il riquadro e nessun riquadro sotto i 3 caratteri; errore di caricamento con *Riprova*; classi `dvh`; assegnazione dal dettaglio; Esc che chiude solo il dettaglio conservando testo ed elenco; `onPlanStale` prima di `onClose`; `recipe_not_eligible` con ricarica; errore di rete con dettaglio aperto; azione disattivata e un solo invio; ricetta bloccata dal dettaglio tolta dall'elenco; proposta per il pasto dello slot salvata e assegnata; `recipe_unsuitable` con proposta aperta; `recipe_duplicate` con proposta chiusa e ricarica; toast "salvata ma non assegnata" con ricarica dopo un errore di rete e con `onPlanStale`/`onClose` su uno slot passato.

## Vedi anche

- [[plan-screen]] — `PlanSlotCard`, che apre il selettore e gestisce il focus
- [[plan-service]] — `listSlotCandidates`, `assignSlotRecipe` e i loro client
- [[recipe-detail-sheet]] — Dettaglio con `primaryAction`
- [[recipe-proposal-sheet]] — Riquadro di richiesta e sheet di proposta
- [[library-screen]] — `RecipeCard` con `badge` e ★ facoltativa
- [[sheet-primitive]] — Pila delle sheet aperte
- [[toast]] — Dove finiscono i messaggi di `onNotify`
- [[f9-ricette-su-richiesta]] — Panoramica della Feature 9
- [[f8-portate-etichette]] — Feature 8: contorni fuori dalle candidate, badge di portata
- [[f11-composizione-pasto]] — Feature 11: selettore del contorno e candidate per portata
