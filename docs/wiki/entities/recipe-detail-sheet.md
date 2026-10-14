---
title: Dettaglio Ricetta con Preferenze — RecipeDetailSheet (recipe-detail-sheet)
type: entity
created: 2026-10-05
updated: 2026-10-14
tags: [ui, components, recipe-detail, preferences, optimistic-update, ingredient-prefs, sheet, primary-action, feature-5, feature-9]
---

## File e Responsabilità

- **Percorso file**: `components/recipes/recipe-detail-sheet.tsx` (`"use client"`)
- **Scopo**: il dettaglio ricetta **unico** per Piano e Libreria (requirements P12). Carica il dettaglio con `GET /api/recipes/:id`, salva le preferenze della ricetta e i giudizi sugli ingredienti in modo ottimistico, mostra l'impatto prima di scartare un ingrediente e avvisa il genitore di ogni cambiamento.
- È il componente "intelligente"; la resa è delegata a `RecipeSheet` ([[recipe-sheet]]), che resta presentazionale. Non mostra toast: passa i messaggi al genitore con `onNotify`.
- Importa solo codice sicuro per il client: `fetchRecipeDetail` ([[library-service]]), `putRecipePref` e `putIngredientPref` ([[prefs-service]]), `apiErrorMessage` ([[http-helpers]]), le funzioni pure `applyRecipePrefPatch` e `defaultRecipePref`.

## Interfaccia

```ts
/** Campi di una preferenza ricetta che un salvataggio può aver cambiato. */
export type RecipePrefChanges = Partial<Pick<RecipePref, "rating" | "favorite" | "blocked">>;

export interface RecipeDetailSheetProps {
  recipeId: string | null;          // null = sheet chiusa
  servings: number;                 // porzioni su cui scalare le quantità all'apertura
  initialRecipe?: Recipe | null;    // ricetta già nota a chi chiama (Piano): si mostra subito
  onClose: () => void;
  onRecipePrefsChange?: (recipeId: string, changed: RecipePrefChanges) => void;
  onNotify: (message: string) => void;   // conferme ed errori, da mostrare come toast
  blockedMessage?: string;          // sostituisce il messaggio dopo "Non proporre più"
  primaryAction?: { label: string; onAction: (recipeId: string) => void; busy?: boolean };  // Feature 9
}
```

| Chi lo usa | `servings` | `initialRecipe` | `blockedMessage` | `primaryAction` |
|---|---|---|---|---|
| [[plan-screen]] | porzioni dello slot | ricetta dello slot | `Non la proporrò più. In questo piano resta: usa Cambia per sostituirla.` | assente |
| [[library-screen]] | persone dell'household | assente | assente (messaggio di default) | assente |
| [[slot-recipe-picker]] (Feature 9) | porzioni dello slot | assente | assente | `Metti nel piano`, `busy` durante l'assegnazione |

### Azione primaria (Feature 9)
Con `primaryAction` la sheet passa a `RecipeSheet` un `footer` ([[recipe-sheet]]) con un `Button` a tutta larghezza (`h-12`) e l'etichetta indicata; il clic chiama `onAction(recipe.id)`, `busy` lo disattiva. Il pulsante compare **solo a ricetta caricata**: durante lo scheletro non c'è. Senza `primaryAction` il dettaglio è identico a quello di Piano e Libreria (requirements P17 della Feature 9). Il componente non gestisce l'esito dell'azione: lo fa chi la passa ([[slot-recipe-picker]]).

## Caricamento

Stato: `detail`, `loadState` (`idle` / `loading` / `ready` / `error`), `prefsOverride`, `info` (mappa nome canonico → `RecipeIngredientInfo`), `savingPrefs`, `savingIngredient`. Callback e `initialRecipe` sono letti da ref aggiornati a ogni render, così gli effetti non si rilanciano; `mountedRef` e `currentIdRef` proteggono dagli aggiornamenti tardivi.

L'effetto di apertura dipende **solo** da `recipeId`: azzera `detail`, `prefsOverride` e `info`, poi chiama `fetchRecipeDetail(recipeId)`. La pulizia dell'effetto marca la richiesta come annullata, quindi la risposta di una ricetta sostituita nel frattempo viene ignorata.

- **Successo**: `detail`, `info` costruita da `detail.ingredients`, `loadState = 'ready'`.
- **Errore con `initialRecipe` della stessa ricetta** (Piano): `loadState = 'error'`, `onNotify('Non riesco a caricare le preferenze sugli ingredienti.')`; la sheet resta aperta, senza 👍/👎.
- **Errore senza `initialRecipe`** (Libreria): `onNotify(apiErrorMessage(err))` e `onClose()`.

Cosa si mostra:
- la ricetta è `detail.recipe` se è quella richiesta, altrimenti `initialRecipe` se è quella richiesta, altrimenti nulla: non compare mai un frame con la ricetta precedente;
- le preferenze sono `prefsOverride` (se riguarda la ricetta mostrata), altrimenti `recipe.prefs`;
- la vista è `toRecipeDetail({ ...recipe, prefs }, servings, info)`; `info` si passa solo con `loadState === 'ready'`, quindi 👍/👎 compaiono quando il dettaglio è arrivato;
- `RecipeSheet` riceve `isLoading` quando la sheet è aperta ma non c'è ancora una vista: in Libreria si vede lo scheletro, nel Piano la ricetta è visibile subito con la barra azioni già attiva (requirements P13).

## Preferenze della Ricetta

`savePrefs(patch)` non fa nulla se un salvataggio è già in corso. Altrimenti:

1. aggiornamento ottimistico: `prefsOverride = { ...base, ...applyRecipePrefPatch(previous, patch) }`, con `base` = preferenze correnti o `defaultRecipePref(id)`;
2. `putRecipePref(id, patch)`, con la barra azioni disabilitata (`actionsDisabled`);
3. **successo**: `onRecipePrefsChange(id, changed)` **sempre**, anche se nel frattempo la sheet mostra un'altra ricetta; se mostra ancora la stessa, `changed` si fonde in `prefsOverride`; poi il toast: `blockedMessage ?? 'Non la proporrò più.'` dopo un blocco, `La ricetta torna tra le proposte.` dopo uno sblocco;
4. **errore**: ripristino delle preferenze precedenti e `onNotify(apiErrorMessage(err))`.

`changed` contiene **solo** i campi della richiesta, con i valori salvati, più `favorite` quando la richiesta contiene `blocked` (bloccare toglie dalle preferite). Chi riceve fonde questi campi nel proprio stato: una risposta arrivata in ritardo non sovrascrive un campo cambiato nel frattempo da un altro controllo (proposta R2 della review architetturale, v. [[e2-libreria-preferenze]]).

Handler passati a `RecipeSheet`:
- voto: toccare la stella del voto corrente lo toglie (`{ rating: null }`), un'altra stella lo imposta;
- *Preferita*: `{ favorite: !corrente }`;
- *Non proporre più* / *Sblocca ricetta*: `{ blocked: !corrente }`.

## Giudizi sugli Ingredienti

`handleIngredientPreference(rowId, preference)` riceve `'disliked'` solo a conferma avvenuta: il riquadro di conferma con l'impatto è gestito da `RecipeSheet`.

1. `findRecipeIngredient(recipe, rowId)` e nome normalizzato con `normalizeCanonicalName`; `'liked'` → `like`, `'disliked'` → `dislike`, `null` → rimozione.
2. Aggiornamento ottimistico della voce di `info` (il conteggio resta quello noto), con 👍/👎 e *Conferma esclusione* disabilitati (`ingredientsDisabled`).
3. `putIngredientPref(name, pref)`.
4. **Successo**: la voce diventa la risposta del server (giudizio e `recipes_count` aggiornato). Solo per lo scarto parte il toast `Non proporrò più ricette con {nome}: vale dai prossimi piani.`; 👍 e rimozione non mostrano messaggi.
5. **Errore**: ripristino della voce precedente (o rimozione, se non c'era) e `onNotify(apiErrorMessage(err))`.

Il giudizio riguarda il **nome canonico**, non il nome mostrato: la conferma è titolata con il nome canonico e il toast lo ripete (decisione D1).

## Test

`tests/ui/recipe-detail-sheet.test.tsx` (jsdom, `@/lib/library/client` e `@/lib/prefs/client` mockati):
- caricamento: scheletro e poi titolo con i pollici; `initialRecipe` visibile subito e pollici dopo il dettaglio; errore senza e con `initialRecipe`; risposta di una ricetta sostituita ignorata; nessuna richiesta con `recipeId: null`;
- preferenze: voto e sua rimozione, solo i campi richiesti in `onRecipePrefsChange`, azioni disabilitate durante il salvataggio, blocco con toast di default e con `blockedMessage`, sblocco, ripristino dopo un errore, aggiornamento ottimistico, avviso al genitore anche dopo il passaggio a un'altra ricetta;
- ingredienti: conferma con impatto e salvataggio per nome canonico, titolo con il nome canonico esatto, annullamento senza chiamate, 👍 senza conferma né toast e sua rimozione, ripristino dopo un errore, giudizio già presente, pollici disabilitati durante il salvataggio;
- azione primaria (Feature 9): nessun pulsante senza `primaryAction`; pulsante solo a ricetta caricata con l'id passato al clic; pulsante disattivato con `busy`.

## Vedi anche

- [[recipe-sheet]] — Componente presentazionale e conversione `toRecipeDetail`
- [[library-service]] — `GET /api/recipes/:id` e `fetchRecipeDetail`
- [[prefs-service]] — API e client delle preferenze, `applyRecipePrefPatch`
- [[plan-screen]] — Uso dal Piano, con la ricetta dello slot
- [[library-screen]] — Uso dalla Libreria
- [[toast]] — Dove finiscono i messaggi di `onNotify`
- [[e2-libreria-preferenze]] — Panoramica della Feature 5
- [[slot-recipe-picker]] — Uso dal selettore del Piano, con *Metti nel piano* (Feature 9)
- [[f9-ricette-su-richiesta]] — Panoramica della Feature 9
