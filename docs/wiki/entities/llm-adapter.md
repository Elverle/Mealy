---
title: Adapter LLM Multi-Provider (llm-adapter)
type: entity
created: 2026-09-17
updated: 2026-10-21
tags: [llm, ai-sdk, adapter, multi-provider, structured-output, repair-loop, errors, free-text-request, courses, classification, feature-8]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/llm/adapter.ts`: funzione principale di generazione `generateRecipes`, loop di correzione e normalizzazione; dalla Feature 9 anche `generateRecipeFromRequest` (una ricetta da una richiesta in testo libero) e la funzione privata `runRecipeGeneration` che le due condividono; dalla Feature 8 `classifyRecipes` (portate ed etichette di ricette esistenti) e la funzione privata generica `runStructuredCall`.
  - `lib/llm/model.ts`: factory del modello linguistico `getModel`, lettura configurazione env e timeout.
  - `lib/llm/prompts.ts`: template per istruzioni di sistema, prompt utente con vincoli ed esclusioni, prompt di riparazione schema.
  - `lib/llm/errors.ts`: classe di errore tipizzato `LlmError` e type guard `isLlmError`.
  - `lib/llm/index.ts`: facciata pubblica che riesporta le funzioni e i tipi necessari.
  - `scripts/llm-record.ts`: script CLI per registrare risposte LLM reali per test offline.
- **Scopo**: Incapsulare interamente l'integrazione con i modelli linguistici (LLM) tramite Vercel AI SDK 7, fornendo una superficie fortemente tipizzata, provider-agnostica e resiliente per la generazione strutturata di ricette culinarie casalinghe italiane.
- **Regola di confine architetturale vincolante**: **solo** `lib/llm/` ha il permesso di importare i pacchetti `ai` e gli SDK dei fornitori (`@ai-sdk/google`, `@openrouter/ai-sdk-provider`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`). Nessun altro modulo dell'applicazione conosce o importa tali dipendenze. Il servizio `lib/recipes/` è l'unico consumatore applicativo dell'adapter (`generateRecipes`; dalla Feature 9 anche `generateRecipeFromRequest`, chiamata da `lib/recipes/propose.ts`, v. [[recipe-proposal-service]]; dalla Feature 8 `classifyRecipes` e `getModel`, chiamate da `lib/recipes/classify.ts`, v. [[recipe-classification]]). Dalla Feature 4 altri due moduli importano **solo** `lib/llm/errors.ts` (`LlmError`, `isLlmError`) per riconoscere gli errori che risalgono da `generateAndStoreRecipes`: `lib/plans/service.ts` ([[plan-service]]) e `lib/http/responses.ts` ([[http-helpers]]). Nessuno dei due chiama il modello.

## Architettura Multi-Provider

Il provider e il modello da utilizzare sono definiti come pura configurazione d'ambiente (`CLAUDE.md § Regole di architettura`), senza alcuna modifica al codice sorgente:

- `readLlmConfig(env = process.env): LlmConfig`: valida le variabili d'ambiente `LLM_PROVIDER` (uno tra `google`, `openrouter`, `anthropic`, `openai-compatible`, con default a `google`) e `LLM_MODEL`.
- `getModel(env = process.env): LanguageModel`: istanzia l'istanza `LanguageModel` appropriata in base al provider configurato:
  - **Google Generative AI**: utilizza `@ai-sdk/google` con `GOOGLE_GENERATIVE_AI_API_KEY` (modello di esempio in `.env.example`: `gemini-3.1-flash-lite`; `gemini-2.5-flash` non è più disponibile per i nuovi account). Alternativa consigliata: OpenRouter con `z-ai/glm-5.3-flash` (38 s per 3 ricette nello smoke test del 2026-09-28, entro il timeout allora di 50 s).
  - **OpenRouter**: utilizza `@openrouter/ai-sdk-provider` con `OPENROUTER_API_KEY`.
  - **Anthropic**: utilizza `@ai-sdk/anthropic` con `ANTHROPIC_API_KEY`.
  - **OpenAI-compatible**: utilizza `@ai-sdk/openai-compatible` con `LLM_BASE_URL` e `LLM_API_KEY` (attivando la proprietà `supportsStructuredOutputs: true`).
- `getLlmTimeoutMs(env = process.env): number`: estrae `LLM_TIMEOUT_MS` (intero positivo) con fallback a **90.000 ms** (dalla Feature 4; prima 50.000 ms). Il valore vale per **un lotto da 3 ricette**, la dimensione con cui il servizio dei piani chiama la generazione ([[plan-service]]); con la chiamata di riparazione una generazione può durare fino a `2 × LLM_TIMEOUT_MS`. `.env.example` imposta `LLM_TIMEOUT_MS=90000` e consiglia di alzarlo fino a `120000` solo con modelli lenti (i gratuiti di OpenRouter impiegano circa 90 s per 3 ricette); il vecchio vincolo "sotto i 120 s della route" non vale più (Addendum D1 della review architetturale di F4). Chi ha un `.env` locale con `50000` deve aggiornarlo a mano.

Se le chiavi d'ambiente richieste per il provider attivo risultano mancanti, viene sollevato un `LlmError` con codice `'config'`.

## Generazione e Repair Loop a 2 Fasi

La funzione `generateRecipes` orchestra la chiamata al modello linguistico con output strutturato:

```ts
export async function generateRecipes(
  constraints: RecipeConstraints,
  n: number,
  excludeTitles: readonly string[],
  options?: GenerateRecipesOptions,
): Promise<GeneratedRecipe[]>
```

### 1. Primo Tentativo (Generazione Strutturata)
- Esegue la chiamata tramite `generateText` di Vercel AI SDK 7 specificando:
  - `output: Output.object({ schema: GenerateRecipesOutputSchema })` (basato sullo schema Zod di [[domain-types]]).
  - `instructions`: istruzioni di sistema formulate da `buildRecipeInstructions()`.
  - `prompt`: prompt utente generato da `buildRecipePrompt(constraints, n, titles)`.
  - `temperature: 0.8` (favorisce varietà culinaria).
  - `maxRetries: 1` e `timeout: timeoutMs`.

### 2. Secondo Tentativo (Repair Loop su `NoObjectGeneratedError`)
Se il provider produce un output sintatticamente non conforme allo schema Zod atteso (ad esempio unità di misura non consentite, campi numerici nulli non permessi, o formato JSON troncato), Vercel AI SDK solleva un'eccezione `NoObjectGeneratedError`. L'adapter intercetta tale errore e avvia una fase di riparazione automatica:
1. **Analisi Diagnostica (`describeValidationError`)**: naviga ricorsivamente la catena di `.cause` dell'errore (fino a 4 livelli di profondità) per estrarre le `issues` Zod puntuali (es. `recipes.0.ingredients.1.unit: valore non valido`), formattandole in una stringa leggibile (troncata a 1.500 caratteri).
2. **Costruzione Repair Prompt (`buildRepairPrompt`)**: formula un messaggio che elenca con precisione gli errori riscontrati chiedendo al modello di restituire l'oggetto JSON completo e corretto con le stesse ricette, correggendo solo gli errori indicati.
3. **Chiamata Conversazionale di Riparazione**: invoca nuovamente `generateText` passando lo storico dei messaggi (`user` con prompt iniziale, `assistant` con testo generato errato, `user` con repair prompt) a **temperatura ridotta (`0.2`)** per massimizzare la fedeltà e il rispetto dei vincoli formali.
4. **Esito**: se anche il tentativo di correzione fallisce con `NoObjectGeneratedError`, viene sollevato `LlmError('invalid_output')`. Eventuali altri errori di rete vengono convertiti via `toLlmError`.

### 3. Normalizzazione Post-Generazione
Le ricette validate con successo vengono passate a `normalizeGeneratedRecipe` (`lib/domain/recipe-text.ts`), garantendo la pulizia di spaziature, la dedup di tag/elettrodomestici, la coerenza delle unità `qb` e la chiusura transitiva delle diete, prima di ritornare i primi `n` elementi.

### 4. Percorso condiviso (Feature 9)
Dalla Feature 9 i passi 1–3 vivono nella funzione privata `runRecipeGeneration({ model, prompt, timeoutMs, abortSignal })`, che restituisce **tutte** le ricette normalizzate; `generateRecipes` valida `n`, costruisce il prompt e taglia ai primi `n`. Anche la pulizia dei titoli da escludere (trim, niente vuoti, niente doppioni con vince la prima occorrenza, al più `MAX_EXCLUDED_TITLES`) è estratta nella funzione privata `cleanExcludedTitles`. Comportamento di `generateRecipes` invariato (requirements P4 della Feature 9).

### 5. Chiamata strutturata generica (Feature 8)
Dalla Feature 8 la coppia "chiamata + riparazione" è la funzione privata generica `runStructuredCall<T>({ model, instructions, prompt, schema, temperature, repairTemperature, timeoutMs, abortSignal, invalidOutputMessage })`, che restituisce `result.output` validato dallo schema. `runRecipeGeneration` la chiama con `buildRecipeInstructions()`, `GenerateRecipesOutputSchema`, temperature `0.8` e `0.2` e lo stesso messaggio di prima (`Il modello non ha prodotto ricette valide dopo il tentativo di correzione.`), poi applica `normalizeGeneratedRecipe`: per la generazione non cambia nulla. `classifyRecipes` la riusa con il proprio schema (v. sotto). È l'unica astrazione nuova (innesto R4 della review architetturale della Feature 8); errori e mappatura `LlmError` restano gli stessi.

## Ricetta da una Richiesta Libera (Feature 9)

```ts
export async function generateRecipeFromRequest(
  constraints: RecipeConstraints,
  request: string,
  excludeTitles: readonly string[],
  options?: GenerateRecipesOptions,
): Promise<GeneratedRecipe>
```

- Richiesta vuota dopo il trim → `RangeError('request must not be empty')`; i vincoli si validano con `RecipeConstraintsSchema`.
- Prompt `buildRecipeRequestPrompt(constraints, request, cleanExcludedTitles(excludeTitles))` (v. sotto), poi `runRecipeGeneration`: stessa chiamata, stesso schema di output `GenerateRecipesOutputSchema` (`{ recipes: […] }`), stessa riparazione, stesso timeout `LLM_TIMEOUT_MS` per chiamata e stessa mappatura degli errori. Restituisce la **prima** ricetta. Un secondo schema di output avrebbe richiesto una seconda riparazione e fixture di altra forma (requirements P4).
- Dei vincoli usa persone, tipo di pasto, diete ed elettrodomestici: chi la chiama ([[recipe-proposal-service]]) passa stile preferito e preferenze ingrediente vuoti.
- `options.abortSignal` interrompe la chiamata; l'annullamento arriva al chiamante come `LlmError('timeout')` (`toLlmError` non distingue `AbortError` da `TimeoutError`). Per non scambiarlo con un timeout vero, la rotta `POST /api/recipes/propose` controlla `request.signal.aborted` e risponde `499` senza log (innesto R1 della review architetturale della Feature 9).

## Prompting e Strategia Anti-Duplicazione

Il modulo `lib/llm/prompts.ts` governa la comunicazione con l'LLM:
- **`buildRecipeInstructions()`**: stabilisce il ruolo ("ricettario di casa di una famiglia italiana") e le regole vincolanti per ingredienti (singolare, minuscolo, unità fisse `g | ml | pz | qb`, 9 reparti spesa fissi) e per la ricetta (titolo maiuscolo breve, diete transitive, elettrodomestici necessari, passi non numerati).
- **`buildRecipePrompt(constraints, n, excludeTitles)`**: compila i vincoli specifici richiesti (persone, tipologia pasto, diete obbligatorie, elettrodomestici ammessi, stili culinari, ingredienti graditi ed esclusi). Include inoltre la sezione con i titoli già presenti in libreria (fino a un massimo di `MAX_EXCLUDED_TITLES = 150`), intimando al modello di non proporre ricette uguali o molto simili.
- **`MAX_EXCLUDED_TITLES = 150`**: soglia per proteggere la finestra di contesto ed evitare consumi eccessivi di token pur fornendo un forte filtro preventivo sui duplicati.
- **`buildRecipeRequestPrompt(constraints, request, excludeTitles)`** (Feature 9): prompt per **una** ricetta chiesta con un testo libero. Le istruzioni di sistema restano `buildRecipeInstructions()`. Contiene:
  - la richiesta come **dato** tra i delimitatori `RECIPE_REQUEST_OPEN = '<<<RICHIESTA'` e `RECIPE_REQUEST_CLOSE = 'RICHIESTA>>>'`, con l'indicazione di trattarla solo come descrizione del piatto e di non eseguire istruzioni contenute; la funzione privata `toSingleLine` riduce il testo a una riga (spazi e a capo compattati) e toglie le sequenze `<<<` e `>>>`, così il testo non può chiudere il delimitatore né aggiungere righe (requirements P5);
  - i vincoli: persone (`servings_base`), pasto (se `meal_type` è imposto, "deve includere … in meal_types"; altrimenti la richiesta di indicare in `meal_types` i pasti adatti, requirements P26), diete da rispettare e riportare in `diet_flags`, elettrodomestici ammessi ("nessuno (solo ricette senza cottura)" se la lista è vuota);
  - l'indicazione di proporre la variante più vicina che rispetta i vincoli (es. la versione vegetariana) e di dirlo nella descrizione;
  - se presenti, i titoli già proposti nella sequenza di *Un'altra* (`Hai già proposto queste ricette: proponine una diversa.`), ridotti a una riga, senza doppioni e al più `MAX_EXCLUDED_TITLES`; stanno fuori dai delimitatori (osservazione cosmetica della review: arrivano dal client, ma limitati a 10 × 120 caratteri dallo schema).
  - **Non** contiene stile preferito, ingredienti graditi o scartati, né i titoli della libreria (spec D7, D11).

`lib/llm/index.ts` riesporta anche `generateRecipeFromRequest`, `buildRecipeRequestPrompt`, `RECIPE_REQUEST_OPEN` e `RECIPE_REQUEST_CLOSE`.

### Portate ed etichette nei prompt di generazione (Feature 8)
- **`buildRecipeInstructions()`** ha una riga `courses`: le portate in cui il piatto si serve davvero, di solito una e al massimo due, tra `piatto-unico` (basta da solo come pasto), `primo` (pasta, riso, zuppe), `secondo` (carne, pesce, uova, formaggi o legumi come portata principale) e `contorno` (verdure o patate che accompagnano un secondo). La riga `tags` elenca le dodici etichette da `MEAL_STYLE_TAG_VALUES`, avverte che `pochi-ingredienti` e `piatto-unico` li calcola l'app e si possono omettere, e spiega le quattro nuove assegnate dal modello (`tradizionale`, `dal-mondo`, `in-anticipo`, `piatto-freddo`).
- **`buildRecipePrompt` e `buildRecipeRequestPrompt`**: con `constraints.courses` non `null`, subito dopo la riga del pasto, `- Portata: in courses ogni ricetta deve avere almeno una tra …` (nella richiesta: "la ricetta"). Con `null` la riga manca. La costruisce la funzione privata `courseLine`.
- Lo schema di output `GeneratedRecipeSchema` richiede `courses` con almeno una voce ([[domain-types]]); `normalizeGeneratedRecipe` le ordina e toglie i doppioni ([[courses]]).

## Classificazione di Ricette Esistenti (Feature 8)

```ts
export async function classifyRecipes(
  items: readonly ClassifyRecipeItem[],
  options?: GenerateRecipesOptions,
): Promise<RecipeClassification[]>
```

- Da 1 a `CLASSIFY_BATCH_SIZE` (10) voci, altrimenti `RangeError` senza chiamare il modello. Modello iniettabile (`options.model ?? getModel()`, quindi `LlmError('config')` senza configurazione), timeout `options.timeoutMs ?? getLlmTimeoutMs()`, `abortSignal` facoltativo.
- `runStructuredCall` con `buildClassifyInstructions()`, `buildClassifyPrompt(items)` e `ClassifyRecipesOutputSchema` (`{ recipes: [{ ref, courses, style_tags }] }`), temperatura **0,2** in entrambe le chiamate: la classificazione deve essere stabile, non creativa (requirements P10 della Feature 8). Messaggio di `invalid_output`: `Il modello non ha prodotto una classificazione valida dopo il tentativo di correzione.`
- Restituisce le righe **così come le dà il modello**: riferimenti sconosciuti o ripetuti e portate vuote li scarta il chiamante, `classifyPendingRecipes` ([[recipe-classification]]). Lo schema accetta portate vuote (una riga vuota non invalida il lotto) ma non valori fuori elenco, che portano alla riparazione (requirements P9). `style_tags` è ristretto ai quattro valori di `CLASSIFIED_STYLE_TAG_VALUES`.
- **`buildClassifyInstructions()`**: ruolo ("Classifichi ricette già esistenti: non le modifichi e non ne inventi di nuove"), definizione delle quattro portate e delle quattro etichette, una voce per ricetta nello stesso ordine, con `ref` copiato identico.
- **`buildClassifyPrompt(items)`**: `Classifica queste N ricette.` e un blocco per ricetta: `[r1] Titolo`, `Descrizione:` (su una riga, tagliata a `CLASSIFY_DESCRIPTION_MAX` = 300 caratteri senza puntini, `nessuna` se vuota), `Pasti:`, `Etichette attuali:`, `Ingredienti:`. Titolo e descrizione passano da `toSingleLine` (requirements P15).
- `lib/llm/index.ts` riesporta `classifyRecipes`, `buildClassifyInstructions`, `buildClassifyPrompt` e `CLASSIFY_DESCRIPTION_MAX`.

## Gestione Errori Tipizzata (`LlmError`)

Il modulo `lib/llm/errors.ts` esporta la classe `LlmError` con codici standardizzati `LlmErrorCode`:

| Codice | Significato | Causa Scatenante | Mappatura HTTP API |
|---|---|---|---|
| `'config'` | Configurazione provider/chiave non valida | Variabili `LLM_PROVIDER`, `LLM_MODEL` o API key assenti | `500` (`llm_not_configured`) |
| `'provider'` | Fallimento del servizio del fornitore | `APICallError` (HTTP 4xx/5xx del provider), errori di rete | `502` (`llm_unavailable`) |
| `'timeout'` | Timeout operazione LLM | `TimeoutError` o `AbortError` allo scadere di `LLM_TIMEOUT_MS` | `504` (`llm_timeout`) |
| `'invalid_output'` | Output non valido dopo repair loop | `NoObjectGeneratedError` persistente anche al secondo tentativo | `502` (`llm_invalid_output`) |

La funzione `isLlmError(error): error is LlmError` permette il type narrowing sicuro nei layer chiamanti. Dalla Feature 4 la mappatura HTTP della tabella è centralizzata in `llmErrorResponse` ([[http-helpers]]), usata dalla rotta di generazione e da tutte le rotte dei piani.

## Strumenti di Registrazione Offline (`llm-record.ts`)

Per adempiere al vincolo architetturale di **test senza rete** (`CLAUDE.md § Stack`), lo script CLI `scripts/llm-record.ts` (eseguibile tramite `pnpm llm:record`) permette di effettuare una chiamata reale con un provider configurato e salvarne l'output grezzo in `tests/fixtures/llm/recorded/<nome>.txt`.

Nei test automatici di Vitest, i modelli vengono simulati tramite `MockLanguageModelV4` (`ai/test`), garantendo esecuzioni deterministiche, istantanee e prive di costi o dipendenze da connettività esterna.

**Richiesta libera (Feature 9)**: l'opzione `--request "testo"` (da 3 a 100 caratteri, altrimenti errore e codice d'uscita 1) registra la risposta al prompt `buildRecipeRequestPrompt` invece che a `buildRecipePrompt`; `--meal` imposta il tipo di pasto. Esempio nell'intestazione dello script: `pnpm llm:record --name gemini-richiesta-lasagne --request "lasagne al pesto" --meal cena`. I test della richiesta libera non leggono registrazioni reali ma due fixture scritte a mano, `tests/fixtures/llm/request-lasagne.txt` e `request-lasagne-altra.txt` (decisione U1 della Feature 9); una registrazione reale resta una verifica manuale di chiusura e al 2026-10-14 in `tests/fixtures/llm/recorded/` non ce n'è ancora una ([[f9-ricette-su-richiesta]]). *Nota (Feature 8): la frase precedente è superata; la registrazione reale `google-richiesta-lasagne.txt` è stata fatta il 14 ottobre 2026 ([[log]]) ed è una delle cinque registrate ritoccate con `courses`.*

**Portate (Feature 8)**: `scripts/llm-record.ts` costruisce i vincoli con `courses` come l'app: `MAIN_COURSE_VALUES` per la generazione e per `--request` con `--meal`, `null` per `--request` senza `--meal` (requirements P23); senza, `RecipeConstraintsSchema` rifiuterebbe i vincoli. Le fixture a mano (`valid-2-recipes`, `generation-mixed`, `request-lasagne`, `request-lasagne-altra`) hanno ricevuto `courses`; le cinque registrate in `recorded/` sono state ritoccate a mano con lo stesso campo e non sono più risposte reali al byte (requirements P19). Nessun test legge le registrate. Per la classificazione non ci sono fixture su file: i test usano risposte scritte nel codice del test (requirements P20).

Test della Feature 9: `tests/llm/prompts.test.ts` (richiesta tra i delimitatori, sequenze dei delimitatori e a capo neutralizzati, riga del pasto con e senza `meal_type`, diete, nessun elettrodomestico, niente stile né preferenze, blocco dei titoli assente o con titoli puliti e unici, istruzione finale) e `tests/llm/adapter.test.ts` (ricetta singola normalizzata, richiesta e titoli esclusi nel prompt, prima ricetta se il modello ne restituisce più d'una, riparazione con una seconda chiamata, `invalid_output` dopo due risposte non valide, `RangeError` per una richiesta vuota senza chiamare il modello).

Test della Feature 8: `tests/llm/prompts.test.ts` (riga `courses` con i quattro valori e il loro significato, dodici etichette, significato delle quattro nuove, riga *Portata* subito dopo il pasto e assente con `null` in entrambi i prompt, istruzioni e prompt di classificazione, taglio a 300 caratteri, testo su una riga) e `tests/llm/adapter.test.ts` (`classifyRecipes`: righe restituite senza filtri, istruzioni e ricette numerate nel prompt, riparazione di una portata sconosciuta, `invalid_output` dopo due risposte non valide, errore HTTP del provider come `provider`, `RangeError` per lotti vuoti o oltre 10, lotto da 10 accettato, `config` senza `LLM_MODEL`).

## Vedi anche

- [[domain-types]] — Schemi Zod `GeneratedRecipeSchema` e `RecipeConstraintsSchema`
- [[recipe-generation]] — Servizio orchestratore `generateAndStoreRecipes` e route HTTP
- [[e1-motore-ricette]] — Panoramica della Feature 2 (E1 Motore ricette)
- [[fixtures-and-seed]] — Corpus ricette offline per test e seed
- [[http-helpers]] — `llmErrorResponse`, mappatura HTTP condivisa degli errori LLM
- [[plan-service]] — Feature 4: generazione a lotti da 3 e gestione di `LlmError` nel piano
- [[recipe-proposal-service]] — Feature 9: `proposeRecipe`, chiamante di `generateRecipeFromRequest`
- [[f9-ricette-su-richiesta]] — Panoramica della Feature 9
- [[recipe-classification]] — Feature 8: `classifyPendingRecipes`, chiamante di `classifyRecipes`
- [[f8-portate-etichette]] — Panoramica della Feature 8
