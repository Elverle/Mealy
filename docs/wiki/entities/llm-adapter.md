---
title: Adapter LLM Multi-Provider (llm-adapter)
type: entity
created: 2026-09-17
updated: 2026-09-29
tags: [llm, ai-sdk, adapter, multi-provider, structured-output, repair-loop, errors]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/llm/adapter.ts`: funzione principale di generazione `generateRecipes`, loop di correzione e normalizzazione.
  - `lib/llm/model.ts`: factory del modello linguistico `getModel`, lettura configurazione env e timeout.
  - `lib/llm/prompts.ts`: template per istruzioni di sistema, prompt utente con vincoli ed esclusioni, prompt di riparazione schema.
  - `lib/llm/errors.ts`: classe di errore tipizzato `LlmError` e type guard `isLlmError`.
  - `lib/llm/index.ts`: facciata pubblica che riesporta le funzioni e i tipi necessari.
  - `scripts/llm-record.ts`: script CLI per registrare risposte LLM reali per test offline.
- **Scopo**: Incapsulare interamente l'integrazione con i modelli linguistici (LLM) tramite Vercel AI SDK 7, fornendo una superficie fortemente tipizzata, provider-agnostica e resiliente per la generazione strutturata di ricette culinarie casalinghe italiane.
- **Regola di confine architetturale vincolante**: **solo** `lib/llm/` ha il permesso di importare i pacchetti `ai` e gli SDK dei fornitori (`@ai-sdk/google`, `@openrouter/ai-sdk-provider`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`). Nessun altro modulo dell'applicazione conosce o importa tali dipendenze. Il servizio `lib/recipes/` è l'unico consumatore applicativo dell'adapter (`generateRecipes`). Dalla Feature 4 altri due moduli importano **solo** `lib/llm/errors.ts` (`LlmError`, `isLlmError`) per riconoscere gli errori che risalgono da `generateAndStoreRecipes`: `lib/plans/service.ts` ([[plan-service]]) e `lib/http/responses.ts` ([[http-helpers]]). Nessuno dei due chiama il modello.

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

## Prompting e Strategia Anti-Duplicazione

Il modulo `lib/llm/prompts.ts` governa la comunicazione con l'LLM:
- **`buildRecipeInstructions()`**: stabilisce il ruolo ("ricettario di casa di una famiglia italiana") e le regole vincolanti per ingredienti (singolare, minuscolo, unità fisse `g | ml | pz | qb`, 9 reparti spesa fissi) e per la ricetta (titolo maiuscolo breve, diete transitive, elettrodomestici necessari, passi non numerati).
- **`buildRecipePrompt(constraints, n, excludeTitles)`**: compila i vincoli specifici richiesti (persone, tipologia pasto, diete obbligatorie, elettrodomestici ammessi, stili culinari, ingredienti graditi ed esclusi). Include inoltre la sezione con i titoli già presenti in libreria (fino a un massimo di `MAX_EXCLUDED_TITLES = 150`), intimando al modello di non proporre ricette uguali o molto simili.
- **`MAX_EXCLUDED_TITLES = 150`**: soglia per proteggere la finestra di contesto ed evitare consumi eccessivi di token pur fornendo un forte filtro preventivo sui duplicati.

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

## Vedi anche

- [[domain-types]] — Schemi Zod `GeneratedRecipeSchema` e `RecipeConstraintsSchema`
- [[recipe-generation]] — Servizio orchestratore `generateAndStoreRecipes` e route HTTP
- [[e1-motore-ricette]] — Panoramica della Feature 2 (E1 Motore ricette)
- [[fixtures-and-seed]] — Corpus ricette offline per test e seed
- [[http-helpers]] — `llmErrorResponse`, mappatura HTTP condivisa degli errori LLM
- [[plan-service]] — Feature 4: generazione a lotti da 3 e gestione di `LlmError` nel piano
