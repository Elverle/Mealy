---
title: Schermata Lista — ShoppingScreen e AddShoppingItemSheet (shopping-screen)
type: entity
created: 2026-10-09
updated: 2026-10-09
tags: [ui, components, shopping-list, page, check-queue, optimistic-ui, manual-items, accessibility, feature-6]
---

## File e Responsabilità

- **Percorsi file**:
  - `app/(app)/lista/page.tsx`: pagina server `/lista`. Sostituisce la pagina con dati finti (`INITIAL_SHOPPING_ITEMS`) della Feature 1.
  - `app/(app)/lista/loading.tsx`: scheletro mostrato da Next mentre la pagina server carica.
  - `components/shopping/shopping-screen.tsx`: componente client `ShoppingScreen` (intestazione, selettore di settimana, avvisi, avanzamento, sezioni per reparto, pulsante *Aggiungi*, toast).
  - `components/shopping/add-item-sheet.tsx`: componente client `AddShoppingItemSheet`, il pannello per aggiungere un articolo a mano.
  - `components/shopping/shopping-item-row.tsx`: la riga dell'articolo, documentata in [[shopping-item-row]].
- **Scopo**: fare la spesa con il telefono in mano: spuntare con un tocco sull'intera riga, vedere cosa manca reparto per reparto, aggiungere ciò che il piano non prevede, riallineare la lista quando il piano cambia.
- I componenti importano dal dominio solo codice sicuro per il client: `lib/domain/shopping-list.ts` (funzioni pure, [[shopping-list]]), `lib/shopping/client.ts` e `lib/shopping/check-queue.ts` ([[shopping-service]], [[check-queue]]), `lib/http/client.ts` ([[http-helpers]]) e `lib/plans/format.ts` per `formatWeekRange`; mai `lib/shopping/service.ts`.

## Pagina Server (`app/(app)/lista/page.tsx`)

```tsx
export default async function ShoppingListPage({ searchParams }: { searchParams: Promise<{ piano?: string | string[] }> }) {
  await connection();
  const { piano } = await searchParams;
  const planId = Array.isArray(piano) ? piano[0] : piano;
  const screen = await getShoppingScreen({ planId });
  return <ShoppingScreen key={screen.selected?.plan.id ?? "none"} initialScreen={screen} />;
}
```

Stesso schema di Piano, Libreria e Impostazioni (requirements P20). Il parametro `?piano=<id>` sceglie il piano; se è ripetuto vale il primo valore, se manca o non è valido decide il servizio (regola U4, [[shopping-service]]). La `key` sul piano mostrato azzera lo stato locale **e la coda delle spunte** quando si cambia piano; senza piano vale `"none"`. La guardia di onboarding resta nel layout del gruppo ([[onboarding-guard]]).

`loading.tsx` rende `<main aria-busy="true">` con il titolo `Lista della Spesa` e 8 righe `animate-pulse motion-reduce:animate-none`.

## `ShoppingScreen`

```ts
export interface ShoppingScreenProps {
  initialScreen: ShoppingScreenView;
}
```

Stato: `view` (`PlanShoppingListView | null`, il piano mostrato con la sua lista), `queueState` (spunte in sospeso e `stalled`), `toast`, `isBuilding`, `confirmingRebuild`, `addOpen`. Se arriva un nuovo `initialScreen` con la stessa `key` (es. dopo `router.refresh()`), `view` si riallinea durante il render. Quattro ref: `mountedRef`, `queueRef`, `refreshRef` (l'ultima versione di `refresh`) e `mutationSeqRef`.

Gli articoli a schermo sono quelli del server con sopra le spunte ancora in coda (`withPending`); da lì `groupShoppingItems` produce le sezioni e `shoppingProgress` l'avanzamento.

### Struttura (dall'alto)
1. Intestazione: titolo `Lista della Spesa`, sottotitolo `Settimana {intervallo}` (`Consolidata dal piano settimanale` senza piano) e, a destra, *Aggiorna lista* (`RefreshCw`) solo se la lista esiste, `can_build` è vero e la lista **non** è da aggiornare.
2. **Selettore di settimana** (`<nav aria-label="Liste della spesa">`), solo se `initialScreen.plans` ha almeno due piani: un `Link` a `/lista?piano={id}` per piano, con l'intervallo della settimana e `aria-current="page"` su quello mostrato; tap target 44 px.
3. Corpo, secondo lo stato:

| Stato | Cosa si vede |
|---|---|
| Nessun piano (`view === null`) | [[empty-state]] `Nessuna lista della spesa` / `Conferma il piano della settimana: da lì crei la lista con un tocco.`, azione `Vai al piano` |
| Piano confermato senza lista (`can_build`) | `Lista da creare` / `Raccolgo gli ingredienti del piano {intervallo} e li ordino per reparto.` e, sotto il componente, il pulsante `Crea lista della spesa` (durante la creazione disabilitato, con `Creo la lista…`) |
| Bozza richiesta con `?piano=` | `Piano non ancora confermato` / `Conferma il piano per creare la lista della spesa.`, azione `Vai al piano` verso `/?settimana={week_start}` |
| Piano chiuso senza lista | `Nessuna lista per questa settimana` / `Questa settimana è conclusa e non aveva una lista.`, senza azioni |
| Lista presente | avvisi, avanzamento, sezioni (v. sotto) |

Con una lista presente, nell'ordine:
- avviso di sola lettura (`Questa settimana è conclusa: la lista si può solo consultare.`) se il piano è chiuso;
- avviso `Il piano è cambiato: aggiorna la lista per allinearla.` con il pulsante *Aggiorna lista*, se `needs_regeneration` e `can_build`. In questo stato il pulsante dell'intestazione non c'è: *Aggiorna lista* compare sempre una volta sola;
- riquadro di conferma dell'aggiornamento, con `Aggiorna` e `Annulla` (mai `window.confirm`);
- avviso `N spunte in attesa di rete` (`1 spunta in attesa di rete` al singolare) dentro un `role="status"` **sempre montato** e vuoto a riposo, perché una live region che compare già piena è annunciata male;
- riquadro `Progresso spesa` con `spuntati/totale` e un `role="progressbar"` (`aria-label="Articoli presi"`), solo se la lista ha articoli;
- `Niente da comprare per i pasti che restano.` se la lista è vuota;
- una `<section>` per reparto con l'etichetta, il conteggio `spuntati/totale` della sezione e le [[shopping-item-row]];
- `Hai preso tutto.` quando tutti gli articoli sono spuntati;
- pulsante flottante `Aggiungi` (`aria-label="Aggiungi un articolo alla lista"`) sopra la tab bar, solo con una lista modificabile, e il pannello di aggiunta.

4. [[toast]], alzato sopra il pulsante flottante quando è visibile.

Ogni riga riceve il nome con l'iniziale maiuscola (`shoppingItemLabel`), la quantità formattata (`formatShoppingQuantity`) e una seconda riga: `Aggiunto a mano` per gli articoli a mano, altrimenti `Per: Titolo A, Titolo B` con i titoli delle ricette ancora esistenti (requirements P10: la tracciabilità è sempre visibile, il tocco resta la spunta). Il pulsante ✕ compare solo sugli articoli a mano di una lista modificabile.

### Spunte e coda

La coda si crea in un effetto legato al piano mostrato (sul server `localStorage` non esiste) con `createLocalCheckStorage(planId)`:
- **tocco su una riga**: `enqueue(id, !checked)` sul valore mostrato in quel momento; nulla su una lista in sola lettura. La riga cambia subito, perché `onChange` aggiorna `queueState`;
- **`send`**: `patchShoppingItem(itemId, checked, signal)`; alla risposta l'articolo salvato sostituisce quello in `view`;
- **risposta 2xx illeggibile**: la coda la dà per inviata, ma la schermata non ha l'articolo salvato, quindi fa partire una rilettura (fix della code review);
- **scarto definitivo** (`onDropped`): il messaggio dell'errore va nel toast, tranne per un 404 (l'articolo non c'è più: basta rileggere); in entrambi i casi la lista si rilegge;
- **avviso**: compare solo se `stalled` è vero e ci sono spunte in sospeso, cioè dopo almeno un invio fallito;
- allo smontaggio la coda viene chiusa con `dispose()`.

### Riletture e modifiche concorrenti

`refresh()` chiama `fetchPlanShoppingList(planId)` e sostituisce `view`. Senza rete non fa nulla: riparte al prossimo evento. Parte:
- **al montaggio**, dopo `flush()` della coda (le spunte salvate nel browser partono prima, così la rilettura le trova già sul server); se nel frattempo la coda è stata smontata la rilettura non parte. Senza questa rilettura il tasto Indietro del browser mostrava la schermata dalla cache del router, con spunte già confermate tornate indietro (fix della code review, commit `a5316c7`);
- **al ritorno in primo piano** (`visibilitychange` con la pagina visibile) e **al ritorno della rete** (`online`), sempre dopo `flush()` (requirements P14);
- dopo uno scarto definitivo e dopo una risposta 2xx illeggibile.

**Regola**: una vista intera letta dal server non si applica se nel frattempo è stata confermata una modifica. `mutationSeqRef` sale dopo ogni spunta confermata (anche con risposta illeggibile), dopo un'aggiunta, dopo una rimozione riuscita o già avvenuta (404) e dopo una creazione o un aggiornamento della lista. `refresh()` legge il contatore prima della richiesta: se alla risposta è cambiato, scarta la vista e riparte. È l'innesto R3-a della review architetturale, che lo limitava alle spunte (`checkSeqRef`); la code review lo ha esteso alle altre modifiche.

### Creare e aggiornare la lista (`runBuild`)

1. `flush()` della coda; se restano spunte in sospeso si ferma con il toast `Ci sono spunte in attesa di rete: riprova quando torna la connessione.`
2. `requestBuildShoppingList(planId)`; la risposta sostituisce `view` e il toast dice `Lista creata` o `Lista aggiornata`.
3. Se durante la richiesta è stata confermata una modifica, la risposta si applica comunque e subito dopo parte una rilettura.
4. Un errore va nel toast. Alla fine `isBuilding` e la conferma si azzerano.

*Aggiorna lista* chiede conferma solo se c'è almeno un articolo **generato** spuntato (`Aggiorno la lista dal piano di adesso? Le spunte restano dove la quantità non aumenta; gli articoli aggiunti a mano non cambiano.`); altrimenti parte subito (decisione U3).

### Articoli a mano

- **Aggiunta** (`handleAdd`): `postShoppingItem(planId, name)`; l'articolo restituito si aggiunge alla lista, o sostituisce quello con lo stesso id se esisteva già. Restituisce l'etichetta da confermare nel pannello. Gli errori non si catturano qui: li mostra il pannello.
- **Rimozione** (`handleRemove`): la riga sparisce subito, poi `deleteShoppingItem(id)`. Un 404 lascia la riga rimossa (il risultato è già quello voluto); ogni altro errore la rimette in lista e mostra il messaggio nel toast.

## `AddShoppingItemSheet`

```ts
export interface AddShoppingItemSheetProps {
  open: boolean;
  onClose: () => void;
  onAdd: (name: string) => Promise<string>;  // si risolve con l'etichetta da confermare, rigetta con un errore mostrabile
}
```

Pannello dal basso (`Sheet` di `components/ui/sheet.tsx`) con titolo `Aggiungi alla lista`, campo `Cosa manca?` (segnaposto `Es. latte, carta forno…`, `maxLength` = `SHOPPING_ITEM_NAME_MAX`, `autoFocus`, `enterKeyHint="done"`) e pulsante `Aggiungi`, disabilitato a campo vuoto e durante il salvataggio.

- All'invio passa a `onAdd` il nome senza spazi ai bordi; un secondo invio durante il salvataggio è ignorato.
- Al successo mostra `Aggiunto: {etichetta}` in un `role="status"`, riporta il focus sul campo e **resta aperto**, per aggiungere più articoli di seguito. Il campo si svuota solo se contiene ancora il testo appena mandato: chi ha già cominciato a scrivere un altro articolo lo conserva (fix della code review).
- In caso d'errore mostra il messaggio (`apiErrorMessage`) in un `role="alert"` e conserva il testo.
- Ogni apertura riparte da zero: niente testo, conferma o errore della volta precedente.
- Si chiude con il pulsante `Chiudi` della sheet o con `Esc`.

Si inserisce solo il nome: il reparto lo deduce il server (requirements P11).

## Limiti Noti

- Aggiunta, rimozione, creazione, aggiornamento e rilettura si interrompono dopo 10 s senza risposta e danno l'errore di rete, ma non vengono ritentati da soli come le spunte: l'utente ripete il gesto ([[shopping-service]]).
- Non verificato su un dispositivo reale (jsdom non ha layout): posizione del pulsante *Aggiungi* rispetto al pollice e al toast, tastiera sopra il campo del pannello, rimozione a un tap (`requirements.md §5`).
- `components/ui/sheet.tsx` non gestisce il focus (limite preesistente, annotato in [[e2-libreria-preferenze]]); il pannello porta il focus sul campo con `autoFocus`.

## Test

- `tests/app/shopping-page.test.tsx` (node, `next/server` e servizio mockati): `connection()` prima della lettura, `getShoppingScreen({ planId })` con il parametro `piano` (assente, o primo valore se ripetuto), `key` `"none"` senza piano.
- `tests/ui/shopping-screen.test.tsx` (client mockato): intestazione, sezioni nell'ordine del giro e avanzamento; non spuntati prima degli spuntati, quantità e `Per: …`; spunta immediata; una richiesta alla volta e valore opposto dopo; spunta che resta a schermo senza rete, con avviso e ritentativo; spunte ripristinate dal browser; scarto definitivo con e senza messaggio; rilettura al ritorno in primo piano e della rete; avviso di lista da aggiornare, conferma solo con articoli generati spuntati, pulsante unico; aggiornamento bloccato con spunte in attesa; creazione dallo stato vuoto; stati senza lista e sola lettura; aggiunta e rimozione a mano con ripristino; selettore; `Hai preso tutto.`; riallineamento con un nuovo `initialScreen`; **rilettura partita prima che non annulla una spunta, un'aggiunta o una rimozione confermate**; ricostruzione con una spunta confermata nel frattempo; risposta 2xx illeggibile; **rilettura all'apertura**, dopo l'invio delle spunte salvate e non dopo la chiusura; live region dell'avviso sempre montata; pulsante di creazione disabilitato durante l'attesa.
- `tests/ui/add-item-sheet.test.tsx`: chiuso non rende nulla; campo etichettato e invio disabilitato a vuoto; nome rifilato, conferma e pannello aperto; doppio invio ignorato; testo digitato durante il salvataggio conservato; errore con testo conservato; `maxLength`; chiusura con `Chiudi` ed `Esc`; riapertura pulita.
- `tests/ui/shell.test.tsx` rende ora `ShoppingScreen` con un fixture al posto della pagina finta.

## Vedi anche

- [[shopping-item-row]] — Riga dell'articolo
- [[check-queue]] — Coda delle spunte
- [[shopping-service]] — `getShoppingScreen`, API e client
- [[shopping-list]] — Raggruppamento, avanzamento e formattazione
- [[plan-screen]] — Footer del Piano da cui si crea la lista
- [[empty-state]] — Stati vuoti della Lista
- [[toast]] — Notifiche della pagina
- [[onboarding-guard]] — Layout del gruppo `(app)` che protegge la pagina
- [[e4-lista-spesa]] — Panoramica della Feature 6
