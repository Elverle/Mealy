---
title: Schermata Libreria — LibraryScreen, LibraryFilters e RecipeCard (library-screen)
type: entity
created: 2026-10-05
updated: 2026-10-05
tags: [ui, components, library, page, search, filters, favorites, accessibility, feature-5]
---

## File e Responsabilità

- **Percorsi file**:
  - `app/(app)/libreria/page.tsx`: pagina server `/libreria`. Sostituisce la pagina con dati finti (`MOCK_RECIPES`) della Feature 1.
  - `app/(app)/libreria/loading.tsx`: scheletro mostrato da Next mentre la pagina server carica.
  - `components/library/library-screen.tsx`: componente client `LibraryScreen` (intestazione, filtri, conteggio, griglia di card, stati vuoti, dettaglio, toast).
  - `components/library/library-filters.tsx`: componente client `LibraryFilters` (campo di ricerca, riga rapida, pannello *Filtri*).
  - `components/library/recipe-card.tsx`: componente client `RecipeCard`, la card compatta di una ricetta.
- **Scopo**: ritrovare e giudicare le ricette della libreria: ricerca per titolo o ingrediente, filtri combinabili, ★ rapida sulla card, dettaglio con le quantità scalate sulle persone dell'household.
- I componenti importano dai moduli di dominio solo codice sicuro per il client: `lib/domain/library.ts` (funzioni pure, [[library-service]]), `lib/prefs/client.ts` ([[prefs-service]]) e `lib/http/client.ts` ([[http-helpers]]); mai i `service.ts`.

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
- `hasActiveFilter` = testo non vuoto oppure un criterio qualsiasi attivo; `resetFilters()` azzera testo e filtro.
- Né il filtro né il testo finiscono nell'URL (requirements P21): un refresh riparte dalla libreria intera.

### Struttura (dall'alto)
1. Intestazione: `h1` `Libreria Ricette` e sottotitolo `Tutte le tue ricette, da ritrovare e giudicare`.
2. **Libreria vuota** (`cards.length === 0`): solo un [[empty-state]] `Ancora nessuna ricetta` / `Genera il primo piano e la libreria si riempie da sola.` con azione `Vai al piano` (`router.push('/')`). Niente ricerca né filtri.
3. Altrimenti `LibraryFilters`, poi una riga con il conteggio (`1 ricetta` oppure `N ricette`) e, con un filtro attivo, il pulsante `Azzera filtri`.
4. Corpo:
   - nessun risultato con *Bloccate* acceso: `Nessuna ricetta bloccata` / `Le ricette che segni con «Non proporre più» le ritrovi qui.`, azione `Azzera filtri`;
   - nessun risultato negli altri casi: `Nessuna ricetta trovata` / `Prova a cambiare i filtri o il testo cercato.`, azione `Azzera filtri`;
   - altrimenti la griglia `grid grid-cols-1 gap-3 sm:grid-cols-2` di `RecipeCard`.
5. [[recipe-detail-sheet]] con `recipeId={sheetRecipeId}` e `servings={persons}`, senza `initialRecipe` né `blockedMessage`: in Libreria si vede lo scheletro finché il dettaglio arriva.
6. [[toast]].

### ★ rapida e aggiornamento delle card
- `patchCard(id, changes)` fonde nella card **solo** i campi indicati (`rating`, `favorite`, `blocked`); se la card risulta bloccata forza `favorite: false`, così la risposta tardiva di una ★ non rimette tra le preferite una ricetta appena bloccata. È anche l'handler `onRecipePrefsChange` del dettaglio.
- `handleToggleFavorite(id)`: un secondo tocco mentre la ★ di quella ricetta è in salvataggio viene ignorato. Aggiornamento ottimistico di `favorite`, poi `putRecipePref(id, { favorite })`; al successo si applica **solo** `favorite` dalla risposta (un voto dato nel frattempo dal dettaglio non viene sovrascritto); in caso d'errore si ripristina il valore precedente e si mostra `apiErrorMessage(err)` nel toast.
- L'ordine si ricalcola a ogni cambio: una ★ porta subito la card in alto (requirements U4). Una ricetta bloccata dal dettaglio sparisce dall'elenco se *Bloccate* è spento, mentre il dettaglio resta aperto.

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

## `RecipeCard`

```ts
export interface RecipeCardProps {
  recipe: LibraryRecipeCard;
  onOpen: (recipeId: string) => void;
  onToggleFavorite: (recipeId: string) => void;
}
```

- **Contenuto**, fuori da ogni pulsante: badge del tempo (`{prep_minutes} min`, `tabular-nums`), titolo in un vero `<h3>` (`font-display`, al più due righe), e, se ci sono, una riga con i chip di `recipeChips(recipe)` ([[recipe-sheet]]) e il voto (stella `saffron` + numero, `role="img"` con `aria-label` `Voto N su 5`).
- **Pulsante di apertura**: un `<button>` vuoto il cui pseudo-elemento `::after` copre l'intera card (`after:absolute after:inset-0`); prende il nome accessibile dal contenuto con `aria-labelledby` (tempo, titolo, riga dei chip) e mostra l'anello di focus sullo pseudo-elemento. Così il titolo resta un'intestazione navigabile e non c'è markup non valido (intestazioni e badge dentro un pulsante), fix della code review.
- **In alto a destra**, sopra il pulsante esteso (`z-10`): se la ricetta è bloccata l'etichetta `Bloccata` con icona `Ban` in `tomato`, senza ★; altrimenti il pulsante ★ da 44 × 44 px con `aria-pressed` e `aria-label` `Aggiungi {titolo} ai preferiti` / `Rimuovi {titolo} dai preferiti`.

Limite noto: la sovrapposizione tra il pulsante esteso, la ★ e l'etichetta `Bloccata` è verificata solo in jsdom, che non ha layout; va controllata su un telefono ([[e2-libreria-preferenze]]).

## Test

- `tests/app/library-page.test.tsx` (node, `next/server` e servizi mockati): `connection()`, i due servizi, `LibraryScreen` con `initialRecipes` e `persons`.
- `tests/ui/library-screen.test.tsx` (client mockati, card costruite dalle fixture con `toLibraryCard`): libreria vuota, ricerca per titolo e per ingrediente con conteggio, nessun risultato e `Azzera filtri`, bloccate nascoste e mostrate da sole, titolo come intestazione di livello 3 fuori dai pulsanti, ordine delle preferite, ★ ottimistica con secondo tocco ignorato e ripristino in caso d'errore, apertura del dettaglio con quantità scalate su `persons`, blocco dal dettaglio, risposta tardiva della ★ che non sovrascrive un voto né rimette preferita una ricetta bloccata.
- `tests/ui/library-filters.test.tsx`: testo, riga rapida, apertura del pannello, chip del pannello, contatore `Filtri · 2`.
- `tests/ui/shell.test.tsx`: il test della Libreria monta ora `LibraryScreen` con una card delle fixture.

## Vedi anche

- [[library-service]] — `listLibraryCards` e le funzioni pure di filtro e ordinamento
- [[recipe-detail-sheet]] — Dettaglio aperto dalla card
- [[prefs-service]] — `putRecipePref` e regola "bloccare toglie dalle preferite"
- [[chip-filter]] — Chip della riga rapida e del pannello
- [[empty-state]] — Stati vuoti della Libreria
- [[toast]] — Conferme ed errori della schermata
- [[shell-navigation-pattern]] — Tab Libreria nella shell
- [[e2-libreria-preferenze]] — Panoramica della Feature 5
