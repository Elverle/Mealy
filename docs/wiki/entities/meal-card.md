---
title: Scheda Pasto (meal-card)
type: entity
created: 2026-09-15
updated: 2026-10-14
tags: [ui, components, meal-card, cards, planner, long-press, accessibility, manual-choice]
---

## File e Responsabilità

- **Percorso file**: `components/cards/meal-card.tsx`
- **Scopo**: Rappresentare visivamente un pasto pianificato all'interno della vista settimanale (`/`). Consente all'utente di ispezionare il pasto, bloccarlo contro le rigenerazioni, contrassegnarlo come preferito o richiederne la sostituzione ("Cambia").
- **Uso reale dalla Feature 4**: la pagina Piano la usa tramite `PlanSlotCard` ([[plan-screen]]), che passa gli handler solo quando l'azione è davvero disponibile. Le modifiche della Feature 4 sono **retrocompatibili**: i test dei blocchi "MealCard" di `tests/ui/shell.test.tsx` passano senza modifiche.

## Interfaccia Props (`MealCardProps`)

```ts
export interface MealCardProps {
  id: string;
  day: string;                    // es. "Lunedì" (la pagina Piano passa solo il nome del giorno)
  mealType: string;               // es. "Pranzo" | "Cena"
  title: string;                  // Nome della ricetta
  prepTimeMinutes?: number;       // Minuti stimati
  tags?: string[];                // Tag stile o dieta (es. "Veloce", "Vegetariano")
  isFavorite?: boolean;           // Stato stella preferita
  isLocked?: boolean;             // Stato lucchetto slot
  onToggleFavorite?: (id: string) => void;
  onSwap?: (id: string) => void;
  onPick?: (id: string) => void;       // Feature 9: apre la scelta dalla libreria; assente → nessun «Scegli»
  onToggleLock?: (id: string) => void;
  onSelect?: (id: string) => void;
  onLongPress?: (id: string) => void;  // Feature 4
  actions?: React.ReactNode;           // Feature 4: sostituisce l'intero footer
  className?: string;
}

export const LONG_PRESS_MS = 500;
```

## Struttura e Layout Visivo

Il `Card` radice espone `data-testid="meal-card-<id>"`. La card è suddivisa in tre zone:

1. **Header Eyebrow & Lock Control**:
   - Eyebrow in maiuscoletto (`text-xs font-bold uppercase tracking-wider text-stone`): es. `LUNEDÌ · PRANZO`.
   - Pulsante Lucchetto (44×44px), **solo se `onToggleLock` è definito**: icona `Lock` (bloccato, colore `text-basil`) o `Unlock` (sbloccato, opacità attenuata).
   - Quando `isLocked` è attivo, l'intera card evidenzia un sottile bordo basil (`border-basil/40 bg-basil/[0.02]`).
2. **Corpo Principale Interattivo (`onSelect`)**:
   - Area interamente cliccabile con supporto tastiera (`Enter` / `Space`) per aprire il pannello di dettaglio della ricetta ([[recipe-sheet]]).
   - Titolo renderizzato con font display `Fraunces` (`font-display text-lg font-bold text-ink`) con transizione hover verso `text-basil`.
   - Badge compatti: badge tempo di preparazione con icona `Clock` e badge outline per ciascun tag.
3. **Footer Azioni** (`mt-3 flex items-center justify-between border-t border-stone/15 pt-2`), renderizzato **solo** se c'è almeno uno tra `actions`, `onSwap`, `onToggleFavorite`:
   - con `actions` il footer contiene solo quel nodo (usato da `PlanSlotCard` per il messaggio di attesa dello swap e per i pulsanti *Tieni* / *Cambia ancora*);
   - altrimenti:
     - **Pulsante "Cambia" (`onSwap`)**, solo se `onSwap` è definito: icona `RefreshCw` con etichetta, colore `text-tomato hover:bg-tomato/10`, tap target ≥ 44px, disabilitato se `isLocked`;
     - **Pulsante Preferito (`onToggleFavorite`)**, solo se `onToggleFavorite` è definito: icona `Star` (44×44px, allineata a destra con `ml-auto`), riempita `fill-saffron text-saffron` se attiva, contorno `text-stone hover:text-saffron` se inattiva.

Fino alla Feature 3 *Cambia* e ★ erano sempre visibili (con handler opzionali che non facevano nulla). Dalla Feature 4 compaiono solo con un handler: una card di sola lettura (settimana passata) non mostra *Cambia* né lucchetto, e nella Feature 4 la ★ restava sempre nascosta (requirements U4; proposta R5 della review architetturale per *Cambia*).

Dalla Feature 5 `PlanSlotCard` passa `isFavorite` e `onToggleFavorite`, quindi la ★ compare su ogni card la cui ricetta esiste e non è bloccata, **anche nelle settimane passate** (il giudizio riguarda la ricetta, non il piano). Il componente `MealCard` non è stato modificato: è cambiato solo chi lo configura ([[plan-screen]]).

### Pulsante *Scegli* (Feature 9)
Dalla Feature 9 il footer si rende con almeno uno tra `actions`, `onSwap`, `onPick`, `onToggleFavorite`, e senza `actions` le azioni sono tre, nell'ordine *Cambia* · *Scegli* · ★ (decisione U2 della Feature 9, `DESIGN.md §3`): *Cambia* e *Scegli* stanno in un gruppo a sinistra (`flex items-center gap-1`), la ★ resta a destra.
- **Pulsante "Scegli" (`onPick`)**, solo se `onPick` è definito: icona `Search` (lente, `aria-hidden`) con etichetta `Scegli`, colore neutro `text-ink hover:bg-stone/15` (*Cambia* resta in `tomato`), anello di focus `basil`, tap target ≥ 44 px, `aria-label` `` `Scegli un'altra ricetta per ${title}` ``, attributo `data-slot-action="pick"` (lo usa `PlanSlotCard` per riportarci il focus), disabilitato se `isLocked` come *Cambia*. Il clic chiama `onPick(id)` con `stopPropagation`, quindi non apre il dettaglio.
- Con `actions` il footer resta sostituito per intero: durante lo swap *Scegli* non compare; nella riga *Tieni / Cambia ancora* l'azione equivalente è il pulsante con la sola icona che `PlanSlotCard` mette tra i due ([[plan-screen]]).
- `PlanSlotCard` passa `onPick` esattamente quando passa `onSwap` (piano modificabile, giorno non passato), anche su uno slot senza ricetta.

Le tre azioni a 360 px occupano circa 240 px dei 296 disponibili secondo la stima della review architetturale; la prova da telefono non è ancora stata fatta ([[f9-ricette-su-richiesta]]).

## Long-press (Feature 4)

Attivo solo se `onLongPress` è definito; la pagina Piano lo usa per bloccare/sbloccare lo slot (il lucchetto resta l'alternativa accessibile da tastiera e lettori di schermo).

- `pointerdown` con il tasto primario sul **corpo** della card avvia un timer di `LONG_PRESS_MS` (500 ms); un `pointerdown` che parte da un pulsante interno (lucchetto, *Cambia*, ★) viene ignorato, così tenere premuto il lucchetto non blocca e poi sblocca (proposta R5).
- Spostamento oltre 10 px, `pointerup`, `pointerleave` o `pointercancel` annullano il timer; il timer si ripulisce allo smontaggio.
- Allo scadere: `onLongPress(id)`, vibrazione di 10 ms (`navigator.vibrate?.(10)`) e soppressione del click successivo sul corpo, che quindi non apre la sheet.
- Con `onLongPress` il `Card` riceve anche `select-none`, `WebkitTouchCallout: 'none'` e `onContextMenu` con `preventDefault()`, per evitare selezione del testo e menu contestuale su mobile.

## Accessibilità e Micro-interazioni

- Tutti i pulsanti secondari sfruttano `e.stopPropagation()` per impedire l'attivazione involontaria del click sul corpo della card (`onSelect`).
- I pulsanti offrono stati `aria-pressed` e `aria-label` descrittivi (es. `Cambia Pasta al Pomodoro`, `Blocca pasto` / `Sblocca pasto`, `Aggiungi ai preferiti`).
- Durante lo swap `PlanSlotCard` sposta il focus sui pulsanti che sostituiscono *Cambia* e poi di nuovo su *Cambia* ([[plan-screen]]).

## Test

- Blocchi "MealCard" di `tests/ui/shell.test.tsx` (Feature 1), invariati.
- `tests/ui/meal-card-plan.test.tsx` (Feature 4, fake timers): `data-testid`, nessuna ★ senza `onToggleFavorite`, nessun *Cambia* senza `onSwap`, nessun footer senza handler né `actions`, `actions` che sostituiscono il footer, long-press con soppressione del click, pressione breve, tolleranza di movimento, tasti non primari, `pointerdown` sul lucchetto, pulizia allo smontaggio. Dalla Feature 9 il blocco `MealCard (pick action "Scegli")`: `aria-label` e `onPick` con l'id senza `onSelect`, nessun *Scegli* senza `onPick`, disabilitato sul pasto bloccato, footer con il solo `onPick`, ordine *Cambia* · *Scegli* · ★, classe dei 44 px, `actions` che nascondono *Scegli*.

## Vedi anche

- [[plan-screen]] — `PlanSlotCard`, che configura la card nella pagina Piano
- [[recipe-sheet]] — Pannello modale aperto dalla card per i dettagli e i dosaggi
- [[design-system-and-tokens]] — Palette colori `tomato`, `saffron`, `basil` e font `Fraunces`
- [[e0-fondamenta]] — Panoramica della Feature 1
- [[e3-pianificatore]] — Panoramica della Feature 4
- [[e2-libreria-preferenze]] — Feature 5: ★ attiva sulle card del piano
- [[slot-recipe-picker]] — Selettore aperto da *Scegli* (Feature 9)
- [[f9-ricette-su-richiesta]] — Panoramica della Feature 9
