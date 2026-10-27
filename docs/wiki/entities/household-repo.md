---
title: Repository Nucleo Domestico (household-repo)
type: entity
created: 2026-09-15
updated: 2026-10-27
tags: [database, repository, household, singleton, drizzle, onboarding, contract-u1, executor, recipe-pack, compositions]
---

## File e Responsabilità

- **Percorso file**: `lib/db/repositories/household-repo.ts`
- **Scopo**: Fornire un'interfaccia tipata e robusta per la lettura, la creazione idempotente e l'aggiornamento dei dati del nucleo familiare nella tabella `households`. Tutti i dati estratti vengono validati con `HouseholdSchema.parse()` prima della restituzione.

## Metodi Esportati

### `getHouseholdById(id: string, executor: DbExecutor = db): Promise<Household | null>`
Esegue una query `findFirst` sulla tabella `households` tramite `executor.query`. Se il record viene individuato, ne esegue il parsing con lo schema Zod `HouseholdSchema`. In caso contrario restituisce `null`.

Il parametro `executor` (Feature 4, fix M1 della code review) permette di rileggere le impostazioni **dentro una transazione**, dopo un advisory lock: [[plan-service]] lo usa per applicare al piano i vincoli salvati mentre l'LLM stava generando (v. [[plan-concurrency-pattern]]). Senza argomento usa il `db` globale, come prima.

### `ensureDefaultHousehold(): Promise<Household>`
Garantisce in modo **idempotente** che il nucleo familiare di default (`DEFAULT_HOUSEHOLD_ID = '00000000-0000-0000-0000-000000000001'`) sia presente nel database:
1. Verifica preventivamente se il record esiste già.
2. In caso di assenza, tenta l'inserimento con `.onConflictDoNothing()`, con `onboarded_at: null` (il singleton appena creato non ha completato l'onboarding) e `created_at`/`updated_at` fissi da `DEFAULT_HOUSEHOLD` (`2026-01-01T00:00:00Z`).
3. Gestisce eventuali race-condition concorrenti recuperando il record appena creato.

Dalla Feature 11 il singleton nasce con `meal_compositions` = copia di `DEFAULT_HOUSEHOLD.meal_compositions` (tutte e cinque per pranzo e per cena); il default della colonna è lo stesso ([[database-schema]]).

Dalla Feature 10 la chiama anche `loadRecipePack` all'avvio in produzione, quando il pacchetto non è vuoto: su un database nuovo il singleton nasce all'avvio, senza onboarding (`onboarded_at: null`), e riceve le ricette del pacchetto prima che l'utente apra l'app ([[recipe-pack]]). Scrive con il `db` globale, fuori dalla transazione del caricamento: in produzione il pool è un singleton (Feature 8).

### `getDefaultHousehold(): Promise<Household>`
Metodo di comodo utilizzato dalle schermate e dai servizi in v1. Prova il recupero del singleton tramite `getHouseholdById` e, in caso di esito negativo, invoca `ensureDefaultHousehold()`.

### `loadHousehold(id?: string): Promise<Household>` (Feature 3)
Punto di ingresso raccomandato per i moduli applicativi (servizio impostazioni, generazione ricette e, dalla Feature 4, servizio dei piani). Centralizza la regola di risoluzione, così il messaggio d'errore resta uno solo:
- `id` assente o uguale a `DEFAULT_HOUSEHOLD_ID` → `getDefaultHousehold()` (crea il singleton se manca);
- altrimenti `getHouseholdById(id)`; se `null` → `throw new Error(\`Household ${id} non trovato\`)`.

Introdotta dalla proposta P1 della review architetturale della Feature 3, sostituisce la logica in linea che prima viveva in `lib/recipes/generate.ts` ([[recipe-generation]]) ed evita una seconda copia in `lib/settings/service.ts` ([[settings-service]]).

### `updateHousehold(data: Partial<Omit<Household, 'id' | 'created_at' | 'updated_at'>>, id?: string): Promise<Household>`
Aggiorna i parametri di configurazione del nucleo (default: `DEFAULT_HOUSEHOLD_ID`):
- Supporta aggiornamenti parziali di: `persons`, `meals`, `diet_tags`, `meal_style_tags`, `appliances` e, dalla Feature 3, `onboarded_at`. Dalla Feature 11 anche `meal_compositions`, scritto come oggetto nuovo `{ pranzo: [...], cena: [...] }`: cambiare le composizioni aggiorna `updated_at` come gli altri vincoli, quindi una bozza risulta superata (spec FR-2.5).
- Invoca `ensureDefaultHousehold()` **solo** quando `id === DEFAULT_HOUSEHOLD_ID` (fix P15 dei requirements di F3: prima creava il singleton anche aggiornando un altro household, con effetti collaterali nei test).
- Scrive `updated_at` con l'espressione SQL `now()`, cioè con l'**orologio del database** e non con `new Date()` di Node. Il tipo interno `HouseholdUpdateValues` impone che `updated_at` sia un'espressione `SQL`.
- Solleva un errore esplicito (`Household with id … not found for update`) qualora l'ID indicato non esista.

#### Invariante di `updated_at` (contratto U1)
Documentata nel JSDoc della funzione: `updated_at` rappresenta l'**ultimo cambio dei vincoli o dell'onboarding** ed è il riferimento del contratto U1 (un piano è superato se `updated_at > meal_plans.generated_at`, entrambi scritti con `now()` del DB). Fino alla Feature 3 il confronto era con `meal_plans.created_at`; la Feature 4 lo ha spostato su `generated_at`, che si aggiorna a ogni rigenerazione (requirements P8), e ha corretto anche il JSDoc. Poiché ogni chiamata aggiorna `updated_at`, **non va chiamata per scritture che non cambiano i vincoli**: il chiamante deve verificare a monte che ci sia un cambiamento reale, come fa `saveSettings` con `settingsEqual` ([[settings-service]]).

## Esempio d'Uso

```ts
import { loadHousehold } from '@/lib/db/repositories/household-repo';

// Singleton di default (creato se assente)
const household = await loadHousehold();
console.log(`Persone a tavola: ${household.persons}`);

// Household specifico (es. nei test DB): lancia "Household <id> non trovato" se manca
const other = await loadHousehold(testHouseholdId);
```

Per modificare i vincoli dall'applicazione si passa da `saveSettings` ([[settings-service]]), che normalizza, confronta e scrive solo se necessario, invece di chiamare direttamente `updateHousehold`.

## Vedi anche

- [[domain-types]] — Tipi `Household` e costante `DEFAULT_HOUSEHOLD`
- [[database-schema]] — Tabella `households` in Drizzle
- [[database-architecture]] — Strategia relazionale e migrazioni
- [[settings-service]] — Servizio impostazioni che usa `loadHousehold` e `updateHousehold`
- [[f11-composizione-pasto]] — Feature 11: composizioni dei pasti nell'household
- [[recipe-generation]] — Generazione ricette che usa `loadHousehold`
- [[plan-service]] — Servizio dei piani: `loadHousehold` e rilettura sotto lock con `getHouseholdById(id, tx)`
- [[library-service]] e [[prefs-service]] — Servizi di libreria e preferenze, che risolvono l'household con `loadHousehold` (Feature 5)
- [[shopping-service]] — Servizio della lista della spesa, che risolve l'household con `loadHousehold` in ogni funzione (Feature 6)
- [[e5-impostazioni]] — Panoramica della Feature 3
- [[e3-pianificatore]] — Panoramica della Feature 4
- [[recipe-pack]] — `loadRecipePack`, che crea il singleton all'avvio (Feature 10)
