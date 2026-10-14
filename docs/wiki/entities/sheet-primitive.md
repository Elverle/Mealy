---
title: Primitiva Sheet — Pannello dal Basso e Pila delle Sheet Aperte (sheet-primitive)
type: entity
created: 2026-10-14
updated: 2026-10-14
tags: [ui, components, sheet, drawer, modal, escape, scroll-lock, dvh, accessibility, feature-9]
---

## File e Responsabilità

- **Percorso file**: `components/ui/sheet.tsx` (`"use client"`)
- **Scopo**: la primitiva dei pannelli modali dell'app, scritta a mano nello stile shadcn/ui: `Sheet`, `SheetTrigger`, `SheetClose`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`. Esisteva dalla Feature 1 senza una pagina propria (era citata come limite in [[recipe-sheet]] e in [[e2-libreria-preferenze]]); la Feature 9 le aggiunge la **pila delle sheet aperte** perché il selettore del Piano apre una seconda sheet sopra la prima ([[f9-ricette-su-richiesta]]).
- **Chi la usa**: `RecipeSheet` ([[recipe-sheet]], quindi anche [[recipe-detail-sheet]] e [[recipe-proposal-sheet]]), `SlotRecipePicker` ([[slot-recipe-picker]]) e `AddShoppingItemSheet` ([[shopping-screen]]).

## Componenti

- **`Sheet`**: fornisce `{ open, setOpen }` tramite contesto. Controllata (`open` + `onOpenChange`) o non controllata (`defaultOpen`); `setOpen` chiama sempre `onOpenChange`.
- **`SheetTrigger`** / **`SheetClose`**: pulsanti che aprono o chiudono la sheet del contesto.
- **`SheetContent`** (`side`: `bottom` di default, `top`, `left`, `right`): con la sheet chiusa non rende nulla. Aperta, rende un contenitore `fixed inset-0 z-50` con lo sfondo `bg-black/40` (`data-testid="sheet-backdrop"`, il clic chiude) e il pannello `role="dialog" aria-modal="true"` (`bg-paper`, `overflow-y-auto`, `max-w-2xl`), con il pulsante ✕ (`aria-label="Chiudi"`, 44 × 44 px) in alto a destra.
- **`SheetHeader`** (`pr-10` per non finire sotto la ✕), **`SheetFooter`**, **`SheetTitle`** (`h2` in `font-display`), **`SheetDescription`**.

Altezze dei lati: `bottom` e `top` hanno `max-h-[90dvh]` (prima della Feature 9 `90vh`: innesto R3 della review architetturale della Feature 9, sulla scia della 0.6.1 che aveva portato le schermate a `dvh`); `left` e `right` sono a tutta altezza. Chi usa la sheet può sovrascrivere l'altezza con `className` (es. `RecipeSheet` usa `max-h-[92dvh]`, il selettore `h-[92dvh] max-h-[92dvh]`).

## Pila delle Sheet Aperte (Feature 9)

Prima della Feature 9 ogni `SheetContent` aperta ascoltava Esc per conto suo e alla chiusura rimetteva `document.body.style.overflow = ""`. Con una sheet alla volta non si notava; con due sheet impilate Esc le avrebbe chiuse entrambe e la chiusura della seconda avrebbe sbloccato lo scorrimento della pagina sotto la prima (requirements P14).

Ora un array a livello di modulo, `openSheets: symbol[]`, tiene le sheet aperte nell'ordine di apertura; ogni `SheetContent` ha un proprio `Symbol("sheet")`.

- **Registrazione**: un effetto che dipende **solo** da `open` (e dall'id) aggiunge la sheet in coda alla pila e imposta `overflow: hidden` sul `body`; la pulizia la toglie e ripristina lo scorrimento **solo** quando la pila è vuota. La dipendenza da `open` soltanto mantiene l'ordine di apertura anche quando chi usa la sheet passa un nuovo `onOpenChange` a ogni render.
- **Esc**: un secondo effetto ascolta `keydown` su `window` e chiude la sheet solo se è **l'ultima della pila**. Con una sola sheet aperta il comportamento è quello di prima.

## Limiti Noti

- **Nessuna gestione del focus**: all'apertura il focus non entra nel pannello e non viene trattenuto; alla chiusura non torna al controllo che l'ha aperta. I componenti della Feature 9 riportano il focus da sé (requirements P22: *Scegli* nella card, pulsante di richiesta o titolo in Libreria); un ripristino generico nella primitiva avrebbe cambiato il comportamento di tutte le sheet esistenti.
- **Nessun portale**: il contenitore `fixed` è reso dove la sheet è montata. Funziona finché nessun antenato crea uno stacking context (`opacity`, `transform`, `filter`). Il selettore del Piano è montato dentro la card e dipende da questa regola ([[slot-recipe-picker]]). La review architetturale della Feature 9 indicava come alternativa robusta `createPortal(…, document.body)` in `SheetContent`, non adottata.
- La pila è globale al modulo: una sheet registrata e mai smontata in modo pulito (non accade nei componenti attuali) lascerebbe lo scorrimento bloccato.

## Test

- `tests/ui/sheet-stack.test.tsx` (Feature 9): con due sheet aperte Esc chiude solo l'ultima; il tasto successivo chiude la precedente; una sola sheet si chiude con Esc come prima; ordine di apertura conservato con un nuovo `onOpenChange` a ogni render; scorrimento bloccato con una sheet aperta e sbloccato alla chiusura; scorrimento ancora bloccato finché resta un'altra sheet; sbloccato chiudendo l'ultima con la ✕.
- Le sheet esistenti sono coperte indirettamente da `tests/ui/{recipe-sheet,recipe-detail-sheet,add-item-sheet,shopping-screen,shell}.test.tsx`.

## Vedi anche

- [[recipe-sheet]] — Dettaglio ricetta costruito sulla primitiva
- [[slot-recipe-picker]] — Tre sheet impilate: elenco, dettaglio, proposta
- [[recipe-proposal-sheet]] — Sheet di proposta che ignora la chiusura durante il salvataggio
- [[shopping-screen]] — `AddShoppingItemSheet`
- [[toast]] — Toast a `z-[60]`, sopra le sheet (`z-50`)
- [[design-system-and-tokens]] — Colori e caratteri usati dal pannello
- [[f9-ricette-su-richiesta]] — Panoramica della Feature 9
