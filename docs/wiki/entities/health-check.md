---
title: Controllo di Salute — checkDatabase e GET /api/health (health-check)
type: entity
created: 2026-10-11
updated: 2026-10-11
tags: [health, api-route, database, healthcheck, docker, deploy, monitoring, feature-7]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/health/service.ts`: `checkDatabase`, solo lato server.
  - `app/api/health/route.ts`: rotta `GET /api/health`.
- **Scopo**: dire con una richiesta HTTP se l'app è in piedi e raggiunge il database. Serve a tre consumatori: l'healthcheck del container `app`, `scripts/deploy.sh` e `scripts/smoke-prod.sh` (requirements P8 della Feature 7). Come le altre rotte, passa da un servizio in `lib/`.

## Servizio (`lib/health/service.ts`)

```ts
export async function checkDatabase(timeoutMs: number = 2000): Promise<void>;
```

- Esegue `select 1` sul **pool dell'app** (`client` di `lib/db/index.ts`) in gara con un timer (`Promise.race`).
- Si risolve senza valore se il database risponde in tempo.
- Lancia l'errore del database se la query fallisce, oppure `database: nessuna risposta in <timeoutMs> ms` se scade il tempo. Allo scadere la query non viene annullata: la funzione smette soltanto di aspettarla.
- Il timer viene sempre cancellato nel `finally`.

## Rotta (`app/api/health/route.ts`)

`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, come ogni rotta API del progetto.

| Caso | Risposta |
|---|---|
| Il database risponde | 200, corpo `{"status":"ok"}` |
| `checkDatabase` lancia | 503 con la busta standard `{ "error": { "code": "db_unavailable", "message": "Database non raggiungibile." } }` ([[http-helpers]], `errorResponse`) |

L'errore originale finisce nel log del server (`console.error('[api/health]', err)`) e **non** nella risposta: un test controlla che il corpo non contenga il testo dell'errore.

La rotta non è autenticata, come tutte le API della v1, e non passa dalla guardia di onboarding, che sta nel layout del route group `app/(app)/` e non in un middleware ([[onboarding-guard]]).

### Il corpo è un contratto

`{"status":"ok"}` è confrontato **carattere per carattere** da `scripts/deploy.sh` e da `scripts/smoke-prod.sh` (`curl` e confronto di stringhe). Aggiungere un campo o cambiare la formattazione li farebbe fallire. L'healthcheck del compose guarda invece solo lo stato HTTP (`r.ok`).

## Chi lo Usa

| Consumatore | Come |
|---|---|
| Healthcheck del servizio `app` in `docker-compose.prod.yml` | `node -e "fetch('http://127.0.0.1:3000/api/health')…"`: esce con 0 se la risposta è 2xx. Ogni 10 s, limite 5 s, 6 tentativi, `start_period` 60 s ([[production-stack]]) |
| `scripts/deploy.sh` | Dopo `up -d --wait`, `curl` con limite 10 s sulla porta pubblicata; se il corpo non è quello atteso lo script esce con 1 ([[deploy-scripts]]) |
| `scripts/smoke-prod.sh` | Primo controllo dopo l'avvio dello stack di prova |

Durante il bootstrap del database il server non risponde ancora ([[db-bootstrap]]): l'healthcheck fallisce finché migrazioni e alias non sono applicati. Nei primi 60 s (`start_period`) i fallimenti non vengono contati.

## Limiti

- **Prova solo `select 1`.** Non guarda lo schema: se una migrazione fosse stata saltata, l'app risulterebbe sana, `deploy.sh` stamperebbe `fatto` e le rotte che usano la colonna mancante darebbero errore (review architetturale della Feature 7, R3). La protezione sta a monte, nei test sul journal e sul database fermo alla migrazione precedente ([[db-bootstrap]]).
- **Non prova l'LLM** né la configurazione del provider: una chiave mancante si vede solo al primo *Genera piano*.
- La rotta non è elencata nella superficie API di `ARCHITECTURE §6`.

## Test

- `tests/health/service.test.ts` (`client` mockato): si risolve quando il database risponde, con una sola query; rilancia l'errore del database; con una query che non risponde mai lancia `database: nessuna risposta in 20 ms`.
- `tests/api/health.test.ts` (servizio mockato): `runtime` e `dynamic`; 200 con `{ status: 'ok' }`; 503 `db_unavailable` senza il testo dell'errore originale nel corpo e con l'errore nel log.

## Vedi anche

- [[e6-deploy]] — Panoramica della Feature 7
- [[production-stack]] — Healthcheck del servizio `app`
- [[deploy-scripts]] — Uso in `deploy.sh` e `smoke-prod.sh`
- [[db-bootstrap]] — Perché all'avvio la rotta non risponde subito
- [[http-helpers]] — `errorResponse` e busta d'errore
