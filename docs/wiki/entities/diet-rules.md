---
title: Diete per Regola e Similarità dei Titoli Offline — deriveDietFlags e titleSimilarity (diet-rules)
type: entity
created: 2026-10-26
updated: 2026-10-26
tags: [domain, pure-functions, diet-flags, ingredients, title-similarity, trigrams, pg-trgm, recipe-pack, feature-10]
---

## File e Responsabilità

- **Percorsi file** (nuovi, Feature 10):
  - `lib/domain/diet-rules.ts`: `deriveDietFlags` e `toIngredientFactsMap`, le esigenze alimentari di una ricetta ricavate dalla tabella degli ingredienti.
  - `lib/domain/title-similarity.ts`: `titleTrigrams`, `titleSimilarity`, `areTitlesSimilar` e `SIMILAR_TITLE_THRESHOLD`, la similarità a trigrammi dei titoli senza database.
- **Scopo**: due regole pure che servono al pacchetto iniziale di ricette ([[f10-pacchetto-ricette]]). Le usano `build`, `select` e il test del file del pacchetto ([[recipe-pack-tools]], [[recipe-pack]]).
- **Confine**: moduli di dominio, senza DB né LLM. Dalla Feature 10 il lint lo impone a tutto `lib/domain/**` ([[single-source-of-truth-types]]). I tipi usati (`DietFlag`, `PackIngredientFactDraft`) stanno in `types.ts` ([[domain-types]]).

## `deriveDietFlags` (`diet-rules.ts`)

```ts
export type IngredientFactsMap = ReadonlyMap<string, PackIngredientFactDraft>;

export function toIngredientFactsMap(facts: readonly PackIngredientFactDraft[]): Map<string, PackIngredientFactDraft>;
export function deriveDietFlags(
  ingredients: readonly { canonical_name: string }[],
  facts: IngredientFactsMap
): DietFlag[];
```

`toIngredientFactsMap` indicizza la tabella per nome canonico normalizzato (`normalizeCanonicalName`). `deriveDietFlags` cerca la voce di ogni ingrediente e calcola:

| Dieta | Regola |
|---|---|
| `pescetariano` | nessun ingrediente con `carne` |
| `vegetariano` | nessuno con `carne` né `pesce` |
| `vegano` | vegetariana e nessuno con `latticini`, `uova` né `miele` |
| `senza-lattosio` | nessuno con `latticini` |
| `senza-glutine` | nessuno con `glutine` |

- **Contano anche gli ingredienti *q.b.***: la farina per infarinare toglie `senza-glutine` (spec §4.2). È la scelta prudente.
- **Un nome senza voce è un errore** (`Ingrediente senza voce nella tabella: <nome>`), non un "no": una dieta sbagliata in un filtro vincolante è più grave di una costruzione che si ferma.
- Il risultato è nell'ordine di `DIET_FLAG_VALUES` e coerente con le implicazioni di `expandDietFlags` (vegano ⇒ vegetariano ⇒ pescetariano; vegano ⇒ senza lattosio).

**Perché per regola** (spec D6): le diete sono filtri vincolanti del planner e della Libreria. Con parole chiave nel codice un ingrediente non previsto, come la 'nduja, darebbe un «vegetariano» sbagliato; con le diete del modello il filtro sarebbe probabilistico. La tabella la scrive in bozza il modello e la rivede l'utente una volta ([[recipe-pack-tools]]).

**Due fonti di diete** (architecture review P3): le ricette generate e chieste prendono ancora le diete dal modello (`expandDietFlags` ne garantisce la coerenza interna, non la correttezza); solo quelle del pacchetto le hanno per regola. Estendere la regola alle ricette generate richiede di gestire i nomi senza voce.

## Similarità dei titoli (`title-similarity.ts`)

```ts
export const SIMILAR_TITLE_THRESHOLD = 0.6;
export function titleTrigrams(text: string): Set<string>;
export function titleSimilarity(a: string, b: string): number;
export function areTitlesSimilar(a: string, b: string): boolean; // titleSimilarity > 0.6
```

Reimplementa offline la misura di `pg_trgm`, perché gli strumenti del pacchetto non aprono il DB:
- testo in minuscolo **senza accenti** (`normalize('NFD')` e rimozione dei segni);
- parole di lettere e cifre, ciascuna con due spazi prima e uno dopo, da cui i trigrammi;
- similarità = |A ∩ B| / |A ∪ B| dei due insiemi; 0 se entrambi vuoti.

La soglia è **strettamente maggiore** di 0,6, come `findSimilarRecipeTitle` (`similarity(...) > threshold`) e `TITLE_SIMILARITY_THRESHOLD` di `recipe-repo.ts`, che il commento della costante richiama (requirements P4 e P5; la spec diceva «≥ 0,6»). La regola sta in un modulo nuovo perché il dominio non importa da `lib/db/`.

Chi la usa:
- `select` scarta un candidato con titolo simile a uno già scelto;
- `build` e `tests/fixtures-data/recipe-pack.test.ts` rifiutano due titoli simili nel pacchetto.

Al caricamento, invece, decide `pg_trgm` sul DB ([[recipe-pack]]). Le due misure possono differire: `pg_trgm` non toglie gli accenti, e come tratta le lettere accentate dipende dalla locale del cluster. La differenza può far saltare all'avvio una ricetta in più; per questo `tests/recipes/pack/load.test.ts` carica il pacchetto vero sul Postgres reale e nomina i titoli saltati (review R1).

## Test

- `tests/domain/diet-rules.test.ts`: un attributo alla volta con il risultato atteso, nell'ordine di `DIET_FLAG_VALUES`; tutte le 64 combinazioni dei sei attributi danno un insieme chiuso rispetto a `expandDietFlags`; un ingrediente *q.b.* con glutine; nome con maiuscole e spazi in più; nome assente che lancia l'errore con il nome normalizzato.
- `tests/domain/title-similarity.test.ts`: trigrammi con gli spazi, maiuscole e accenti ignorati, testo senza lettere, indice di Jaccard, titoli identici, titoli vuoti, soglia 0,6, titolo con una parola in più simile, titoli diversi.

## Vedi anche

- [[f10-pacchetto-ricette]] — Panoramica della Feature 10
- [[recipe-pack-tools]] — `select` e `build`, che usano le due regole
- [[recipe-pack]] — Tabella degli ingredienti e caricamento con `pg_trgm`
- [[recipe-repo]] — `findSimilarRecipeTitle`, la misura sul DB
- [[domain-types]] — `DIET_FLAG_VALUES`, `PackIngredientFactDraft`, `expandDietFlags`
- [[courses]] — Le altre regole derivate (portate, etichette)
