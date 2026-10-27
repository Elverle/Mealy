---
title: Riga del Contorno nella Card del Pasto (side-dish-row)
type: entity
created: 2026-10-27
updated: 2026-10-27
tags: [ui, components, plan, side-dish, meal-card, accessibility, feature-11]
---

## File e Responsabilità

- **Percorso file**: `components/plan/side-dish-row.tsx` (`"use client"`, nuovo nella Feature 11).
- **Scopo**: mostrare il **contorno** di un pasto dentro la stessa card del principale (decisione U1 della Feature 11, `DESIGN.md §3`): eyebrow «Contorno», titolo della ricetta e tre azioni a icona. Il componente è presentazionale: non chiama API e non decide quali azioni sono permesse.
- **Chi lo monta**: `PlanSlotCard` ([[plan-screen]]), che lo passa a [[meal-card]] nella prop `extra`; `MealCard` lo rende sotto il footer, dopo un divisore tratteggiato (`border-t border-dashed border-stone/25`).

## Interfaccia

```ts
export interface SideDishRowProps {
  title: string;
  onOpen?: () => void;              // tap sul titolo: dettaglio. Assente → titolo non interattivo
  onSwap?: () => void;              // assenti → nessun pulsante (riga di sola lettura)
  onPick?: () => void;
  onRemove?: () => void;
  disabled?: boolean;               // azione in corso altrove nella card
  pendingMessage?: string | null;   // se presente, al posto di titolo e pulsanti
}
```

## Struttura

- Eyebrow `Contorno` (`text-xs font-bold uppercase tracking-wider text-stone`, come `LUN · CENA`).
- In attesa (`pendingMessage`): un `<p role="status">` alto 44 px con il messaggio, al posto di titolo e pulsanti. `PlanSlotCard` passa «Cerco un contorno…» durante *Cambia contorno* e «Tolgo il contorno…» durante la rimozione; l'attesa dell'aggiunta la mostra la card al posto del pulsante «+ Contorno», perché la riga non esiste ancora.
- Altrimenti una riga sola con:
  - il titolo: un `<button>` con `onOpen` (`min-h-[44px]`, troncato, colore `basil` al passaggio), oppure uno `<span>` senza;
  - fino a tre pulsanti da 44 × 44 px, ciascuno solo se ha la sua callback, nell'ordine ⟳ `RefreshCw` (*Cambia contorno*, `tomato`), lente `Search` (*Scegli contorno*, neutro), ✕ `X` (*Togli contorno*, `stone`).
- `aria-label` con il titolo del contorno: `Cambia contorno: ${title}`, `Scegli contorno: ${title}`, `Togli contorno: ${title}`. Attributi `data-side-action="swap" | "pick" | "remove"`: li usa `PlanSlotCard` per riportare il focus sull'azione dopo l'aggiornamento (selettori `sideSwap`, `sidePick`, `sideRemove` di `FOCUS_SELECTORS`). Le icone sono `aria-hidden`.
- Ogni pulsante chiama la sua callback con `stopPropagation`: il clic non arriva al corpo della card, che aprirebbe il dettaglio del principale.
- `disabled` disattiva i tre pulsanti (`disabled:pointer-events-none disabled:opacity-40`), non il titolo: il dettaglio resta apribile.

## Come lo Configura `PlanSlotCard`

| Situazione | Callback passate | `disabled` |
|---|---|---|
| Piano modificabile, giorno non passato, pasto non bloccato (`canEditDishes`) | `onOpen` (se la ricetta esiste), `onSwap`, `onPick`, `onRemove` | `true` se un'azione è in corso sul pasto (`busy`) o la card è in revisione dopo uno swap del principale |
| Pasto bloccato, giorno passato o piano non modificabile | solo `onOpen` | — |
| Ricetta del contorno eliminata | nessun `onOpen`; titolo «Ricetta non disponibile» | come sopra |

La ★ del contorno si mette dal dettaglio, non dalla riga (spec FR-4.2).

## Test

`tests/ui/side-dish-row.test.tsx` (jsdom): eyebrow e titolo; `aria-label` delle tre azioni con il titolo; nessun pulsante senza callback e titolo non interattivo senza `onOpen`; solo le azioni con callback; tre azioni disattivate con `disabled`; messaggio di attesa al posto di titolo e azioni, e ritorno del titolo; tap sul titolo e su ogni azione; nessun clic che arriva al genitore; tap target da 44 px e titolo troncato; titolo e azioni sulla stessa riga. Il comportamento nella card (riga presente o assente, sola lettura, focus, attese) è in `tests/ui/plan-slot-card.test.tsx` ([[plan-screen]]).

## Vedi anche

- [[plan-screen]] — `PlanSlotCard`, che monta la riga e gestisce azioni e focus
- [[meal-card]] — Prop `extra`, dove finisce la riga
- [[slot-recipe-picker]] — Selettore aperto da *Scegli contorno*
- [[f11-composizione-pasto]] — Panoramica della Feature 11
- [[design-system-and-tokens]] — Colori `tomato`, `basil`, `stone`
