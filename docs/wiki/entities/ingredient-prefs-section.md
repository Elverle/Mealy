---
title: Sezione "I miei ingredienti" (ingredient-prefs-section)
type: entity
created: 2026-10-05
updated: 2026-10-05
tags: [ui, components, settings, ingredient-prefs, optimistic-update, focus-management, accessibility, live-region, feature-5]
---

## File e Responsabilità

- **Percorso file**: `components/settings/ingredient-prefs-section.tsx` (`"use client"`)
- **Scopo**: la vista d'insieme dei giudizi sugli ingredienti nella pagina `/impostazioni`: due liste (graditi e scartati) con l'impatto di ogni voce e la rimozione a un tap. Sostituisce il segnaposto `IngredientPrefsPlaceholder` della Feature 3, eliminato.
- I giudizi **nascono solo dalle ricette** ([[recipe-detail-sheet]]): da qui si possono soltanto rimuovere. Non c'è aggiunta di ingredienti né ricerca.
- È montata da [[settings-editor]] in fondo alla pagina, **fuori** dal `fieldset` dei vincoli: non partecipa a *Salva* e una rimozione non mostra il banner dei vincoli.

## Interfaccia

```ts
export interface IngredientPrefsSectionProps {
  initialPrefs: IngredientPrefsView;   // { likes, dislikes }, già in ordine alfabetico
}
```

I dati arrivano dalla pagina server (`listIngredientPrefs()`, [[prefs-service]]); il componente non chiama `GET /api/ingredient-prefs`. Se `initialPrefs` cambia identità (per esempio dopo `router.refresh()`), lo stato si riallinea durante il render.

## Render

- `Card` con `h2` `I miei ingredienti`.
- **Entrambe le liste vuote**: solo la frase `Qui ritroverai gli ingredienti che segni con 👍 o 👎 nelle ricette.` (lo stesso testo del vecchio segnaposto).
- **Altrimenti** due gruppi con `h3`: `Mi piacciono` e `Scartati`. Un gruppo vuoto mostra `Nessuno per ora.`. Ogni voce è una riga alta almeno 44 px con:
  - il nome canonico con l'iniziale maiuscola;
  - il conteggio in `tabular-nums`, omesso a zero: `in 1 ricetta` / `in N ricette` per i graditi, `esclude 1 ricetta` / `esclude N ricette` per gli scartati;
  - un pulsante con icona `X` e `aria-label` `Rimuovi {nome}`, disabilitato mentre quella voce è in rimozione.
- Un `<p aria-live="polite" className="sr-only">` sempre montato per gli annunci e, in caso d'errore, un `<p role="alert">`.

## Rimozione a un Tap

Nessuna conferma e nessun annulla, per decisione di planning (requirements P15; da rivalutare nel test da telefono di fine v1):

1. la voce sparisce subito dalla lista e l'errore precedente si azzera;
2. `putIngredientPref(nome, null)`;
3. **successo**: annuncio `{nome} rimosso.` nella live region;
4. **errore**: la voce torna nella sua lista, riordinata con `localeCompare(…, 'it')`, e compare `Non sono riuscito a rimuovere {nome}. Riprova.`.

La rimozione vale dalla selezione successiva: l'ingrediente torna proponibile senza modificare i piani esistenti.

### Focus dopo una rimozione
La riga con il pulsante focalizzato sparisce, quindi il focus verrebbe perso su `body`. Il componente lo sposta (fix della code review):
- sul pulsante `Rimuovi` della voce **successiva**, o della precedente se quella rimossa era l'ultima;
- sul titolo del gruppo se la lista si svuota ma l'altra ha ancora voci;
- sul titolo della sezione se non resta nessuna voce.

I titoli sono focalizzabili da codice (`tabIndex={-1}`). Se la rimozione fallisce e il focus è ancora dentro la sezione (o perso), torna sul pulsante della voce ripristinata.

## Test

`tests/ui/ingredient-prefs-section.test.tsx` (jsdom, `@/lib/prefs/client` mockato): liste vuote, due gruppi con i nomi in maiuscola, le quattro forme del conteggio e l'omissione a zero, gruppo vuoto, rimozione immediata con `putIngredientPref(nome, null)`, ripristino in ordine con `role="alert"`, errore azzerato alla rimozione successiva, nuova prop `initialPrefs`, i quattro casi di spostamento del focus, focus sulla voce ripristinata dopo un errore, annuncio nella live region.

`tests/ui/settings-editor.test.tsx` verifica che uno scarto passato con `initialIngredientPrefs` compaia sotto `Scartati` e che *Salva* resti disabilitato.

## Vedi anche

- [[settings-editor]] — Form delle Impostazioni che monta la sezione
- [[prefs-service]] — `listIngredientPrefs`, `putIngredientPref` e conteggio d'impatto
- [[recipe-detail-sheet]] — Dove si esprimono 👍 e 👎
- [[e2-libreria-preferenze]] — Panoramica della Feature 5
- [[e5-impostazioni]] — Feature 3: la pagina Impostazioni e il segnaposto originario
