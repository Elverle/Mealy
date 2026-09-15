---
title: Scheda Pasto (meal-card)
type: entity
created: 2026-09-15
updated: 2026-09-15
tags: [ui, components, meal-card, cards, planner]
---

## File e Responsabilità

- **Percorso file**: `components/cards/meal-card.tsx`
- **Scopo**: Rappresentare visivamente un pasto pianificato all'interno della vista settimanale (`/`). Consente all'utente di ispezionare il pasto, bloccarlo contro rigenerazioni casuali, contrassegnarlo come preferito o richiederne la sostituzione ("Cambia").

## Interfaccia Props (`MealCardProps`)

```ts
export interface MealCardProps {
  id: string;
  day: string;                    // es. "Lunedì 15"
  mealType: string;               // es. "pranzo" | "cena"
  title: string;                  // Nome della ricetta
  prepTimeMinutes?: number;       // Minuti stimati
  tags?: string[];                // Tag stile o dieta (es. "veloce", "vegetariano")
  isFavorite?: boolean;           // Stato stella preferita
  isLocked?: boolean;             // Stato lucchetto slot
  onToggleFavorite?: (id: string) => void;
  onSwap?: (id: string) => void;
  onToggleLock?: (id: string) => void;
  onSelect?: (id: string) => void;
  className?: string;
}
```

## Struttura e Layout Visivo

La card è suddivisa in tre zone funzionali ben distinte:

1. **Header Eyebrow & Lock Control**:
   - Eyebrow in maiuscoletto (`text-xs font-bold uppercase tracking-wider text-stone`): es. `LUNEDÌ 15 · PRANZO`.
   - Pulsante Lucchetto (44×44px): icona `Lock` (bloccato, colore `text-basil`) o `Unlock` (sbloccato, opacità attenuata).
   - Quando `isLocked` è attivo, l'intera card evidenzia un sottile bordo basil (`border-basil/40 bg-basil/[0.02]`).
2. **Corpo Principale Interattivo (`onSelect`)**:
   - Area interamente cliccabile con supporto tastiera (`Enter` / `Space`) per aprire il pannello di dettaglio della ricetta ([[recipe-sheet]]).
   - Titolo renderizzato con font display `Fraunces` (`font-display text-lg font-bold text-ink`) con transizione hover verso `text-basil`.
   - Badge compatti: badge tempo di preparazione con icona `Clock` e badge outline per ciascun tag di stile pasto.
3. **Footer Azioni Dirette**:
   - **Pulsante "Cambia" (`onSwap`)**:
     - Icona `RefreshCw` con etichetta testuale;
     - Colore semantico distruttivo/modifica `text-tomato hover:bg-tomato/10`;
     - Tap target ≥ 44px;
     - Disabilitato automaticamente se lo slot è bloccato (`isLocked = true`).
   - **Pulsante Preferito (`onToggleFavorite`)**:
     - Icona `Star` (44×44px);
     - Se attiva: riempimento pieno `fill-saffron text-saffron`;
     - Se inattiva: contorno neutro `text-stone hover:text-saffron`.

## Accessibilità e Micro-interazioni

- Tutti i pulsanti secondari sfruttano `e.stopPropagation()` per impedire l'attivazione involontaria del click sul corpo della card (`onSelect`).
- I pulsanti offrono stati `aria-pressed` e `aria-label` descrittivi (es. `Cambia Pasta al Pomodoro`).

## Vedi anche

- [[recipe-sheet]] — Pannello modale aperto dalla card per i dettagli e i dosaggi
- [[design-system-and-tokens]] — Palette colori `tomato`, `saffron`, `basil` e font `Fraunces`
- [[e0-fondamenta]] — Panoramica della Feature 1
