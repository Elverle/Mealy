---
title: Preferenze — Regole Pure, Servizio, API e Client (prefs-service)
type: entity
created: 2026-10-05
updated: 2026-10-05
tags: [preferences, recipe-prefs, ingredient-prefs, domain, pure-functions, service, api-route, client-fetch, row-lock, feature-5]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/domain/prefs.ts`: regole **pure** delle preferenze (default, applicazione di un aggiornamento parziale, conteggio d'impatto, validazione del nome di un giudizio). Importabile dai componenti client.
  - `lib/prefs/service.ts`: servizio **solo lato server** (`updateRecipePref`, `listIngredientPrefs`, `setIngredientPref`).
  - `lib/prefs/ingredient-prefs.ts`: `loadIngredientPreferences`, punto di lettura condiviso delle preferenze ingrediente per planner e generazione (solo server; esiste dalla Feature 4, reale dalla Feature 5).
  - `lib/prefs/client.ts`: funzioni fetch `putRecipePref` e `putIngredientPref`, costruite su `requestJson` di [[http-helpers]].
  - `app/api/recipes/[id]/pref/route.ts`, `app/api/ingredient-prefs/route.ts`, `app/api/ingredient-prefs/[canonicalName]/route.ts`: route handler HTTP.
- **Scopo**: salvare i giudizi sulla ricetta (voto 1–5, preferita, bloccata) e sull'ingrediente (`like` / `dislike` sul nome canonico) e farli arrivare a planner e generazione LLM.
- **Regola vincolante** (`plan.md` §0.3.6, requirements U2): nessuna funzione di questi moduli tocca i piani né `households.updated_at`, e nessuna chiama `lib/plans/service.ts`. Un giudizio vale dalla selezione successiva.
- **Confine client/server**: i componenti `"use client"` importano da `lib/prefs/` **solo** `client.ts`; mai `service.ts` né `ingredient-prefs.ts`. Nessun barrel.

## Funzioni Pure (`lib/domain/prefs.ts`)

```ts
export interface RecipePrefFields { rating: number | null; favorite: boolean; blocked: boolean; }

export function defaultRecipePref(recipeId: string): RecipePref;
export function applyRecipePrefPatch(
  current: Pick<RecipePref, 'rating' | 'favorite' | 'blocked'> | null,
  patch: UpdateRecipePrefRequest
): RecipePrefFields;
export function countRecipesByIngredient(recipes: readonly Recipe[]): Map<string, number>;
export function parseIngredientPrefName(raw: string): string | null;
```

- **`defaultRecipePref`**: preferenze di una ricetta senza riga in `recipe_prefs` (`rating: null`, `favorite` e `blocked` `false`, `times_used: 0`, `last_used_at: null`).
- **`applyRecipePrefPatch`**: applica un aggiornamento parziale.
  - `rating`: quello del patch se presente (anche `null`, che toglie il voto), altrimenti quello corrente;
  - `blocked`: quello del patch, altrimenti quello corrente;
  - `favorite`: **`false` se il risultato è bloccato**, altrimenti quello del patch o quello corrente.

  Conseguenze: preferire una ricetta bloccata non ha effetto; bloccare una preferita la toglie dalle preferite; sbloccare non rimette la preferita. La stessa funzione serve il server e gli aggiornamenti ottimistici del client ([[recipe-detail-sheet]], [[plan-screen]]), così non possono divergere (requirements P7).
- **`countRecipesByIngredient`**: per ogni nome canonico, quante ricette **non bloccate** lo contengono. Una ricetta conta una volta anche se ripete l'ingrediente; i nomi sono quelli di `recipeIngredientNames` ([[library-service]]), quindi `" Cipolla "` e `cipolla` sono lo stesso nome. È l'**impatto** mostrato prima di scartare un ingrediente.
- **`parseIngredientPrefName`**: unica validazione del nome di un giudizio, usata da rotta e servizio. Normalizza con `normalizeCanonicalName` (trim, minuscolo, spazi compressi: tabulazioni e a capo diventano spazi) e restituisce `null` se il risultato è vuoto, più lungo di `INGREDIENT_NAME_MAX` (80) o contiene caratteri di controllo (`U+0000`–`U+001F`, `U+007F`). Un `%` è ammesso (es. `cioccolato 70%`).

## Servizio (`lib/prefs/service.ts`)

```ts
export async function updateRecipePref(recipeId: string, patch: UpdateRecipePrefRequest, householdId?: string): Promise<RecipePref | null>;
export async function listIngredientPrefs(householdId?: string): Promise<IngredientPrefsView>;
export async function setIngredientPref(canonicalName: string, pref: IngredientPref | null, householdId?: string): Promise<SetIngredientPrefResult>;
```

### `updateRecipePref`
In **una transazione**:
1. `recipeBelongsToHousehold` falsa → `null`, senza scritture (la rotta risponde 404);
2. `ensureRecipePrefRow`: crea la riga di default se manca. Senza riga `SELECT … FOR UPDATE` non blocca nulla, e due prime scritture concorrenti perderebbero un aggiornamento (fix della code review);
3. `lockRecipePref`: legge la riga bloccandola;
4. `applyRecipePrefPatch(current, patch)` e `writeRecipePref`, che scrive solo `rating`, `favorite`, `blocked`.

`times_used` e `last_used_at` non vengono toccati: li aggiorna solo `incrementRecipeUsage` alla conferma del piano ([[plan-repo]]), quindi giudizi e conferme non si sovrascrivono. Le funzioni di repository sono in [[recipe-repo]].

### `listIngredientPrefs`
Righe di `ingredient_prefs` ([[ingredient-pref-repo]]) con l'impatto di ciascuna, divise in `likes` e `dislikes`, ognuna in ordine alfabetico italiano. Un giudizio su un nome che nessuna ricetta contiene ha `recipes_count: 0`. È la lettura della pagina `/impostazioni` ([[ingredient-prefs-section]]).

### `setIngredientPref`
`parseIngredientPrefName` (nome non valido → `RangeError('canonical_name non valido')`), poi `upsertIngredientPref` oppure, con `pref: null`, `deleteIngredientPref`; rimuovere un giudizio che non esiste non è un errore. Restituisce `{ canonical_name, pref, recipes_count }` con il conteggio ricalcolato.

Limiti noti:
- **gli alias non si risolvono** e il nome non viene confrontato con la libreria: si può salvare un giudizio su un nome che non compare in nessuna ricetta. Lasciato così per la v1 ([[e2-libreria-preferenze]]);
- `listIngredientPrefs` e `setIngredientPref` leggono **l'intera libreria** per calcolare i conteggi (`listRecipes`), come [[library-service]]; il commento in testa al file indica il rimedio (conteggio in SQL su `recipe_ingredients_canonical_name_idx`).

## Lettura per Planner e Generazione (`lib/prefs/ingredient-prefs.ts`)

```ts
export async function loadIngredientPreferences(
  householdId: string,
  executor: DbExecutor = db
): Promise<IngredientPreferenceSets>;
```

Legge `ingredient_prefs` e costruisce gli insiemi `likes` / `dislikes` con `toIngredientPreferenceSets` ([[planner]]). Firma invariata rispetto alla Feature 4, dove restituiva insiemi vuoti. La chiamano:
- `lib/plans/service.ts` ([[plan-service]]), fuori dal lock e di nuovo **dentro** con la transazione: un 👎 salvato durante una generazione lunga è visto dalla selezione finale ([[plan-concurrency-pattern]]);
- `lib/recipes/generate.ts` ([[recipe-generation]]), prima della chiamata LLM per i vincoli del prompt e di nuovo dentro la transazione di salvataggio per il controllo delle violazioni.

Effetto sul planner, senza modifiche all'algoritmo: uno scarto è un'esclusione dura (`exclusionReason` → `'disliked_ingredient'`), un gradimento moltiplica il peso (`ingredientAffinity`, `1 + 0.15 × min(2, n)`). Il confronto è sul nome canonico esatto (decisione D1).

## API HTTP

Tutte le rotte hanno `runtime = 'nodejs'` e `dynamic = 'force-dynamic'`; gli errori imprevisti si loggano con il tag (`[api/recipes/pref]`, `[api/ingredient-prefs]`, `[api/ingredient-prefs/name]`) e diventano `internalErrorResponse()` ([[http-helpers]]).

| Metodo e rotta | Input | Successo | Errori |
|---|---|---|---|
| `PUT /api/recipes/:id/pref` | `{ rating?: 1–5 \| null, favorite?: boolean, blocked?: boolean }`, strict, **almeno un campo** | 200 `{ prefs: RecipePref }` | 400 `invalid_request` (body vuoto o non JSON; validazione con `details`); 404 `recipe_not_found` (id non UUID, ricetta inesistente o di un altro household); 500 |
| `GET /api/ingredient-prefs` | — | 200 `IngredientPrefsView` (`{ likes, dislikes }`) | 500 |
| `PUT /api/ingredient-prefs/:canonicalName` | `{ pref: 'like' \| 'dislike' \| null }`, strict (`null` = rimuovi) | 200 `SetIngredientPrefResult` (`{ canonical_name, pref, recipes_count }`) | 400 `invalid_request` (nome non valido, body vuoto, `pref` sconosciuto); 500 |

Note sulla rotta `[canonicalName]`:
- la rotta tratta il parametro come **già decodificato** (così lo consegna Next, come annota il commento nel codice) e non lo decodifica una seconda volta: `a%20b` resta `a%20b` e `cioccolato 70%` passa invariato. È un fix della code review rispetto alla `decodeParam` prevista dal piano. I test chiamano l'handler direttamente, non attraverso il router di Next;
- il nome passa da `parseIngredientPrefName` prima di leggere il body: solo spazi, più di 80 caratteri o un carattere di controllo danno 400 invece di un errore di Postgres;
- la risposta riporta il nome **normalizzato** e il conteggio aggiornato (accettazione di S2.3).

`GET /api/ingredient-prefs` non ha consumatori nell'interfaccia v1: la sezione *I miei ingredienti* riceve i dati dalla pagina server.

## Client (`lib/prefs/client.ts`)

```ts
export async function putRecipePref(recipeId: string, patch: UpdateRecipePrefRequest): Promise<RecipePref>;       // PUT /api/recipes/{id}/pref → .prefs
export function putIngredientPref(canonicalName: string, pref: IngredientPref | null): Promise<SetIngredientPrefResult>; // PUT /api/ingredient-prefs/{nome}
```

Entrambe codificano il segmento con `encodeURIComponent` (`cipolla rossa` → `/api/ingredient-prefs/cipolla%20rossa`), validano la risposta con lo schema Zod e lanciano `ApiRequestError` così com'è. `fetchIngredientPrefs`, prevista dal piano, non esiste (proposta R6 della review architetturale).

## Test

- `tests/domain/prefs.test.ts` (puro): default, le conseguenze di `applyRecipePrefPatch`, conteggi (bloccate escluse, ingrediente ripetuto, normalizzazione), `parseIngredientPrefName` (80 e 81 caratteri, vuoto, caratteri di controllo, tabulazioni, `%`).
- `tests/domain/library-contracts.test.ts`: `UpdateRecipePrefRequestSchema` e `SetIngredientPrefRequestSchema`.
- `tests/prefs/service.test.ts` (DB reale): aggiornamenti parziali in sequenza, blocco di una preferita, `times_used` invariato, riga creata se manca, **due prime scritture concorrenti senza perdite**, ricetta di un altro household, normalizzazione e conteggio dei giudizi, rimozione, nomi non validi, liste alfabetiche, isolamento tra household.
- `tests/prefs/ingredient-prefs.test.ts` (DB): insiemi letti dal DB, transazione come `executor`, isolamento tra household, test statistico del gradimento (4000 estrazioni, rapporto tra 1.15 e 1.45, atteso 1.3).
- `tests/prefs/planner-integration.test.ts` e `tests/plans/ingredient-prefs.test.ts` (DB): ricetta bloccata e ingrediente scartato mai presenti in 20 piani seedati, con controprova; swap senza alternative → `no_alternatives`.
- `tests/api/recipe-pref.test.ts`, `tests/api/ingredient-prefs.test.ts` (servizio mockato): status e corpi, parametro già decodificato, carattere `NUL`, nome di soli spazi o troppo lungo.
- `tests/prefs/client.test.ts`: URL, metodo, body, codifica del nome, `ApiRequestError`, errore di rete.

## Vedi anche

- [[recipe-detail-sheet]] — Dove si esprimono i giudizi
- [[ingredient-prefs-section]] — Vista d'insieme dei giudizi sugli ingredienti
- [[ingredient-pref-repo]] — Repository di `ingredient_prefs`
- [[recipe-repo]] — `ensureRecipePrefRow`, `lockRecipePref`, `writeRecipePref`
- [[library-service]] — Dettaglio ricetta con giudizio e impatto degli ingredienti
- [[planner]] — `exclusionReason` e `ingredientAffinity`
- [[recipe-generation]] — Scarti e gradimenti nei vincoli di generazione
- [[domain-types]] — DTO delle preferenze
- [[e2-libreria-preferenze]] — Panoramica della Feature 5
