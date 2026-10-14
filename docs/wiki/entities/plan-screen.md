---
title: Pagina Piano — PlanScreen, PlanSlotCard e Avanzamento (plan-screen)
type: entity
created: 2026-09-29
updated: 2026-10-14
tags: [ui, components, plan, page, week-navigator, swap, long-press, favorites, preferences, shopping-list, manual-choice, accessibility, feature-4, feature-9]
---

## File e Responsabilità

- **Percorsi file**:
  - `app/(app)/page.tsx`: pagina server `/` (Piano). Sostituisce la home con dati finti della Feature 1.
  - `components/plan/plan-screen.tsx`: componente client `PlanScreen` (intestazione, navigatore di settimane, azioni del piano, card per giorno, footer, sheet, toast).
  - `components/plan/plan-slot-card.tsx`: componente client `PlanSlotCard`, una `MealCard` con il flusso di swap *Cambia → Tieni / Cambia ancora* e, dalla Feature 9, *Scegli* con il selettore [[slot-recipe-picker]] (`components/plan/slot-recipe-picker.tsx`).
  - `components/plan/generation-progress.tsx`: `GenerationProgress` (skeleton + microcopy a rotazione) e hook `useRotatingMessage`.
- **Scopo**: la schermata principale del prodotto: genera o rigenera il piano della settimana da pianificare, lo mostra giorno per giorno, permette di cambiare, bloccare e confermare i pasti, di ripetere un piano e di consultare le settimane passate.
- I componenti importano dal dominio dei piani solo `lib/plans/client.ts`, `lib/plans/format.ts` ed `errors` tramite il client ([[plan-service]]); i chip delle card arrivano da `recipeChips` in `components/sheets/recipe-detail.ts` ([[recipe-sheet]]). Dalla Feature 5 il dettaglio della ricetta è [[recipe-detail-sheet]] (che fa da sé la conversione ricetta → sheet), le preferenze si salvano con `putRecipePref` di `lib/prefs/client.ts` ([[prefs-service]]) e i messaggi d'errore passano da `apiErrorMessage` ([[http-helpers]]). Dalla Feature 6 il footer usa `fetchPlanShoppingList` e `requestBuildShoppingList` di `lib/shopping/client.ts` ([[shopping-service]]).

## Pagina Server (`app/(app)/page.tsx`)

```tsx
export default async function PlanPage({ searchParams }: { searchParams: Promise<{ settimana?: string | string[] }> }) {
  await connection();
  const { settimana } = await searchParams;
  const week = Array.isArray(settimana) ? settimana[0] : settimana;
  const screen = await getPlanScreen({ week });
  return <PlanScreen key={screen.view.week.week_start} initialScreen={screen} />;
}
```

Stesso schema di `/impostazioni` (requirements P16): nessun flash di caricamento. La `key` sulla settimana mostrata azzera lo stato locale del client quando si cambia settimana. Il parametro `?settimana=YYYY-MM-DD` rende gli URL condivisibili e stabili al refresh; se ripetuto vale il primo valore. La guardia di onboarding resta nel layout del gruppo ([[onboarding-guard]]).

## `PlanScreen`

Stato: `screen` (`PlanScreenView`), `isGenerating`, `isRecovering`, `generateError`, `isConfirming`, `isCreatingList` (Feature 6), `toast`, `sheetSlotId`, più la transizione di navigazione (`useTransition`) e, dalla Feature 5, un `Set` in un ref con le ricette la cui ★ è in salvataggio. Se arriva un nuovo `initialScreen` con la stessa `key` (es. dopo `router.refresh()`), lo stato si riallinea (fix M2 della code review).

### Struttura (dall'alto)
1. Intestazione `Mealy` / `Cosa mangio oggi?`, titolo `Piano Settimanale` e pulsante d'azione: `Genera piano` (`Sparkles`) se `view.action === 'generate'`, `Rigenera` (`RefreshCw`) se `'regenerate'`, nessuno se `'none'`.
2. **Navigatore** `‹ {range} [Bozza|Confermato] ›` (Addendum D2): le frecce sono `Link` veri verso `/?settimana=…` (tap target 44 px, `aria-label` `Settimana precedente` / `Settimana successiva`, focus visibile). Un clic normale naviga in transizione (il contenuto resta visibile con `opacity-60` e `aria-busy`); modificatori e tasto centrale restano al browser. Senza settimana in quella direzione, o durante la generazione, la freccia è uno `<span role="link" aria-disabled="true">` non focalizzabile.
3. *Ripeti questo piano* (`Copy`, solo con `view.can_repeat`), con sotto `Nella settimana {range obiettivo}` e, se l'obiettivo ha già una bozza, `Sostituirà i pasti non bloccati della bozza.`.
4. Avviso piano superato (solo se `plan.superseded` e settimana modificabile): in bozza sulla settimana obiettivo `Hai cambiato le impostazioni: rigenera il piano per applicarle.`, altrimenti `Le nuove impostazioni varranno dal prossimo piano.`.
5. Riquadro di recupero dopo un errore di rete (v. sotto) e `role="alert"` con l'errore di generazione.
6. Corpo:
   - durante la generazione `GenerationProgress` con 4 skeleton;
   - con un piano, una `<section>` per giorno (`formatDayLabel`) con le `PlanSlotCard`; `editable = view.editable`, `swappable = slot.day >= today`;
   - settimana obiettivo senza piano: `EmptyState` `Nessun piano in programma` con azione `Genera piano`; se la settimana corrente ha un piano (`current_plan_id`), sotto il componente un pulsante `Ripeti questa settimana`;
   - settimana corrente senza piano nel weekend: `EmptyState` `Nessun piano per questa settimana` / `Nel weekend si pianifica la settimana che arriva.` con azione `Pianifica la prossima settimana` (solo JS: `EmptyState` non accetta un `href`);
   - settimana passata senza piano: `EmptyState` senza azioni (`Per questa settimana non c'è nessun pasto da mostrare.`).
   - dalla Feature 9 un commento sul contenitore delle card fissava la regola «nessun antenato delle card in `opacity`, `transform` o `filter` a riposo», perché le sheet del selettore erano `fixed` dentro le card (innesto R4). Dalla revisione UI del 14 ottobre 2026 le sheet sono in un portale su `body` ([[sheet-primitive]]): la regola e il commento non servono più.
7. Footer sticky sopra la tab bar (solo con un piano modificabile e fuori dalla generazione): `Conferma piano` in bozza; su un piano confermato l'azione della lista della spesa (`ShoppingBag`), che dalla Feature 6 dipende dallo stato della lista (v. "Lista della spesa dal footer"). Fino alla Feature 5 era sempre un `Link` `Crea lista della spesa` verso `/lista?piano={plan.id}`, che non creava nulla.
8. [[recipe-detail-sheet]] dello slot selezionato (`recipeId` e `initialRecipe` dalla ricetta dello slot, `servings` dalle porzioni dello slot): la ricetta si vede subito, con voto, *Preferita* e *Non proporre più*; i 👍/👎 sugli ingredienti compaiono quando arriva il dettaglio dal server. Fino alla Feature 4 qui c'era una `RecipeSheet` **senza** handler di preferenze (requirements U4 della Feature 4, chiuso dalla decisione U1 della Feature 5).
9. [[toast]], alzato sopra il footer quando il footer è visibile.

### Azioni
- **Genera / Rigenera / Ripeti**: `isGenerating`, poi `requestGeneratePlan()` o `requestRepeatPlan(planId)`. Se la settimana mostrata è l'obiettivo, lo stato si aggiorna con `result.screen`; altrimenti `router.replace('/?settimana={obiettivo}')` e il toast attraversa il rimontaggio tramite una variabile di modulo legata alla settimana obiettivo (scartata se si finisce altrove). Durante la navigazione `isGenerating` resta attivo, così *Ripeti* non si può inviare due volte (fix m5). Toast: `Piano generato`, `Piano generato con le ricette della libreria.` (se `generation.failed`), `Piano ripetuto`. Se la richiesta termina dopo che l'utente ha lasciato la schermata, si fa solo `router.refresh()`.
- **Recupero da `network_error`** (proposta R1 e fix m6): una generazione lunga può perdere la connessione mentre il server finisce e salva. Prima della richiesta si fissa una base (`generated_at` del piano obiettivo, `null` se non esiste, letta dal server se la bozza obiettivo non è mostrata); dopo l'errore si rilegge `fetchPlanScreen(obiettivo)` con backoff da 2 s a 30 s fino alla `maxDuration` della rotta (500 s per Genera, 250 s per Ripeti), mostrando `La connessione si è interrotta: controllo se il piano è pronto…` e il pulsante `Smetti di aspettare`. Un piano più recente della base viene adottato con il toast di successo; altrimenti compare l'errore originale. Se la base non è leggibile non si tenta il recupero.
- **Conferma**: `requestConfirmPlan(plan.id)` → badge `Confermato`, footer con la lista, toast `Piano confermato`; errore → toast.
- **Blocco** (lucchetto o long-press): aggiornamento ottimistico di `locked`, poi `requestSlotLock`; errore → ripristino e toast.
- **Unione per slot** (fix m9): le risposte di swap e blocco aggiornano **solo** lo slot interessato (`recipe`/`servings` e lo stato della lista per lo swap, `locked` per il blocco), così risposte arrivate fuori ordine non annullano le modifiche degli altri slot.

### Preferenze sulle ricette (Feature 5)
- **`applyRecipePrefs(recipeId, changed)`**: fonde i soli campi cambiati (`RecipePrefChanges`) nelle preferenze della ricetta, in **tutti** gli slot del piano mostrato che la contengono, partendo da `defaultRecipePref` se la ricetta non ha preferenze. Se il risultato è bloccato forza `favorite: false`: la risposta tardiva di una ★ non rimette tra le preferite una ricetta appena bloccata. È l'handler `onRecipePrefsChange` del dettaglio.
- **★ sulla card** (`handleToggleFavorite(recipeId)`): un secondo tocco mentre il salvataggio di quella ricetta è in corso viene ignorato. Aggiornamento ottimistico di `favorite`, poi `putRecipePref(recipeId, { favorite })`; al successo si applica **solo** `favorite` dalla risposta, così un voto dato nel frattempo dal dettaglio non viene sovrascritto; in caso d'errore si ripristina il valore precedente e il messaggio va nel toast.
- **Blocco dal dettaglio**: il toast è `Non la proporrò più. In questo piano resta: usa Cambia per sostituirla.` (`blockedMessage`). La card resta nel piano, senza più la ★, e **non** parte nessuna richiesta a `/api/plans/**`: un giudizio non modifica il piano in corso e vale dalla prossima generazione, rigenerazione, *Ripeti* o *Cambia* (requirements U2 della Feature 5).
- Gli errori di generazione, conferma, blocco e swap usano ora `apiErrorMessage(err)` al posto della funzione locale `errorMessage` (`PlanRequestError` estende `ApiRequestError`, quindi il comportamento è lo stesso).

### Lista della spesa dal footer (Feature 6)

Su un piano confermato e modificabile il footer mostra, secondo `plan.shopping_list` (requirements P15):

| Stato della lista | Elemento | Etichetta |
|---|---|---|
| non esiste (`exists: false`) | **pulsante** | `Crea lista della spesa`; durante la richiesta è disabilitato e mostra `Creo la lista…` |
| esiste ed è allineata | `Link` a `/lista?piano={plan.id}` | `Vai alla lista della spesa` |
| esiste ma il piano è cambiato (`needs_regeneration`) | `Link` a `/lista?piano={plan.id}` | `Lista della spesa da aggiornare` |

- **Creazione** (`handleCreateList`): `requestBuildShoppingList(plan.id)`; al successo lo stato locale passa a `{ exists: true, needs_regeneration: false }` e si naviga a `/lista?piano={plan.id}`. Un errore va nel toast e il pulsante torna attivo. La creazione è una `POST`, quindi non può avvenire al caricamento di una pagina: per questo è un pulsante e non un link. Il link `Lista della spesa da aggiornare` porta soltanto alla Lista: l'aggiornamento si fa lì, con *Aggiorna lista* ([[shopping-screen]]).
- **Rilettura dello stato della lista al montaggio** (fix della code review, commit `a5316c7`): tornando indietro il router può riproporre un piano dalla sua cache, con lo stato della lista di prima (per esempio il pulsante `Crea lista della spesa` per una lista appena creata). Un effetto che gira una volta al montaggio, solo se il piano mostrato è confermato e modificabile, chiama `fetchPlanShoppingList(plan.id)` e aggiorna **soltanto** `shopping_list` (`exists`, `needs_regeneration`): slot, ricette e preferenze non si toccano. Non fa nulla per una bozza o per un piano in sola lettura; senza rete resta lo stato già a schermo.
- **La rilettura non sovrascrive un'azione dell'utente**: un ref (`shoppingListTouchedRef`) si accende quando la lista viene creata dal footer o quando uno swap riporta dal server un nuovo stato della lista; una rilettura partita prima e arrivata dopo viene scartata.
- La variante del difetto "tasto Indietro" sul footer è coperta dai test ma non è stata riprodotta in un browser, a differenza di quella sulla Lista ([[e4-lista-spesa]]).

## `PlanSlotCard`

```ts
export interface PlanSlotCardProps {
  planId: string;
  slot: PlanSlotView;
  editable: boolean;       // false → niente Cambia, lucchetto e long-press
  swappable?: boolean;     // false → niente Cambia ma blocco consentito (giorno passato); default true
  onPlanChange: (plan: PlanView) => void;
  onToggleLock: (slotId: string) => void;
  onSelectRecipe: (slot: PlanSlotView) => void;
  onToggleFavorite?: (recipeId: string) => void;  // Feature 5: assente → nessuna ★
  onRecipePrefsChange?: (recipeId: string, changed: RecipePrefChanges) => void;  // Feature 9: giudizi dal dettaglio del selettore
  onPlanStale?: () => void;                        // Feature 9: slot o piano non più modificabili → il genitore rilegge il piano
  onError: (message: string) => void;              // errori e avvisi da mostrare come toast
}
```

- Props passate a [[meal-card]]: solo il nome del giorno come eyebrow, `MEAL_TYPE_LABELS`, titolo (o `Ricetta non disponibile` se la ricetta è stata eliminata), tempo e chip (`recipeChips`); `onSwap` solo se `editable && swappable`; lucchetto e long-press solo se `editable`. Dalla Feature 5 passa anche `isFavorite` (`slot.recipe.prefs.favorite`) e `onToggleFavorite`, quest'ultimo solo se il genitore ha fornito l'handler, lo slot ha una ricetta e la ricetta **non è bloccata**; l'handler riceve l'**id della ricetta**, non dello slot. La ★ compare anche sulle card non modificabili (settimane passate): il giudizio riguarda la ricetta, non il piano. Fino alla Feature 4 `onToggleFavorite` non veniva mai passato.
- Modalità `idle → swapping → review`. Lo swap invia come esclusioni le ricette scartate nella sequenza più quella corrente, senza duplicati e al massimo `SWAP_EXCLUDE_MAX` (50). In attesa, al posto del footer un `role="status"` con `Cerco un'alternativa…` seguito dai messaggi di generazione. In revisione la card si rimonta dentro `animate-meal-flip` e mostra `Tieni` (azzera la sequenza) e `Cambia ancora`. Un errore torna alla modalità precedente e passa il messaggio al genitore; se lo slot viene bloccato durante la revisione la sequenza termina.
- **Focus** (fix m8): all'arrivo della proposta va su `Tieni`, dopo `Tieni` o un errore di nuovo su `Cambia` (su `Cambia ancora` se l'errore arriva in revisione), solo se l'utente non l'ha spostato altrove nel frattempo.

### *Scegli* e il selettore (Feature 9)
- **Dove compare**: `MealCard` riceve `onPick` esattamente quando riceve `onSwap` (`canSwap = editable && swappable`): piano modificabile e giorno non passato, anche su uno slot senza ricetta. È disabilitato sullo slot bloccato e assente durante uno swap in corso (il footer è sostituito dal messaggio di attesa). Nella riga di revisione compare tra `Tieni` e `Cambia ancora` come pulsante `ghost` con la sola icona `Search` (`size="icon"`, `aria-label="Scegli dalla libreria"`, `data-slot-action="pick"`), nell'ordine `Tieni` · 🔍 · `Cambia ancora` (decisione U2).
- **Apertura** (`openPicker`): ignorata su slot bloccato o durante uno swap; altrimenti `pickerOpen = true` e la card monta [[slot-recipe-picker]] **fuori** dal `div` con `key` che cambia tra `base` e `review-…`, così il passaggio tra le due modalità non rimonta il selettore (requirements P19).
- **Chiusura senza assegnazione** (`closePicker`): la card resta com'è (anche in revisione) e il focus torna su *Scegli*, o sull'icona della riga di revisione.
- **Assegnazione riuscita** (`handleAssigned(plan)`): selettore chiuso, modalità `idle` (niente *Tieni / Cambia ancora*), sequenza degli scarti azzerata, `onPlanChange(plan)` e focus su *Scegli* (spec FR-6.3).
- **Focus**: la chiave `pick` si aggiunge a `FOCUS_SELECTORS` con il selettore `[data-slot-action="pick"]`, che trova il pulsante di `MealCard` in modalità normale e l'icona in revisione; usa lo stesso meccanismo `pendingFocus` dello swap.
- **Inoltri**: il selettore riceve `onRecipePrefsChange` e `onPlanStale` dalla card e `onError` come `onNotify`.

`PlanScreen` passa `onRecipePrefsChange={applyRecipePrefs}` (un giudizio dato dal dettaglio del selettore aggiorna tutti gli slot con quella ricetta) e `onPlanStale={() => router.refresh()}`: un rifiuto per piano non più modificabile rilegge il piano con il riallineamento `syncedInitialScreen` già esistente. Il dettaglio dello slot (`sheetSlotId`) resta quello di prima, fuori dal contenitore delle card.

## `GenerationProgress` e `useRotatingMessage`

- `GENERATION_MESSAGES`: `Sto sfogliando il ricettario…`, `Accendo i fornelli…`, `Controllo la dispensa…`, `Assaggio il sugo…`, `Apparecchio la tavola…`; `GENERATION_MESSAGE_INTERVAL_MS = 2500`.
- `useRotatingMessage(messages, intervalMs?, active?)`: parte dal primo messaggio e avanza in modo circolare; con `active` falso resta sul primo.
- `GenerationProgress({ cards = 4 })`: `role="status" aria-live="polite"` con il messaggio e da 1 a 6 card skeleton `aria-hidden` con `motion-safe:animate-pulse`. Mai uno spinner né un `progressbar`.

## Animazione dello Swap (`app/globals.css`)

Classe `animate-meal-flip`: flip `rotateY` da 80° a 0° in 320 ms; con `prefers-reduced-motion: reduce` diventa una dissolvenza di 200 ms (requirements P20, `DESIGN.md §3` e §6).

## Test

- `tests/home.test.tsx` (node, `next/server` e servizio mockati): `connection()`, `getPlanScreen({ week })` con il parametro `settimana` (primo valore se ripetuto), `PlanScreen` con la `key` della settimana.
- `tests/ui/plan-screen.test.tsx` (client mockato): generazione con progress e toast, errori, recupero con backoff e *Smetti di aspettare*, conferma, navigatore e frecce disabilitate, sola lettura delle settimane passate, stati vuoti, *Ripeti*, avviso superato, riallineamento dello stato, esiti dopo lo smontaggio, blocco ottimistico, unione per slot; dalla Feature 5 (con `@/lib/library/client` e `@/lib/prefs/client` mockati) dettaglio aperto subito con le azioni di preferenza, ★ ottimistica su ogni card con ripristino e toast in caso d'errore, secondo tocco ignorato, blocco dal dettaglio senza richieste al piano, voto dal dettaglio, risposta tardiva della ★ che non sovrascrive un voto né rimette preferita una ricetta bloccata, ★ anche su una settimana passata; dalla Feature 6 (con `@/lib/shopping/client` mockato) creazione della lista con navigazione alla Lista, etichetta di attesa ed errore nel toast, link a una lista esistente e a una da aggiornare, rilettura al montaggio che mostra il link quando il server ha già la lista e che cambia solo lo stato della lista lasciando gli slot com'erano, pulsante conservato se il server non ha la lista o se la rilettura fallisce, rilettura tardiva che non annulla una lista appena creata, nessuna rilettura per una bozza o un piano in sola lettura.
- `tests/ui/plan-slot-card.test.tsx`: swap, *Cambia ancora*, *Tieni*, errori, limite delle esclusioni, card di sola lettura, giorni passati, focus; dalla Feature 5 la ★ (assente senza handler, con ricetta bloccata o senza ricetta; id della ricetta passato all'handler; `aria-pressed`; presente sulle card di sola lettura).
- `tests/ui/generation-progress.test.tsx`; `tests/ui/shell.test.tsx` rende ora `PlanScreen` con un fixture al posto della vecchia home.
- Dalla Feature 9: blocco `PlanSlotCard — Scegli` in `tests/ui/plan-slot-card.test.tsx` (presente su una card modificabile e cambiabile, assente in sola lettura o su un giorno passato, disabilitato su slot bloccato, selettore montato per lo slot, assegnazione dallo stato normale con focus su *Scegli*, chiusura senza assegnazione, ordine `Tieni` · icona · `Cambia ancora`, assegnazione dalla revisione che azzera la sequenza, chiusura in revisione con focus sull'icona, piano non più modificabile notificato una volta, avvisi inoltrati a `onError`, nessun *Scegli* durante uno swap, *Scegli* su uno slot senza ricetta) e blocco `scelta a mano` in `tests/ui/plan-screen.test.tsx` (ricetta scelta che compare sulla card, nessun *Scegli* sui giorni passati o su una settimana in sola lettura, rifiuto per piano non più modificabile con toast, selettore chiuso e una sola rilettura). I test esistenti su *Cambia* restano verdi senza modificarne le attese.

## Vedi anche

- [[plan-service]] — Schermata, API e client usati dalla pagina
- [[meal-card]] — Card del pasto con long-press e azioni sostitutive
- [[recipe-detail-sheet]] — Dettaglio ricetta con preferenze, aperto dalla card (Feature 5)
- [[recipe-sheet]] — Componente presentazionale del dettaglio e `recipeChips`
- [[prefs-service]] — `putRecipePref` e regola "bloccare toglie dalle preferite"
- [[toast]] — Notifiche della pagina
- [[empty-state]] — Stati vuoti del piano
- [[onboarding-guard]] — Layout del gruppo `(app)` che protegge la pagina
- [[shopping-screen]] — Schermata Lista aperta dal footer (Feature 6)
- [[shopping-service]] — `requestBuildShoppingList` e `fetchPlanShoppingList` (Feature 6)
- [[e3-pianificatore]] — Panoramica della Feature 4
- [[e2-libreria-preferenze]] — Panoramica della Feature 5
- [[e4-lista-spesa]] — Panoramica della Feature 6
- [[slot-recipe-picker]] — Selettore aperto da *Scegli* (Feature 9)
- [[f9-ricette-su-richiesta]] — Panoramica della Feature 9
