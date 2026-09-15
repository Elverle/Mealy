---
title: Riga Elemento Spesa (shopping-item-row)
type: entity
created: 2026-09-15
updated: 2026-09-15
tags: [ui, components, shopping, shopping-item-row, grocery, accessibility]
---

## File e Responsabilità

- **Percorso file**: `components/shopping/shopping-item-row.tsx`
- **Scopo**: Rappresentare un singolo articolo consolidato nella schermata della lista della spesa (`/lista`). Ottimizzato specificamente per la consultazione e la spunta rapida su smartphone durante gli acquisti al supermercato.

## Interfaccia Props (`ShoppingItemRowProps`)

```ts
export interface ShoppingItem {
  id: string;
  name: string;
  amount?: number;
  unit?: string;
  category?: string;
  isChecked: boolean;
}

export interface ShoppingItemRowProps {
  item: ShoppingItem;
  onToggle: (id: string) => void;
  className?: string;
}
```

## Ergonomia e Accessibilità

1. **Intera Riga Interattiva (`role="checkbox"`)**:
   - L'utente non è costretto a mirare con precisione la minuscola casella di controllo: l'intera riga funge da bersaglio tattile, attivando `onToggle(item.id)` al tocco in qualsiasi punto.
   - Altezza generosa: `min-h-[52px]`, superando ampiamente i 44px standard per facilitare l'uso mentre si cammina o si spinge il carrello.
2. **Supporto da Tastiera e Screen Reader**:
   - Fornisce `tabIndex={0}`, attributo `aria-checked={item.isChecked}` e gestore `onKeyDown` per i tasti `Space` e `Enter`.
3. **Feedback Visivo di Spunta**:
   - **Casella Checkbox**: contenitore 44×44px (`h-11 w-11`) con indicatore interno da 20×20px. Quando spuntato, assume sfondo pieno `bg-basil text-paper` con icona di spunta ad alto spessore (`stroke-[3]`).
   - **Stato Spuntato**: il testo del prodotto e il dosaggio assumono stile barrato (`line-through text-stone`) e l'intera riga si attenua (`opacity-60`), consentendo all'utente di focalizzarsi immediatamente sugli ingredienti rimanenti.
4. **Allineamento Quantità**:
   - Il dosaggio e l'unità di misura sono posizionati a destra con formattazione numerica fissa (`tabular-nums font-semibold text-stone`).

## Esempio d'Uso

```tsx
import { ShoppingItemRow } from '@/components/shopping/shopping-item-row';

<ShoppingItemRow
  item={{
    id: 'item-1',
    name: 'Spaghetti trafilati al bronzo',
    amount: 500,
    unit: 'g',
    category: 'dispensa',
    isChecked: false,
  }}
  onToggle={(id) => handleToggleItem(id)}
/>
```

## Vedi anche

- [[domain-types]] — Struttura schema `ShoppingItemSchema`
- [[database-schema]] — Tabella `shopping_items` in PostgreSQL
- [[design-system-and-tokens]] — Standard di touch target e palette colori
- [[e0-fondamenta]] — Panoramica della Feature 1
