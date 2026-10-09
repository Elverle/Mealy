---
title: Helper HTTP di Trasporto — Risposte d'Errore e Client JSON (http-helpers)
type: entity
created: 2026-09-29
updated: 2026-10-09
tags: [http, api-route, errors, client-fetch, transport, zod, feature-4]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/http/responses.ts`: helper **lato server** per i route handler; costruiscono la busta d'errore standard `{ error: { code, message, details? } }` e leggono i body JSON.
  - `lib/http/client.ts`: client fetch generico **importabile dai componenti client** (nessuna dipendenza dal DB) con la classe `ApiRequestError`.
- **Scopo**: togliere dalle rotte e dai client le copie della gestione errori scritte in linea. Introdotti dalla Feature 4 (requirements P18 e proposta P4 della review architetturale): la mappatura degli errori LLM non doveva essere copiata una terza volta, e le Feature 5 e 6 avranno bisogno dello stesso client. La Feature 5 li usa in tutte le sue rotte e nei suoi client, e aggiunge `apiErrorMessage`.

## Risposte lato server (`responses.ts`)

| Funzione | Risposta |
|---|---|
| `errorResponse(status, code, message, details?)` | `Response.json({ error: { code, message, details? } }, { status })` |
| `invalidRequestResponse(issues?)` | 400 `invalid_request` `Richiesta non valida.`; con le `ZodIssue` aggiunge `details: [{ path, message }]` (`path` unito con `.`) |
| `internalErrorResponse()` | 500 `internal_error` `Qualcosa è andato storto. Riprova.`, senza dettagli interni |
| `llmErrorResponse(err)` | Per un `LlmError` ([[llm-adapter]]): `config` → 500 `llm_not_configured` (`Generazione non disponibile: il modello non è configurato.`); `timeout` → 504 `llm_timeout`; `provider` → 502 `llm_unavailable`; `invalid_output` → 502 `llm_invalid_output` (questi tre con `La generazione non è andata a buon fine. Riprova.`). Per qualsiasi altro errore `null`. |
| `readJsonBody(request, { allowEmpty })` | Legge `request.text()`: body vuoto → `{ ok: true, value: {} }` se `allowEmpty`, altrimenti `{ ok: false }`; JSON malformato o lettura fallita → `{ ok: false }` |

Uso:
- tutte le rotte `app/api/plans/**`, tramite `handlePlanRouteError` di [[plan-service]];
- `POST /api/recipes/generate` ([[recipe-generation]]) e `GET/PUT /api/settings` ([[settings-service]]), rifattorizzate senza cambiare comportamento: continuano a leggere il body con `request.json()` e a loggare con i propri tag;
- dalla Feature 5 le cinque rotte di libreria e preferenze (`GET /api/recipes`, `GET /api/recipes/:id`, `PUT /api/recipes/:id/pref`, `GET /api/ingredient-prefs`, `PUT /api/ingredient-prefs/:canonicalName`, v. [[library-service]] e [[prefs-service]]): `invalidRequestResponse`, `internalErrorResponse`, `readJsonBody(request, { allowEmpty: false })` per le due `PUT`, e `errorResponse(404, 'recipe_not_found', 'Ricetta non trovata.')`. Non hanno una classe d'errore né un gestore comune: il servizio restituisce `null` e la rotta risponde 404.
- dalla Feature 6 le cinque rotte della lista della spesa (`GET` e `POST /api/plans/:id/shopping-list`, `POST /api/plans/:id/shopping-list/items`, `PATCH` e `DELETE /api/shopping-items/:id`, v. [[shopping-service]]): `readJsonBody(request, { allowEmpty: false })` e `invalidRequestResponse` per i due body, e il gestore comune `handleShoppingRouteError`, che usa `errorResponse` per gli `ShoppingError` e `internalErrorResponse` per il resto. A differenza delle rotte dei piani non passa da `llmErrorResponse`: la lista non chiama mai l'LLM.

## Client JSON (`client.ts`)

```ts
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
}
export const UNKNOWN_ERROR_MESSAGE = 'Qualcosa è andato storto. Riprova.';                       // esportata dalla Feature 5
export function apiErrorMessage(err: unknown): string;                                           // Feature 5
export async function requestJson<T>(url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T>;
```

`requestJson` aggiunge `content-type: application/json` quando c'è un body e mappa ogni fallimento su `ApiRequestError`:

| Caso | `status` | `code` | Messaggio |
|---|---|---|---|
| `fetch` lancia (rete assente) | `0` | `network_error` | `Connessione non disponibile.` |
| Non 2xx con corpo `{ error }` | status HTTP | `error.code` (fallback `unknown_error`) | `error.message` (fallback generico) |
| Non 2xx con corpo illeggibile | status HTTP | `unknown_error` | `Qualcosa è andato storto. Riprova.` |
| 2xx non JSON o non conforme a `schema` | status HTTP | `invalid_response` | `Risposta del server non valida.` |

`lib/plans/client.ts` lo usa e rilancia `PlanRequestError`, sottoclasse con gli stessi campi. `lib/settings/client.ts` (Feature 3) resta con la sua implementazione autonoma, equivalente nella semantica: le feature successive dovrebbero usare `requestJson`. La Feature 5 lo fa: `lib/library/client.ts` e `lib/prefs/client.ts` chiamano `requestJson` e lasciano passare `ApiRequestError` così com'è, senza sottoclassi (requirements P19).

### Uso nella Feature 6: `signal` e classificazione degli errori
`lib/shopping/client.ts` segue lo stesso modello ([[shopping-service]]). Due aspetti di `requestJson`, invariato, diventano portanti:
- `init` passa a `fetch` così com'è, quindi un `signal` interrompe la richiesta; l'interruzione fa lanciare `fetch` e ricade nel caso `status 0` / `network_error`. Lo usa solo `patchShoppingItem`, per il limite di tempo di 10 s della coda delle spunte ([[check-queue]]). **Nessun'altra chiamata del client ha un limite di tempo**: una richiesta senza risposta resta in sospeso finché lo decide il browser (osservazione P2 della review architetturale della Feature 6).
- la coda classifica gli errori sullo `status` di `ApiRequestError`: `0`, `408`, `429` e `≥ 500` si ritentano; un `invalid_response` (status 2xx) vale come spunta applicata; gli altri sono definitivi.

### `apiErrorMessage(err)` (Feature 5)
Restituisce il messaggio mostrabile all'utente: `err.message` se `err` è un `ApiRequestError` (quindi anche un `PlanRequestError`), altrimenti il generico `UNKNOWN_ERROR_MESSAGE`. Sostituisce le copie di `err instanceof … ? err.message : 'Qualcosa è andato storto. Riprova.'` che erano scritte in linea in `plan-screen.tsx` e `plan-slot-card.tsx` e che la Feature 5 avrebbe moltiplicato (proposta P3 della review architetturale). La usano [[plan-screen]], [[library-screen]] e [[recipe-detail-sheet]]; dalla Feature 6 anche [[shopping-screen]] e il suo pannello di aggiunta.

## Test

- `tests/http/responses.test.ts`: `readJsonBody` con body vuoto (entrambe le opzioni), malformato e valido; `llmErrorResponse` per i 4 codici e per un errore generico; `invalidRequestResponse` con e senza issues.
- `tests/http/client.test.ts`: tutti i rami di `requestJson` con `fetch` stubbato; dalla Feature 5 `apiErrorMessage` per un `ApiRequestError` e per un errore qualsiasi.
- `tests/api/recipes-generate.test.ts` e `tests/api/settings.test.ts` restano verdi dopo il refactor (l'unica attesa cambiata è `maxDuration` della rotta di generazione, 120 → 300).

## Vedi anche

- [[plan-service]] — `handlePlanRouteError` e client dei piani
- [[recipe-generation]] — Rotta di generazione rifattorizzata
- [[settings-service]] — Rotta impostazioni rifattorizzata e client originario
- [[llm-adapter]] — `LlmError` e i suoi codici
- [[library-service]] — Rotte e client della libreria (Feature 5)
- [[prefs-service]] — Rotte e client delle preferenze (Feature 5)
- [[shopping-service]] — Rotte, `handleShoppingRouteError` e client della lista della spesa (Feature 6)
- [[check-queue]] — Limite di tempo e classificazione degli errori sulle spunte (Feature 6)
- [[e3-pianificatore]] — Panoramica della Feature 4
- [[e2-libreria-preferenze]] — Panoramica della Feature 5
- [[e4-lista-spesa]] — Panoramica della Feature 6
