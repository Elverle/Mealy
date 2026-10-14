---
title: Primitiva Sheet — Pannello dal Basso e Pila delle Sheet Aperte (sheet-primitive)
type: entity
created: 2026-10-14
updated: 2026-10-14
tags: [ui, components, sheet, drawer, modal, escape, scroll-lock, dvh, accessibility, focus, portal, feature-9]
---

## File e Responsabilità

- **Percorso file**: `components/ui/sheet.tsx` (`"use client"`)
- **Scopo**: la primitiva dei pannelli modali dell'app, scritta a mano nello stile shadcn/ui: `Sheet`, `SheetTrigger`, `SheetClose`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`. Esisteva dalla Feature 1 senza una pagina propria (era citata come limite in [[recipe-sheet]] e in [[e2-libreria-preferenze]]); la Feature 9 le aggiunge la **pila delle sheet aperte** perché il selettore del Piano apre una seconda sheet sopra la prima ([[f9-ricette-su-richiesta]]).
- **Chi la usa**: `RecipeSheet` ([[recipe-sheet]], quindi anche [[recipe-detail-sheet]] e [[recipe-proposal-sheet]]), `SlotRecipePicker` ([[slot-recipe-picker]]) e `AddShoppingItemSheet` ([[shopping-screen]]).

## Componenti

- **`Sheet`**: fornisce `{ open, setOpen, titleId }` tramite contesto (`titleId` da `useId`). Controllata (`open` + `onOpenChange`) o non controllata (`defaultOpen`); `setOpen` chiama sempre `onOpenChange`.
- **`SheetTrigger`** / **`SheetClose`**: pulsanti che aprono o chiudono la sheet del contesto.
- **`SheetContent`**: solo dal basso (le varianti `top`/`left`/`right` e la prop `side`, mai usate, sono state tolte). Con la sheet chiusa, o lato server, non rende nulla. Aperta, rende **in un portale su `document.body`** un contenitore `fixed inset-0 z-50` (`data-sheet-root`) con lo sfondo `bg-ink/40` (`data-testid="sheet-backdrop"`, il clic chiude) e il pannello `role="dialog" aria-modal="true" aria-labelledby=<titolo>` (`bg-paper`, `max-w-2xl`, `max-h-[92dvh]`, `flex flex-col overflow-hidden`), con la ✕ (`aria-label="Chiudi"`, 44 × 44 px) in alto a destra.
- **Il pannello non scorre**: dentro vanno **`SheetHeader`** (fisso, `pr-16` per la ✕), **`SheetBody`** (`data-sheet-body`, `flex-1 min-h-0 overflow-y-auto overscroll-contain`: l'unica parte che scorre) e, se servono azioni sempre visibili, **`SheetFooter`** (`data-sheet-footer`, `shrink-0`, bordo in alto, `pb-[max(1rem,env(safe-area-inset-bottom))]`). **`SheetTitle`** (`h2` in `font-display`, con l'id del contesto) e **`SheetDescription`** come prima.
- **Movimento**: il pannello sale con `animate-sheet-in` (340 ms, ease-out esponenziale) e lo sfondo compare con `animate-backdrop-in`; con `prefers-reduced-motion` il pannello si limita a una dissolvenza. Le classi sono in `app/globals.css`. Con più sheet impilate (i portali stanno in `body` nell'ordine di apertura) lo sfondo scuro resta uno solo: quelli delle sheet successive sono trasparenti, ma chiudono comunque al clic.

**Dalla revisione UI del 14 ottobre 2026** (critica Impeccable dopo la prova da telefono): prima il pannello era esso stesso il contenitore che scorreva, con `p-6`; il footer `sticky bottom-0` di [[recipe-sheet]] si fermava allora 32 px sopra il bordo (il padding del contenitore), con il testo che scorreva sotto. In più `animate-in slide-in-from-bottom` non era definita (nessun plugin di animazioni installato) e `duration-300` lasciava sul pannello `transition: all 0.3s`, quindi ogni cambio di geometria (barra degli indirizzi del telefono, `dvh`) arrivava in ritardo. La struttura a tre parti e le animazioni definite chiudono entrambi i problemi.

## Pila delle Sheet Aperte (Feature 9)

Prima della Feature 9 ogni `SheetContent` aperta ascoltava Esc per conto suo e alla chiusura rimetteva `document.body.style.overflow = ""`. Con una sheet alla volta non si notava; con due sheet impilate Esc le avrebbe chiuse entrambe e la chiusura della seconda avrebbe sbloccato lo scorrimento della pagina sotto la prima (requirements P14).

Ora un array a livello di modulo, `openSheets: symbol[]`, tiene le sheet aperte nell'ordine di apertura; ogni `SheetContent` ha un proprio `Symbol("sheet")`.

- **Registrazione**: un effetto che dipende **solo** da `open` (e dall'id) aggiunge la sheet in coda alla pila e imposta `overflow: hidden` sul `body`; la pulizia la toglie e ripristina lo scorrimento **solo** quando la pila è vuota. La dipendenza da `open` soltanto mantiene l'ordine di apertura anche quando chi usa la sheet passa un nuovo `onOpenChange` a ogni render.
- **Esc**: un secondo effetto ascolta `keydown` su `window` e chiude la sheet solo se è **l'ultima della pila**. Con una sola sheet aperta il comportamento è quello di prima.

## Focus e Accessibilità

- **Apertura**: il focus entra nel pannello (`tabIndex=-1`). Così su telefono si chiude la tastiera del campo di ricerca che ha aperto la sheet, che prima restava aperta e copriva il fondo del pannello. Un campo con `autoFocus` dentro la sheet (es. `AddShoppingItemSheet`) tiene il suo focus.
- **Tab**: Tab e Maiusc+Tab girano tra i controlli del pannello senza uscire sulla pagina sotto.
- **Chiusura**: il focus torna all'elemento che lo aveva prima dell'apertura, **salvo** che chi chiude l'abbia già spostato altrove (es. la Libreria che porta il focus sul titolo dopo *Aggiungi alla libreria*, requirements P22): il ripristino scatta solo se il focus è finito sul `body` o era nel pannello.
- **Nome**: `aria-labelledby` punta al `SheetTitle`.
- **Portale**: nessun antenato con `opacity`, `transform` o `filter` può più intrappolare il pannello o farlo finire sotto la barra di navigazione; la regola fragile annotata in `plan-screen.tsx` non è più necessaria.

## Tastiera del Telefono

Chrome su Android (dalla 108) e Safari su iOS, quando si apre la tastiera, riducono solo l'area visibile (`window.visualViewport`), non quella su cui si ancora un elemento `fixed bottom-0`: il pannello resterebbe dietro la tastiera. Il browser a volte sposta la vista sul campo col focus, ma non sempre: nella prova da telefono del 14 ottobre 2026, in *Aggiungi alla lista*, dopo *Aggiungi* il focus tornava sul campo da codice e la sheet finiva sotto la tastiera.

`useKeyboardInset` (un `useSyncExternalStore` sugli eventi `resize` e `scroll` di `visualViewport`) calcola lo spazio coperto in basso (`innerHeight − visualViewport.height − offsetTop`). Sopra gli 80 px (sotto è una barra del browser) e senza zoom, il pannello riceve `bottom` pari allo spazio coperto e `maxHeight` pari al 92% dell'area visibile; alla chiusura della tastiera gli stili inline spariscono. Vale per tutte le sheet, compresa la ricerca nel selettore del Piano.

## Limiti Noti

- Lo sfondo della pagina non è `inert`: con `aria-modal` e il Tab confinato basta, e un `inert` sulla radice dell'app avrebbe nascosto agli screen reader anche i toast ([[toast]]), che vivono lì.
- Niente trascinamento per chiudere né maniglia: si chiude con ✕, Esc o lo sfondo.
- La pila è globale al modulo: una sheet registrata e mai smontata in modo pulito (non accade nei componenti attuali) lascerebbe lo scorrimento bloccato.

## Test

- `tests/ui/sheet-stack.test.tsx` (Feature 9): con due sheet aperte Esc chiude solo l'ultima; il tasto successivo chiude la precedente; una sola sheet si chiude con Esc come prima; ordine di apertura conservato con un nuovo `onOpenChange` a ogni render; scorrimento bloccato con una sheet aperta e sbloccato alla chiusura; scorrimento ancora bloccato finché resta un'altra sheet; sbloccato chiudendo l'ultima con la ✕. Dalla revisione UI: pannello in un portale su `body` e con il nome del titolo; focus nel pannello all'apertura; focus restituito alla chiusura; Tab e Maiusc+Tab confinati.
- Le sheet esistenti sono coperte indirettamente da `tests/ui/{recipe-sheet,recipe-detail-sheet,add-item-sheet,shopping-screen,shell}.test.tsx`.

## Vedi anche

- [[recipe-sheet]] — Dettaglio ricetta costruito sulla primitiva
- [[slot-recipe-picker]] — Tre sheet impilate: elenco, dettaglio, proposta
- [[recipe-proposal-sheet]] — Sheet di proposta che ignora la chiusura durante il salvataggio
- [[shopping-screen]] — `AddShoppingItemSheet`
- [[toast]] — Toast a `z-[60]`, sopra le sheet (`z-50`)
- [[design-system-and-tokens]] — Colori e caratteri usati dal pannello
- [[f9-ricette-su-richiesta]] — Panoramica della Feature 9
