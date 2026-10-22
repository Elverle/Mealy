---
title: Schermata Libreria — LibraryScreen, LibraryFilters e RecipeCard (library-screen)
type: entity
created: 2026-10-05
updated: 2026-10-21
tags: [ui, components, library, page, search, filters, favorites, accessibility, recipe-requests, courses, feature-5, feature-8, feature-9]
---

## File e Responsabilità

- **Percorsi file**:
  - `app/(app)/libreria/page.tsx`: pagina server `/libreria`. Sostituisce la pagina con dati finti (`MOCK_RECIPES`) della Feature 1.
  - `app/(app)/libreria/loading.tsx`: scheletro mostrato da Next mentre la pagina server carica.
  - `components/library/library-screen.tsx`: componente client `LibraryScreen` (intestazione, filtri, conteggio, griglia di card, stati vuoti, dettaglio, toast).
  - `components/library/library-filters.tsx`: componente client `LibraryFilters` (campo di ricerca, riga rapida, pannello *Filtri*).
  - `components/library/recipe-card.tsx`: componente client `RecipeCard`, la card compatta di una ricetta.
- **Scopo**: ritrovare e giudicare le ricette della libreria: ricerca per titolo o ingrediente, filtri combinabili, ★ rapida sulla card, dettaglio con le quantità scalate sulle persone dell'household.
- I componenti importano dai moduli di dominio solo codice sicuro per il client: `lib/domain/library.ts` (funzioni pure, [[library-service]]), `lib/prefs/client.ts` ([[prefs-service]]) e `lib/http/client.ts` ([[http-helpers]]); dalla Feature 9 anche `requestSaveRecipe` di `lib/library/client.ts`. Mai i `service.ts`.
- **Dalla Feature 9** la schermata permette anche di **chiedere una ricetta all'LLM** dal campo di ricerca ([[f9-ricette-su-richiesta]]), con `RecipeRequestBox` e `RecipeProposalSheet` ([[recipe-proposal-sheet]]); `RecipeCard` è riusata dal selettore del Piano con un'etichetta e senza ★ cliccabile ([[slot-recipe-picker]]).

## Pagina Server (`app/(app)/libreria/page.tsx`)

```tsx
export default async function LibraryPage() {
  await connection();
  const [recipes, settings] = await Promise.all([listLibraryCards(), getSettings()]);
  return <LibraryScreen initialRecipes={recipes} persons={settings.persons} />;
}
```

Stesso schema di `/` e `/impostazioni`: la pagina passa **tutte** le card (bloccate comprese, già ordinate) e il numero di persone; filtri, ricerca e ordinamento si applicano poi in memoria nel client, con le stesse funzioni pure usate da `GET /api/recipes` (requirements P8). La card è un DTO leggero (`LibraryRecipeCard`): passi e quantità viaggiano solo all'apertura del dettaglio (requirements P9). La guardia di onboarding resta nel layout del gruppo ([[onboarding-guard]]).

`loading.tsx` rende `<main aria-busy="true">` con il titolo `Libreria Ricette` e una griglia di 6 riquadri `animate-pulse motion-reduce:animate-none`.

## `LibraryScreen`

```ts
export interface LibraryScreenProps {
  initialRecipes: LibraryRecipeCard[];
  persons: number;
}
```

Stato: `cards` (da `initialRecipes`; se la prop cambia identità, per esempio dopo `router.refresh()`, lo stato si riallinea durante il render come `syncedInitialScreen` in [[plan-screen]]), `query`, `filter` (`EMPTY_LIBRARY_FILTER` all'inizio), `sheetRecipeId`, `toast`, più un `Set` in un ref con gli id la cui ★ è in salvataggio.

- `visible = filterLibraryCards(cards, { ...filter, q: query })` in `useMemo`: il testo cercato vive in `query`, il campo `q` del filtro non è usato dallo stato.
- `hasActiveFilter` = testo non vuoto oppure un criterio qualsiasi attivo; `resetFilters()` azzera testo e filtro. Dalla Feature 8 la funzione `hasFilterCriteria` conta anche le portate selezionate, quindi un filtro *Portata* attivo mostra `Azzera filtri`.
- Né il filtro né il testo finiscono nell'URL (requirements P21): un refresh riparte dalla libreria intera.

### Struttura (dall'alto)
1. Intestazione: `h1` `Libreria Ricette` e sottotitolo `Tutte le tue ricette, da ritrovare e giudicare`.
2. **Libreria vuota** (`cards.length === 0`): solo un [[empty-state]] `Ancora nessuna ricetta` / `Genera il primo piano e la libreria si riempie da sola.` con azione `Vai al piano` (`router.push('/')`). Niente ricerca né filtri.
3. Altrimenti `LibraryFilters`, poi una riga con il conteggio (`1 ricetta` oppure `N ricette`) e, con un filtro attivo, il pulsante `Azzera filtri`.
4. Corpo:
   - nessun risultato con *Bloccate* acceso: `Nessuna ricetta bloccata` / `Le ricette che segni con «Non proporre più» le ritrovi qui.`, azione `Azzera filtri`;
   - nessun risultato negli altri casi: `Nessuna ricetta trovata` / `Prova a cambiare i filtri o il testo cercato.`, azione `Azzera filtri`;
   - altrimenti la griglia `grid grid-cols-1 gap-3 sm:grid-cols-2` di `RecipeCard`.
   - **Dalla Feature 9**, sotto il corpo (anche dopo uno stato vuoto, compreso *Nessuna ricetta bloccata*), `RecipeRequestBox` sul testo cercato: compare con almeno 3 caratteri ([[recipe-proposal-sheet]]).
5. [[recipe-detail-sheet]] con `recipeId={sheetRecipeId}` e `servings={persons}`, senza `initialRecipe` né `blockedMessage`: in Libreria si vede lo scheletro finché il dettaglio arriva.
6. **Dalla Feature 9** `RecipeProposalSheet` con `request={requestText}`, `mealType={null}` (il tipo di pasto lo decide il modello), `servings={persons}` e `acceptLabel="Aggiungi alla libreria"`.
7. [[toast]].

Dalla Feature 9 il titolo `h1` ha un ref e `tabIndex={-1}` (`focus:outline-none`), per ricevere il focus dopo un salvataggio.

### ★ rapida e aggiornamento delle card
- `patchCard(id, changes)` fonde nella card **solo** i campi indicati (`rating`, `favorite`, `blocked`); se la card risulta bloccata forza `favorite: false`, così la risposta tardiva di una ★ non rimette tra le preferite una ricetta appena bloccata. È anche l'handler `onRecipePrefsChange` del dettaglio.
- `handleToggleFavorite(id)`: un secondo tocco mentre la ★ di quella ricetta è in salvataggio viene ignorato. Aggiornamento ottimistico di `favorite`, poi `putRecipePref(id, { favorite })`; al successo si applica **solo** `favorite` dalla risposta (un voto dato nel frattempo dal dettaglio non viene sovrascritto); in caso d'errore si ripristina il valore precedente e si mostra `apiErrorMessage(err)` nel toast.
- L'ordine si ricalcola a ogni cambio: una ★ porta subito la card in alto (requirements U4). Una ricetta bloccata dal dettaglio sparisce dall'elenco se *Bloccate* è spento, mentre il dettaglio resta aperto.

### Chiedere una ricetta (Feature 9)
- Stato `requestText: string | null` (`null` = nessuna proposta aperta). Il riquadro chiama `setRequestText` con il testo senza spazi ai bordi; i chip di filtro **non** entrano nella richiesta (spec FR-1.4).
- **Chiusura senza salvare** (`closeProposal`): `requestText = null` e focus sul pulsante del riquadro che l'ha aperta (`requestButtonRef`, requirements P22). La richiesta in corso è annullata dalla sheet; la libreria resta invariata.
- **`handleAddToLibrary(recipe)`**, passata come `onAccept`: `requestSaveRecipe(recipe)`.
  - **Successo**: la nuova card (`toLibraryCard(saved)`) entra in `cards` senza ricaricare la pagina (requirements P23; l'ordine lo rifà `filterLibraryCards`), la sheet si chiude, testo e filtri si azzerano (`resetFilters`), toast `` `«${titolo}» è in libreria` `` e focus sul titolo della pagina.
  - **Errore**: toast con `apiErrorMessage(err)` e rilancio, quindi la sheet resta aperta con la proposta e i pulsanti di nuovo attivi. Vale anche per `409 recipe_duplicate` (`Questa ricetta è già in libreria.`, spec FR-8); nel selettore del Piano lo stesso caso si comporta diversamente ([[slot-recipe-picker]]).
- Con la libreria vuota non c'è campo di ricerca, quindi nessuna richiesta (spec FR-1.5).

## `LibraryFilters`

```ts
export interface LibraryFiltersProps {
  query: string;
  onQueryChange: (query: string) => void;
  filter: LibraryFilter;        // il campo `q` è ignorato: il testo vive in `query`
  onFilterChange: (next: LibraryFilter) => void;
}
```

- **Campo di ricerca**: `<input type="search">` con `aria-label="Cerca nella libreria"`, placeholder `Cerca ricetta o ingrediente…`, `maxLength={LIBRARY_QUERY_MAX}` (100), altezza minima 44 px, icona `Search`.
- **Riga rapida** (requirements U3): [[chip-filter]] `Preferite` (icona `Star`), `Pranzo` e `Cena` (etichette da `MEAL_TYPE_LABELS`), poi il pulsante `Filtri` con `aria-expanded` e `aria-controls="library-filter-panel"`. L'etichetta diventa `Filtri · n`, dove `n` conta i criteri attivi **del pannello** (tag + diete + *Bloccate*); l'icona `ChevronDown` ruota quando il pannello è aperto.
- **Pannello** (`id="library-filter-panel"`, reso solo se aperto; chiuso all'avvio): tre gruppi con titolo in maiuscoletto: `Tipo di pasti` (i 7 valori di `MEAL_STYLE_TAG_VALUES`), `Dieta` (i 5 di `DIET_FLAG_VALUES`), `Altro` (chip `Bloccate`, icona `Ban`).
- L'alternanza di un chip aggiunge o toglie il valore senza cambiare l'ordine degli altri.

**Dalla Feature 8**:
- Il pannello ha un quarto gruppo, **`Portata`**, per **primo**: quattro chip da `COURSE_VALUES` con le etichette di `COURSE_LABELS` (*Piatto unico*, *Primo*, *Secondo*, *Contorno*). Dentro il gruppo i chip valgono in OR, con gli altri gruppi in AND ([[library-service]]). Sta nel pannello e non nella riga rapida: a 360 px la riga rapida non regge altri quattro chip (requirements P22 della Feature 8).
- Il gruppo `Tipo di pasti` mostra i **12** valori di `MEAL_STYLE_TAG_VALUES`.
- `Filtri · n` conta anche le portate: `n` = portate + tag + diete + *Bloccate*.
- Ogni gruppo è un `role="group"` con `aria-labelledby` sul proprio titolo (id da `React.useId()`: `-courses`, `-tags`, `-diets`, `-other`). Così i due chip *Piatto unico*, quello della portata e quello dell'etichetta di stile, si distinguono con il lettore di schermo (fix della code review, commit `bfbb3a4`).

## `RecipeCard`

```ts
export interface RecipeCardProps {
  recipe: LibraryRecipeCard;
  onOpen: (recipeId: string) => void;
  onToggleFavorite?: (recipeId: string) => void;   // facoltativa dalla Feature 9 (obbligatoria nella Feature 5)
  badge?: string;                                  // Feature 9: etichetta accanto al tempo (es. «Già nel piano»)
}
```

- **Contenuto**, fuori da ogni pulsante: badge del tempo (`{prep_minutes} min`, `tabular-nums`), titolo in un vero `<h3>` (`font-display`, al più due righe), e, se ci sono, una riga con i chip di `recipeChips(recipe)` ([[recipe-sheet]]) e il voto (stella `saffron` + numero, `role="img"` con `aria-label` `Voto N su 5`).
- **Pulsante di apertura**: un `<button>` vuoto il cui pseudo-elemento `::after` copre l'intera card (`after:absolute after:inset-0`); prende il nome accessibile dal contenuto con `aria-labelledby` (tempo, titolo, riga dei chip) e mostra l'anello di focus sullo pseudo-elemento. Così il titolo resta un'intestazione navigabile e non c'è markup non valido (intestazioni e badge dentro un pulsante), fix della code review.
- **In alto a destra**, sopra il pulsante esteso (`z-10`): se la ricetta è bloccata l'etichetta `Bloccata` con icona `Ban` in `tomato`, senza ★; altrimenti il pulsante ★ da 44 × 44 px con `aria-pressed` e `aria-label` `Aggiungi {titolo} ai preferiti` / `Rimuovi {titolo} dai preferiti`.

Dalla Feature 9 (requirements P18, aggiunte compatibili: la Libreria passa ancora `onToggleFavorite` e non passa `badge`, quindi non cambia):
- **`badge`**: un `Badge` `saffron-subtle` accanto a quello del tempo, con un proprio id incluso nell'`aria-labelledby` del pulsante di apertura, dopo il titolo. Lo usa il selettore del Piano per `Già nel piano` ([[slot-recipe-picker]]).
- **Senza `onToggleFavorite`** la ★ non è un comando: su una ricetta preferita resta un'icona non interattiva (`role="img"`, `aria-label="Preferita"`), su una non preferita non c'è nulla. `Bloccata` ha sempre la precedenza.

Dalla Feature 8 (decisione U1):
- **Badge di portata**: `courseLabel(recipe.courses)` ([[courses]]) in un `Badge` `basil-subtle`, subito dopo il tempo e prima dell'eventuale `badge`. Le portate sono in ordine canonico (es. `Piatto unico · Primo`); su una ricetta non classificata il badge non c'è. Il testo viene sempre dai dati, mai scritto a mano.
- Il suo id (`…-course`) entra nell'`aria-labelledby` del pulsante di apertura tra il tempo e il titolo.
- Tempo, portata ed eventuale `badge` stanno in una riga `flex flex-wrap gap-1.5`: se la riga va a capo i badge non restano rientrati (fix della code review, commit `bfbb3a4`; prima i badge erano in linea, con un margine sinistro sul secondo).
- La riga dei chip usa `recipeChips`, che su una ricetta classificata non ripete *Piatto unico* (decisione U2, [[recipe-sheet]]).
- La stessa card serve il selettore del Piano, quindi il badge compare anche nell'elenco di *Scegli* ([[slot-recipe-picker]]).

Limite noto: la sovrapposizione tra il pulsante esteso, la ★ e l'etichetta `Bloccata` è verificata solo in jsdom, che non ha layout; va controllata su un telefono ([[e2-libreria-preferenze]]).

## Test

- `tests/app/library-page.test.tsx` (node, `next/server` e servizi mockati): `connection()`, i due servizi, `LibraryScreen` con `initialRecipes` e `persons`.
- `tests/ui/library-screen.test.tsx` (client mockati, card costruite dalle fixture con `toLibraryCard`): libreria vuota, ricerca per titolo e per ingrediente con conteggio, nessun risultato e `Azzera filtri`, bloccate nascoste e mostrate da sole, titolo come intestazione di livello 3 fuori dai pulsanti, ordine delle preferite, ★ ottimistica con secondo tocco ignorato e ripristino in caso d'errore, apertura del dettaglio con quantità scalate su `persons`, blocco dal dettaglio, risposta tardiva della ★ che non sovrascrive un voto né rimette preferita una ricetta bloccata.
- `tests/ui/library-filters.test.tsx`: testo, riga rapida, apertura del pannello, chip del pannello, contatore `Filtri · 2`.
- `tests/ui/shell.test.tsx`: il test della Libreria monta ora `LibraryScreen` con una card delle fixture.
- Dalla Feature 9: blocco `LibraryScreen — chiedere una ricetta` in `tests/ui/library-screen.test.tsx` (riquadro da 3 caratteri accanto ai risultati, anche senza risultati e con *Bloccate* vuoto; solo il testo rifilato nella richiesta, senza i chip; salvataggio solo al tocco con ricerca azzerata e toast; nessun salvataggio prima del tocco; Esc che chiude senza salvare e riporta il focus sul pulsante; proposta aperta con l'errore se il salvataggio è rifiutato; focus sul titolo dopo il salvataggio; né campo né richiesta con la libreria vuota) e `tests/ui/recipe-card.test.tsx` (★ come comando, nessuna ★ né *Preferita* senza handler su una non preferita, *Preferita* non interattiva, `badge` nel nome del pulsante, nessun badge senza la prop, `Bloccata` con o senza handler e prioritaria su *Preferita*, apertura con l'id).

- Dalla Feature 8: `tests/ui/library-filters.test.tsx` (gruppo *Portata* per primo con quattro chip, alternanza che conserva gli altri filtri, portate nel contatore, gruppi etichettati che distinguono i due *Piatto unico*), `tests/ui/library-screen.test.tsx` (un filtro di portata attivo conta come filtro e `Azzera filtri` ripristina tutto), `tests/ui/recipe-card.test.tsx` (badge dopo il tempo e nel nome del pulsante, più portate in ordine, nessun badge su una ricetta non classificata).

## Vedi anche

- [[library-service]] — `listLibraryCards` e le funzioni pure di filtro e ordinamento
- [[recipe-detail-sheet]] — Dettaglio aperto dalla card
- [[prefs-service]] — `putRecipePref` e regola "bloccare toglie dalle preferite"
- [[chip-filter]] — Chip della riga rapida e del pannello
- [[empty-state]] — Stati vuoti della Libreria
- [[toast]] — Conferme ed errori della schermata
- [[shell-navigation-pattern]] — Tab Libreria nella shell
- [[e2-libreria-preferenze]] — Panoramica della Feature 5
- [[recipe-proposal-sheet]] — Riquadro di richiesta e sheet di proposta (Feature 9)
- [[slot-recipe-picker]] — Selettore del Piano che riusa `RecipeCard` (Feature 9)
- [[f9-ricette-su-richiesta]] — Panoramica della Feature 9
- [[courses]] — `courseLabel`, testo del badge di portata (Feature 8)
- [[f8-portate-etichette]] — Panoramica della Feature 8
