---
title: Riga Elemento Spesa (shopping-item-row)
type: entity
created: 2026-09-15
updated: 2026-10-09
tags: [ui, components, shopping, shopping-item-row, grocery, accessibility, feature-6]
---

## File e Responsabilità

- **Percorso file**: `components/shopping/shopping-item-row.tsx`
- **Scopo**: Rappresentare un singolo articolo consolidato nella schermata della lista della spesa (`/lista`). Ottimizzato specificamente per la consultazione e la spunta rapida su smartphone durante gli acquisti al supermercato.
- Il componente è **presentazionale**: non conosce le API né i tipi di dominio. Dalla Feature 6 lo usa la schermata reale ([[shopping-screen]]), che traduce ogni `ShoppingItemView` nel formato della riga (requirements P21), come `toRecipeDetail` fa per [[recipe-sheet]].

## Interfaccia Props (`ShoppingItemRowProps`)

```ts
export interface ShoppingItem {
  id: string;
  name: string;
  amount?: number;
  unit?: string;
  category?: string;
  isChecked: boolean;
  quantityLabel?: string;  // Feature 6: quantità già formattata (es. "1,25 kg"); se definita, anche vuota, sostituisce amount/unit
  detail?: string;         // Feature 6: seconda riga sotto il nome (es. "Per: Pasta al pomodoro")
}

export interface ShoppingItemRowProps {
  item: ShoppingItem;
  onToggle: (id: string) => void;
  className?: string;
  disabled?: boolean;               // Feature 6: sola lettura, la riga non risponde a tap e tastiera
  onRemove?: (id: string) => void;  // Feature 6: se presente, accanto alla riga compare il pulsante di rimozione
}
```

Il tipo locale `ShoppingItem` è quello della riga e non va confuso con gli omonimi di dominio: `ShoppingItem` di `lib/domain/types.ts` (schema entità della Feature 1) e `ShoppingItemView` (vista delle API, Feature 6), descritti in [[domain-types]].

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

## Aggiunte della Feature 6

Tutte **compatibili** con l'interfaccia della Feature 1: senza i campi e le props nuove la riga si comporta come prima (requirements P21; la pagina finta e `tests/ui/shell.test.tsx` dovevano continuare a compilare fino alla sostituzione della pagina).

- **Contenitore esterno**: la riga `role="checkbox"` è ora dentro un `<div className="flex items-center">`, che ospita anche il pulsante di rimozione come **fratello** della riga e non al suo interno. `className` continua ad applicarsi alla riga.
- **`quantityLabel`**: se è definita sostituisce `amount` e `unit`; una stringa vuota (o di soli spazi) nasconde del tutto la quantità, anche se `amount` è valorizzato. È il caso degli articoli a mano, che non hanno quantità.
- **`detail`**: seconda riga in piccolo sotto il nome (`text-xs text-stone`, troncata), mostrata solo se non è vuota. La schermata ci mette `Per: …` con le ricette per cui l'articolo serve, oppure `Aggiunto a mano`.
- **`disabled`**: la riga espone `aria-disabled="true"`, perde il cursore a puntatore e l'effetto hover, e ignora clic, `Space` ed `Enter` (di questi due si impedisce comunque l'azione di default). Resta raggiungibile con il tasto Tab. Serve alle liste dei piani chiusi, in sola lettura.
- **`onRemove`**: aggiunge a destra un pulsante 44×44 px con l'icona `X` e `aria-label="Rimuovi {nome}"`; il clic chiama `onRemove(item.id)` e **non** `onToggle`. La schermata lo passa solo per gli articoli a mano di una lista modificabile.
- Focus visibile sulla riga e sul pulsante (`focus-visible:ring-2 focus-visible:ring-basil`).

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

Uso della Feature 6, con quantità formattata, seconda riga e rimozione:

```tsx
<ShoppingItemRow
  item={{ id: item.id, name: 'Latte', isChecked: false, quantityLabel: '', detail: 'Aggiunto a mano' }}
  onToggle={handleToggle}
  disabled={!view.editable}
  onRemove={(id) => void handleRemove(id)}
/>
```

## Test

- `tests/ui/shopping-item-row.test.tsx` (Feature 6): comportamento originale senza i campi nuovi; `quantityLabel` al posto di `amount` e `unit`, e nessuna quantità con etichetta vuota; seconda riga presente o assente; riga disabilitata che espone `aria-disabled` e ignora clic, `Space` ed `Enter`; pulsante di rimozione che chiama `onRemove` e non `onToggle`; `Enter` e `Space`.
- `tests/ui/shell.test.tsx`: il blocco "ShoppingItemRow" della Feature 1 (ruolo `checkbox`, classe `min-h-[52px]`) non è stato modificato dalla feature e continua a valere con il contenitore in più.

## Vedi anche

- [[shopping-screen]] — Schermata che usa la riga e ne costruisce i dati (Feature 6)
- [[shopping-list]] — `formatShoppingQuantity` e `shoppingItemLabel`, origine di quantità e nome mostrati
- [[domain-types]] — Struttura schema `ShoppingItemSchema` e vista `ShoppingItemViewSchema`
- [[database-schema]] — Tabella `shopping_items` in PostgreSQL
- [[design-system-and-tokens]] — Standard di touch target e palette colori
- [[e0-fondamenta]] — Panoramica della Feature 1
- [[e4-lista-spesa]] — Panoramica della Feature 6
