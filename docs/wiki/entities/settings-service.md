---
title: Servizio Impostazioni Household e API (settings-service)
type: entity
created: 2026-09-28
updated: 2026-09-29
tags: [settings, household, service, api-route, normalization, client-fetch, onboarding, contract-u1, feature-3]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/settings/normalize.ts`: funzioni **pure** di normalizzazione, confronto e proiezione delle impostazioni. Importa solo da `@/lib/domain/types`: è sicuro nei componenti client.
  - `lib/settings/service.ts`: servizio **solo lato server** (`getSettings`, `saveSettings`); importa il repository e quindi il DB.
  - `lib/settings/client.ts`: funzione fetch lato client `putSettings` e classe d'errore `SettingsRequestError`. Nessuna dipendenza dal DB.
  - `app/api/settings/route.ts`: route handler Next.js `GET` / `PUT /api/settings`.
- **Scopo**: leggere e salvare i 5 vincoli del nucleo domestico (`persons`, `meals`, `meal_style_tags`, `diet_tags`, `appliances`) e lo stato di onboarding, garantendo che `households.updated_at` cambi **solo** quando i vincoli cambiano davvero o quando l'onboarding si completa (base del contratto U1 per la Feature 4).
- **Regola di confine client/server**: i componenti `"use client"` importano da `lib/settings/` **solo** `normalize.ts` e `client.ts`, mai `service.ts`. Non esiste un barrel `lib/settings/index.ts`, proprio per evitare che un import dal client trascini con sé il modulo del DB.

## Funzioni Pure (`normalize.ts`)

| Funzione | Comportamento |
|---|---|
| `normalizeSettings(settings)` | Ritorna un nuovo oggetto con `persons` invariato e ciascun array ridotto ai valori ammessi, **senza duplicati e nell'ordine dell'enum** (`MEAL_TYPE_VALUES`, `MEAL_STYLE_TAG_VALUES`, `DIET_FLAG_VALUES`, `APPLIANCE_VALUES`). Es.: `meals: ['cena','pranzo','cena']` → `['pranzo','cena']`. |
| `settingsEqual(a, b)` | `true` se, dopo `normalizeSettings` di entrambi, `persons` coincide e i quattro array hanno gli stessi elementi nello stesso ordine. |
| `householdToSettings(household)` | Estrae e normalizza i 5 campi dall'`Household`, senza validazione (un household con `meals: []` restituisce `meals: []`). |
| `toSettingsView(household)` | Produce la `SettingsView` pubblica: i 5 campi normalizzati + `onboarded: onboarded_at !== null` + `updated_at` in ISO 8601. |
| `toggleInOrder(values, order, value)` | Aggiunge o rimuove `value` e ritorna l'insieme risultante nell'ordine canonico `order`. Usata dai chip di [[settings-fields]]. |

Le diete vengono salvate **come selezionate**, senza espansione transitiva: la regola "diete household ⊆ `diet_flags` della ricetta" funziona già perché è la Feature 2 a espandere i flag delle ricette (`expandDietFlags`, v. [[domain-types]]).

## Servizio Server (`service.ts`)

```ts
export async function getSettings(householdId?: string): Promise<SettingsView>;
export async function saveSettings(
  input: UpdateSettingsRequest,
  householdId?: string,
): Promise<SaveSettingsResult>;
```

Entrambe risolvono l'household tramite `loadHousehold(householdId)` di [[household-repo]] (singleton di default se l'id è assente; errore `Household <id> non trovato` per id inesistenti). Il parametro `householdId` esiste per i test DB, che lavorano su household dedicati senza toccare il singleton.

### Algoritmo di `saveSettings`

1. `UpdateSettingsRequestSchema.parse(input)`: l'eventuale `ZodError` si propaga al chiamante.
2. Separa `complete_onboarding` dai 5 campi e normalizza questi ultimi (`normalizeSettings`).
3. Carica l'household corrente.
4. `changed = !settingsEqual(next, householdToSettings(current))`.
5. `completing = complete_onboarding && current.onboarded_at === null` (l'onboarding si imposta **una sola volta**).
6. Se `!changed && !completing` → ritorna `{ settings: toSettingsView(current), changed: false }` **senza alcuna scrittura** (quindi `updated_at` resta invariato).
7. Altrimenti chiama `updateHousehold({ ...next, onboarded_at? }, current.id)` e ritorna `{ settings, changed }`.

Nota: `onboarded_at` viene valorizzato con `new Date()` di Node, mentre `updated_at` è scritto da `updateHousehold` con `now()` del database. Solo `updated_at` partecipa al contratto U1.

Concorrenza: lettura e scrittura non sono in transazione. Con un solo utente vince l'ultimo salvataggio; la review architetturale lo ha giudicato accettabile.

## API HTTP (`app/api/settings/route.ts`)

- **Configurazione**: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.
- **Formato errori**: identico a `POST /api/recipes/generate` ([[recipe-generation]]): `{ error: { code, message, details? } }`, log con `console.error('[api/settings]', err)`, nessun dettaglio interno nel corpo dei 500. Dalla Feature 4 le risposte si costruiscono con `invalidRequestResponse` / `internalErrorResponse` di `lib/http/responses.ts` ([[http-helpers]]), senza cambiare comportamento (`tests/api/settings.test.ts` invariato).

| Metodo | Input | Successo | Errori |
|---|---|---|---|
| `GET /api/settings` | — | **200** `SettingsView` (`{ persons, meals, meal_style_tags, diet_tags, appliances, onboarded, updated_at }`) | **500** `internal_error` |
| `PUT /api/settings` | `{ persons, meals, meal_style_tags, diet_tags, appliances, complete_onboarding? }` (sostituzione completa dei 5 campi) | **200** `SaveSettingsResult` (`{ settings: SettingsView, changed: boolean }`) | **400** `invalid_request` (JSON illeggibile, oppure validazione Zod fallita con `details: [{ path, message }]`); **500** `internal_error` |

Le API non sono autenticate: la v1 gira solo in locale (Raspberry + Tailscale, `ARCHITECTURE §8`); login e autenticazione sono rinviati a una v2.

## Client Fetch (`client.ts`)

```ts
export class SettingsRequestError extends Error {
  readonly status: number;
  readonly code: string;
}
export async function putSettings(body: UpdateSettingsRequest): Promise<SaveSettingsResult>;
```

`putSettings` invia `PUT /api/settings` con corpo JSON e mappa ogni fallimento su `SettingsRequestError`:

| Caso | `status` | `code` | Messaggio |
|---|---|---|---|
| `fetch` lancia (rete assente) | `0` | `network_error` | `Connessione non disponibile.` |
| Risposta non 2xx con corpo JSON | status HTTP | `error.code` del server (fallback `unknown_error`) | `error.message` del server |
| Risposta non 2xx con corpo illeggibile | status HTTP | `unknown_error` | `Qualcosa è andato storto. Riprova.` |
| Risposta 2xx con corpo non JSON | status HTTP | `invalid_response` | `Risposta del server non valida.` |
| Risposta 2xx con JSON non conforme a `SaveSettingsResultSchema` | status HTTP | `invalid_response` | `Risposta del server non valida.` |

La mappatura dei 2xx non JSON su `invalid_response` è un fix post-review: in precedenza l'eccezione di `response.json()` sfuggiva non tipizzata.

Dalla Feature 4 esiste un client generico equivalente, `requestJson` / `ApiRequestError` in `lib/http/client.ts` ([[http-helpers]]), su cui è costruito il client dei piani. `putSettings` non è stato migrato e mantiene la sua implementazione.

## Contratto per la Feature 4 (decisione U1)

Un piano è **superato dai vincoli** se `Date.parse(settings.updated_at) > meal_plans.created_at`.

Perché la regola regga:
- `updated_at` cambia solo con modifiche reali dei vincoli (confronto `settingsEqual` a monte) o al completamento dell'onboarding, che avviene prima di qualsiasi piano;
- `updated_at` è scritto con `now()` del DB, lo stesso orologio di `meal_plans.created_at` (`defaultNow()`), così il confronto non dipende dall'allineamento tra orologio di Node e orologio del container Postgres.

Punti aperti consegnati al piano della Feature 4 (addendum della review 2026-09-28):
- **R1**: le preferenze ingredienti (`ingredient_prefs`, Feature 5) non toccano `households.updated_at`, quindi un 👎 non rende "superato" il piano corrente. Va deciso se accettarlo o estendere la regola.
- **R2**: la pagina Piano ora vive in `app/(app)/page.tsx` (v. [[onboarding-guard]]).
- **Q1**: `getSettings()` è chiamato sia dal layout del gruppo `(app)` sia dalle pagine (oggi `/impostazioni`, in F4 anche il Piano): due letture dell'household per richiesta. Valutare `React.cache()` su `getSettings` / `loadHousehold`.

### Esito nella Feature 4
- La regola è diventata `households.updated_at > meal_plans.generated_at` (requirements P8 di F4): `generated_at` si aggiorna a ogni rigenerazione, mentre con `created_at` l'avviso "superato" sarebbe rimasto anche dopo aver rigenerato. Stesso orologio del DB, quindi le garanzie sopra restano valide. Il campo calcolato è `PlanView.superseded` ([[plan-service]]); il servizio dei piani rilegge l'household dentro il lock, così `generated_at` copre solo impostazioni effettivamente applicate.
- **R1** accettato: un like/dislike agisce dalla prossima generazione o dal prossimo swap, senza segnare il piano come superato.
- **R2** applicato: la pagina Piano è `app/(app)/page.tsx` ([[plan-screen]]).
- **Q1** non adottato: la pagina Piano legge l'household tramite `getPlanScreen`, e due letture per richiesta su una LAN domestica non giustificano la modifica di F3 e dei suoi test.

## Test

- `tests/settings/normalize.test.ts` (node): ordine e deduplica, `settingsEqual`, `toSettingsView`, `toggleInOrder`, default `onboarded_at: null` di `HouseholdSchema`, rifiuti di `UpdateSettingsRequestSchema` (`persons` 0 o 13, `meals: []`, diete sconosciute, chiavi extra).
- `tests/settings/service.test.ts` (node, DB reale con `describe.skipIf(!dbUp)` e household dedicati): nessuna scrittura a valori invariati, persistenza normalizzata con `updated_at` avanzato, completamento idempotente dell'onboarding, `ZodError` senza scritture, id sconosciuto, propagazione dei vincoli a `buildConstraints`; più un `describe` senza DB che verifica il file di migrazione `0002`.
- `tests/api/settings.test.ts` (node, servizio mockato): status e corpi di `GET`/`PUT`, inclusi i `details` di validazione.
- `tests/settings/client.test.ts` (jsdom, `fetch` stubbato): tutti i rami di `putSettings`.

## Vedi anche

- [[e5-impostazioni]] — Panoramica della Feature 3
- [[household-repo]] — `loadHousehold`, `updateHousehold` e invariante di `updated_at`
- [[domain-types]] — Schemi `HouseholdSettingsSchema`, `UpdateSettingsRequestSchema`, `SettingsViewSchema`, `SaveSettingsResultSchema`
- [[settings-editor]] — Form di modifica che usa `putSettings`
- [[onboarding-wizard]] — Wizard che completa l'onboarding con `complete_onboarding: true`
- [[onboarding-guard]] — Guardia server-side che legge `getSettings().onboarded`
- [[http-helpers]] — Helper di risposta e client generico introdotti dalla Feature 4
- [[plan-service]] — Consumatore del contratto U1 (`superseded`)
