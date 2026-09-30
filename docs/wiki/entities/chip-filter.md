---
title: Chip Filtro a Pillola (chip-filter)
type: entity
created: 2026-09-15
updated: 2026-09-28
tags: [ui, components, filters, chip-filter, pills, accessibility]
---

## File e Responsabilità

- **Percorso file**: `components/filters/chip-filter.tsx`
- **Scopo**: Componente a forma di pillola per l'applicazione di filtri multi-selezione (esigenze dietetiche, tag di stile pasto, categorie o tempi di preparazione), prevalentemente utilizzato nella libreria ricette (`/libreria`) e nei selettori di vincoli.

## Interfaccia Props (`ChipFilterProps`)

Il componente estende i consueti attributi HTML del tag `<button>`:

```ts
export interface ChipFilterProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;              // Testo del filtro (es. "Vegetariano", "Veloce")
  count?: number;             // Conteggio facoltativo delle ricette corrispondenti
  isSelected?: boolean;       // Stato di attivazione
  icon?: React.ReactNode;     // Icona facoltativa anteposta al testo
}
```

## Dettagli di Design e Comportamento

1. **Geometria e Touch Target**:
   - Geometria a capsula arrotondata (`rounded-full px-4 py-2`).
   - Rispetta il vincolo di altezza minima: `min-h-[44px]`.
2. **Stati Cromatici**:
   - **Selezionato (`isSelected = true`)**: sfondo verde basilico pieno `bg-basil text-paper shadow-xs`. Se presente un contatore numerico, esso assume sfondo semitrasparente chiaro `bg-paper/20 text-paper`.
   - **Non Selezionato**: sfondo bianco caldo, bordo neutro `border border-stone/20 text-stone`, con transizione su hover a `hover:border-stone/40 hover:text-ink`.
3. **Accessibilità Semantica**:
   - Implementa `role="checkbox"` con `aria-checked={isSelected}`, consentendo agli screen reader di comunicare chiaramente lo stato attivo/inattivo all'utente.
   - Anello di focus evidente: `focus-visible:ring-2 focus-visible:ring-basil focus-visible:ring-offset-2`.
   - Micro-interazione al click: `active:scale-95`.

## Esempio d'Uso

```tsx
import { ChipFilter } from '@/components/filters/chip-filter';

<ChipFilter
  label="Veloce"
  count={12}
  isSelected={activeFilters.includes('veloce')}
  onClick={() => toggleFilter('veloce')}
/>
```

## Vedi anche

- [[design-system-and-tokens]] — Palette `basil`, `stone` e principi di tocco
- [[meal-card]] — Tag stile associati ai filtri
- [[settings-fields]] — Riuso nei 4 campi a scelta multipla di wizard e Impostazioni (Feature 3)
- [[e0-fondamenta]] — Panoramica della Feature 1
