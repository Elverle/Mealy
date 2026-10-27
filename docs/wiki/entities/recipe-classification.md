---
title: Classificazione delle Ricette Esistenti — classifyPendingRecipes, Avvio e Script (recipe-classification)
type: entity
created: 2026-10-21
updated: 2026-10-27
tags: [recipes, llm, classification, courses, style-tags, startup, instrumentation, script, batches, feature-8, feature-10, feature-11]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/recipes/classify.ts` (nuovo): `classifyPendingRecipes`, il servizio che assegna portate ed etichette di stile alle ricette senza portata.
  - `instrumentation.ts`: dopo un bootstrap riuscito avvia la classificazione in background ([[db-bootstrap]]).
  - `scripts/classify-recipes.ts` (nuovo) con il comando `pnpm recipes:classify` in `package.json`: lo stesso procedimento lanciato a mano.
  - Parti usate da altri moduli: `classifyRecipes` e i prompt di classificazione in `lib/llm/` ([[llm-adapter]]); `listUnclassifiedRecipes` e `setRecipeClassification` in `lib/db/repositories/recipe-repo.ts` ([[recipe-repo]]); `deriveStyleTags` e `normalizeCourses` in `lib/domain/courses.ts` ([[courses]]).
- **Scopo**: le ricette salvate prima della Feature 8 non hanno portata (`courses` vuoto). Il modello le classifica una volta, senza interventi a mano e senza interfaccia: niente pulsanti, avvisi o contatori (spec FR-4.8). Sul Raspberry non si lancia `pnpm` (`docs/DEPLOY.md §1`), quindi in produzione la classificazione la fa l'app all'avvio (spec D4).
- **Confine LLM**: il servizio sta in `lib/recipes/`, l'unico modulo che chiama `lib/llm/`. `instrumentation.ts` importa il servizio, non l'adapter.

## `classifyPendingRecipes(deps?)`

```ts
export interface ClassifyDeps {
  householdId?: string;                        // default: singleton
  model?: GenerateRecipesOptions['model'];
  classify?: typeof classifyRecipes;           // default: l'adapter
  batchSize?: number;                          // default: CLASSIFY_BATCH_SIZE (10)
  logger?: Pick<Console, 'log' | 'warn'>;      // default: console
}

export interface ClassifyReport {
  pending: number;         // non classificate trovate all'inizio
  classified: number;      // scritte da questa esecuzione
  remaining: number;       // pending - classified
  failedBatches: number;
  notConfigured: boolean;  // il modello non è configurato: nessuna chiamata
}
```

Passi:

1. **Controllo di `batchSize`**: deve essere un intero tra 1 e `CLASSIFY_BATCH_SIZE`, altrimenti `RangeError` prima di qualunque lettura. Il piano parlava solo di un default; il controllo è stato aggiunto nell'implementazione ed è una differenza accettata.
2. **Lettura**: `loadHousehold(deps.householdId)` (senza id è il singleton, creato se manca) e `listUnclassifiedRecipes(db, household.id)`, dalla ricetta meno recente. L'household si può iniettare perché i test girano in parallelo sullo stesso DB, ognuno con il suo household (requirements P13).
3. **Niente da fare**: con zero ricette scrive `[classify] nessuna ricetta da classificare` e non risolve il modello. Uno stack appena installato o senza chiave non logga "modello non configurato" se non c'è nulla da classificare (requirements P12). Un avvio con tutto già classificato fa quindi una sola query.
4. **Modello**: `deps.model ?? getModel()`. Un `LlmError` con codice `config` produce `[classify] modello non configurato (<motivo>): N ricette restano senza portata` (`warn`) e un rapporto con `notConfigured: true`, senza chiamate. Le ricette non classificate restano ammesse nel piano, quindi l'app funziona normalmente (spec FR-4.5). Gli altri errori risalgono.
5. **Lotti in sequenza**, mai in parallelo: sul Raspberry 26 ricette sono 3 chiamate una dopo l'altra (spec §5). Ogni ricetta del lotto riceve un riferimento `r1`…`r10`. Il modello vede titolo, descrizione, pasti, etichette attuali e nomi degli ingredienti (normalizzati e senza doppioni). Un lotto che fallisce (timeout, rete, risposta non valida dopo la riparazione) scrive `[classify] lotto i/n non classificato: <codice>: <messaggio>` (`warn`), conta in `failedBatches` e si salta: le sue ricette si riprovano all'esecuzione successiva (FR-4.4).
6. **Scrittura riga per riga**, senza una transazione unica. Si scartano le righe con riferimento sconosciuto, quelle con un riferimento già visto (vince la prima) e quelle con portate vuote dopo `normalizeCourses`. Per le altre:
   - portate = `normalizeCourses(row.courses)`;
   - etichette = `deriveStyleTags([...etichette attuali, ...row.style_tags], portate, ingredienti)`. Le etichette del modello si **aggiungono**: nessuna viene tolta, tranne quelle che correggono le regole derivate (per esempio `piatto-unico` su una ricetta classificata `secondo`). Dalla Feature 11 la chiamata è `deriveStyleTags([...etichette attuali, ...row.style_tags], ingredienti)`: l'etichetta `piatto-unico` non esiste più e l'unica regola derivata è quella dei pochi ingredienti;
   - `setRecipeClassification`, che scrive solo se la ricetta è ancora non classificata.
7. **Fine**: `[classify] classificate: X, rimaste: Y` e il rapporto.

Le righe di log sono quelle che `docs/DEPLOY.md` §5 e §9 citano nella tabella delle verifiche e nei problemi frequenti. Il prefisso `[classify]` segue quello di `[bootstrap]`. Log e caso "modello non configurato" stanno nel servizio, non in `instrumentation.ts`, così avvio e script stampano le stesse righe (requirements P11).

### Concorrenza e idempotenza

- La scrittura condizionata (`cardinality(courses) = 0`) basta: due avvii ravvicinati, o una ricetta salvata nel frattempo con le sue portate, non producono conflitti. Una ricetta classificata mentre il suo lotto era in corso non viene sovrascritta (test dedicato).
- Le etichette sono calcolate su quelle lette prima della chiamata al modello. Nell'app nessun percorso modifica le etichette di una ricetta esistente, quindi non si perdono aggiornamenti (architecture review, "Aree senza problemi").

## Chiamata al Modello (`classifyRecipes`)

`classifyRecipes(items, options?)` di `lib/llm/adapter.ts` accetta da 1 a `CLASSIFY_BATCH_SIZE` voci (altrimenti `RangeError` senza chiamare il modello). Usa lo stesso percorso "chiamata + una riparazione" della generazione (`runStructuredCall`), a temperatura 0,2 in entrambe le chiamate, con lo schema `ClassifyRecipesOutputSchema`. Restituisce le righe così come le dà il modello: lo scarto delle righe inutili spetta a `classifyPendingRecipes`. Prompt, schema e timeout sono in [[llm-adapter]].

Lo schema di output non impone `.min(1)` sulle portate: una riga vuota si scarta senza invalidare il lotto. Un valore fuori elenco, invece, fa fallire lo schema e porta alla riparazione (requirements P9).

## Avvio in Produzione (`instrumentation.ts`)

Dentro `register()`, solo con `NEXT_RUNTIME === 'nodejs'` e `DB_BOOTSTRAP_ON_START === 'true'`:

1. `runDbBootstrap()` e la riga `[bootstrap] migrazioni applicate; …`, come dalla Feature 7;
2. `import('./lib/recipes/classify')` dinamico, poi `void classifyPendingRecipes().catch(…)`: la partenza **non aspetta** la classificazione e il server accetta richieste subito;
3. un errore della classificazione, o del suo import, scrive `[classify] classificazione interrotta` con l'errore e **non** chiama mai `process.exit`.

Se il bootstrap fallisce, la classificazione non parte e il processo esce con codice 1 come prima.

**Dalla Feature 10** tra il passo 1 e il passo 2 c'è il caricamento del pacchetto iniziale di ricette, **atteso** (`await loadRecipePack()`, [[recipe-pack]]). La classificazione parte dopo, anche se il caricamento è fallito. Le ricette del pacchetto hanno sempre almeno una portata, quindi non sono mai tra quelle da classificare (spec FR-3.6 della Feature 10): su un'installazione nuova la classificazione scrive `[classify] nessuna ricetta da classificare`. In sviluppo e nei test `register()` resta inerte: lì la classificazione si lancia con `pnpm recipes:classify` (spec FR-4.7).

Il servizio importa `@/lib/db`, quindi dalla Feature 8 l'hook di avvio carica il pool dell'app. Per non rischiare un secondo pool, nel caso in cui Next carichi il modulo da due grafi diversi, `lib/db/index.ts` salva il client in `globalThis` anche in produzione (proposta P4 della review). Prima lo faceva solo fuori dalla produzione, per l'HMR ([[database-architecture]]).

Effetto collaterale: su un database appena creato, `loadHousehold()` crea l'household di default già all'avvio, non più alla prima richiesta. Il risultato è lo stesso: la riga c'è, senza onboarding.

## Comando Manuale (`pnpm recipes:classify`)

`scripts/classify-recipes.ts` carica `.env.local` e `.env` con `process.loadEnvFile`. La funzione d'ingresso è `runClassification` (il piano non le dava un nome). Importa in modo dinamico `@/lib/db` e il servizio, perché `DATABASE_URL` va letto dopo il caricamento dei file. Chiama `classifyPendingRecipes()` sul singleton del database di `DATABASE_URL` e stampa:

```
Classificazione completata — trovate: N, classificate: X, rimaste: Y, lotti falliti: Z
```

Codice d'uscita (requirements P24):
- `1` se restano ricette e il modello non è configurato;
- `1` per un errore inatteso (`Classificazione fallita:` con l'errore);
- `0` negli altri casi, anche con lotti falliti per rete: si rilancia il comando.

Chiude sempre la connessione nel `finally`. Serve una chiave API del provider attivo.

## Test

- `tests/recipes/classify.test.ts` (DB reale, `classify` finto iniettato): 23 ricette in lotti da 10, 10 e 3, in sequenza; etichette conservate e aggiunte; `piatto-unico` tolto a una ricetta classificata `secondo` (caso rimosso nella Feature 11, con l'etichetta); un lotto fallito lascia non classificate solo le sue ricette; motivo di un errore generico nel log; righe con riferimento sconosciuto, ripetuto o con portate vuote ignorate; nessuna sovrascrittura di una ricetta classificata nel frattempo; modello non configurato senza chiamate e con `notConfigured`; nessuna ricetta in attesa senza risolvere il modello; `batchSize` fuori da 1..10 rifiutato prima di chiamare il modello.
- `tests/instrumentation.test.ts` (servizio mockato): una sola classificazione dopo un bootstrap riuscito; l'avvio non la aspetta; un errore viene scritto nel log senza uscire; nessuna classificazione se il bootstrap fallisce o fuori dal bootstrap di produzione.
- `tests/db/recipe-classification-repo.test.ts`: le due funzioni del repository ([[recipe-repo]]).
- `tests/llm/adapter.test.ts` e `tests/llm/prompts.test.ts`: `classifyRecipes` e i prompt ([[llm-adapter]]).

Non coperto dai test automatici: la classificazione con un modello reale e lo stack di produzione. Sono verifiche manuali di chiusura (`requirements.md` §5, punti 2 e 3).

## Vedi anche

- [[f8-portate-etichette]] — Panoramica della Feature 8
- [[courses]] — `deriveStyleTags`, `normalizeCourses`
- [[llm-adapter]] — `classifyRecipes`, prompt di classificazione, `runStructuredCall`
- [[recipe-repo]] — `listUnclassifiedRecipes`, `setRecipeClassification`
- [[db-bootstrap]] — Hook di avvio che lancia la classificazione
- [[e6-deploy]] — Produzione sul Raspberry
- [[recipe-pack]] — Feature 10: il pacchetto caricato prima della classificazione
- [[f11-composizione-pasto]] — Feature 11: `deriveStyleTags` senza la portata
