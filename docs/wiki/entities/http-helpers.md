---
title: Helper HTTP di Trasporto — Risposte d'Errore e Client JSON (http-helpers)
type: entity
created: 2026-09-29
updated: 2026-09-29
tags: [http, api-route, errors, client-fetch, transport, zod, feature-4]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/http/responses.ts`: helper **lato server** per i route handler; costruiscono la busta d'errore standard `{ error: { code, message, details? } }` e leggono i body JSON.
  - `lib/http/client.ts`: client fetch generico **importabile dai componenti client** (nessuna dipendenza dal DB) con la classe `ApiRequestError`.
- **Scopo**: togliere dalle rotte e dai client le copie della gestione errori scritte in linea. Introdotti dalla Feature 4 (requirements P18 e proposta P4 della review architetturale): la mappatura degli errori LLM non doveva essere copiata una terza volta, e le Feature 5 e 6 avranno bisogno dello stesso client.

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
- `POST /api/recipes/generate` ([[recipe-generation]]) e `GET/PUT /api/settings` ([[settings-service]]), rifattorizzate senza cambiare comportamento: continuano a leggere il body con `request.json()` e a loggare con i propri tag.

## Client JSON (`client.ts`)

```ts
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
}
export async function requestJson<T>(url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T>;
```

`requestJson` aggiunge `content-type: application/json` quando c'è un body e mappa ogni fallimento su `ApiRequestError`:

| Caso | `status` | `code` | Messaggio |
|---|---|---|---|
| `fetch` lancia (rete assente) | `0` | `network_error` | `Connessione non disponibile.` |
| Non 2xx con corpo `{ error }` | status HTTP | `error.code` (fallback `unknown_error`) | `error.message` (fallback generico) |
| Non 2xx con corpo illeggibile | status HTTP | `unknown_error` | `Qualcosa è andato storto. Riprova.` |
| 2xx non JSON o non conforme a `schema` | status HTTP | `invalid_response` | `Risposta del server non valida.` |

`lib/plans/client.ts` lo usa e rilancia `PlanRequestError`, sottoclasse con gli stessi campi. `lib/settings/client.ts` (Feature 3) resta con la sua implementazione autonoma, equivalente nella semantica: le feature successive dovrebbero usare `requestJson`.

## Test

- `tests/http/responses.test.ts`: `readJsonBody` con body vuoto (entrambe le opzioni), malformato e valido; `llmErrorResponse` per i 4 codici e per un errore generico; `invalidRequestResponse` con e senza issues.
- `tests/http/client.test.ts`: tutti i rami di `requestJson` con `fetch` stubbato.
- `tests/api/recipes-generate.test.ts` e `tests/api/settings.test.ts` restano verdi dopo il refactor (l'unica attesa cambiata è `maxDuration` della rotta di generazione, 120 → 300).

## Vedi anche

- [[plan-service]] — `handlePlanRouteError` e client dei piani
- [[recipe-generation]] — Rotta di generazione rifattorizzata
- [[settings-service]] — Rotta impostazioni rifattorizzata e client originario
- [[llm-adapter]] — `LlmError` e i suoi codici
- [[e3-pianificatore]] — Panoramica della Feature 4
