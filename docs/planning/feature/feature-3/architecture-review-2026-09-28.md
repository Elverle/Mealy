# Architecture review — Feature 3 (E5 Impostazioni)

**Data:** 2026-09-28 · **Piano esaminato:** [`plan.md`](plan.md) (+ [`requirements.md`](requirements.md)) · **Contesto:** as-built della Feature 2 (commit `aa5fa10`), `docs/ARCHITECTURE.md`, `docs/planning/execution-strategy.md` (§3 Feature 3–5).

Il piano è stato scritto il 2026-09-17, **prima** che la Feature 2 fosse implementata. Questa review ne verifica le ipotesi sul codice reale.

## Metodo e prove raccolte
- Gate sul codice attuale (subito prima del commit di F2): `lint` ✅, `typecheck` ✅, `test` ✅ **161/161** (compresi i test DB, su Postgres migrato), `build` ✅.
- `pnpm drizzle-kit generate` sullo schema attuale: **"No schema changes"**. Schema e snapshot `0001` coincidono, quindi la migrazione `0002` di WP1 conterrà solo l'`ADD COLUMN` (il rischio del passo 3 di WP1 è escluso).
- Next installato **15.5.25**: `connection` è esportato da `next/server` ✅ (P4 dei requirements valido).
- **Tutte** le ipotesi della §0.2 del piano sono verificate sul codice: firme di `household-repo`, `buildConstraints(household, mealType, overrides?)`, helper `tests/helpers/db.ts`, formato errori di `app/api/recipes/generate/route.ts`, `ChipFilter`, root layout con `BottomNav`.
- Impatto dell'aggiunta di `onboarded_at` al tipo `Household` sui test esistenti: `tests/recipes/constraints.test.ts` costruisce l'household con `...DEFAULT_HOUSEHOLD` (eredita il campo), `tests/db/schema.test.ts` usa `toContain` sulle colonne → **nessuna rottura**.
- Orologio del Postgres Docker e orologio di Node allineati al momento della prova (differenza entro la finestra di misura, < 1 s).

---

## 1. Problemi attuali (ordinati per impatto)

### P1 — Caricamento dell'household duplicato, e il piano aggiunge una seconda copia · **da tenere d'occhio**
**File:** `lib/recipes/generate.ts:70-79`; piano WP1 passo 6 (`loadHousehold` in `lib/settings/service.ts`)
- `generateAndStoreRecipes` contiene in linea la regola "id assente → singleton; id presente → `getHouseholdById` o `throw new Error(\`Household ${id} non trovato\`)`". Il servizio settings del piano la **riscrive identica**, con lo stesso messaggio.
- La Feature 4 (planner) avrà bisogno della stessa regola: sarebbe la terza copia. I messaggi d'errore (su cui i test fanno `toContain('non trovato')`) e la semantica del default dovrebbero restare sincronizzati a mano.
- Il posto naturale è il repository, che conosce già `DEFAULT_HOUSEHOLD_ID` e `getDefaultHousehold`.

### P2 — Il contratto U1 per F4 si basa su `households.updated_at`, ma il codice non ne difende la semantica · **da tenere d'occhio**
**File:** `lib/db/repositories/household-repo.ts:73-101` (`updateHousehold`), `lib/db/schema.ts:27` e `:58` (`defaultNow()`), `tests/helpers/db.ts:43-52`
- Il contratto dice che un piano è superato se `settings.updated_at > plan.created_at`. Perché regga servono due proprietà che oggi nessun codice o commento difende:
  1. **Chi scrive `updated_at`.** `updateHousehold` lo aggiorna a **ogni** chiamata. Il piano lo protegge bene nel servizio (P9: nessuna scrittura se nulla cambia), ma non nel repository, che è il punto che una feature futura userebbe direttamente.
  2. **Lo stesso orologio.** `updated_at` viene scritto con `new Date()` di Node, mentre `meal_plans.created_at` (F4) usa `defaultNow()` del DB. Oggi i due orologi coincidono (verificato). Sul Raspberry (F7) DB e app girano sullo stesso host. Su Docker Desktop/WSL2, invece, l'orologio della VM può restare indietro dopo una sospensione del PC: in quel caso un piano creato subito dopo un salvataggio risulterebbe già "superato". Il rischio c'è solo in sviluppo.
- La sistemazione costa poco e rende il contratto indipendente dagli orologi: scrivere `updated_at` con `now()` del DB, come fa già `created_at`.

### P3 — Limiti di `persons` scritti come letterali in più punti; il piano ne aggiunge altri · **cosmetico**
**File:** `lib/domain/types.ts:281` (`RecipeConstraintsSchema`), `:293` (`ConstraintOverridesSchema`); piano WP1 passo 1 (`PERSONS_MIN`/`PERSONS_MAX` in coda al file)
- Il limite 1..12 compare come letterale in due schemi di F2. Il piano introduce `PERSONS_MIN`/`PERSONS_MAX`, ma li mette **in coda** al file, dopo gli schemi che dovrebbero usarli: così non si possono riusare (un `const` letto prima della sua dichiarazione durante l'inizializzazione del modulo produce `ReferenceError`).
- Gli stessi requirements (P6) giustificano il valore 12 come "coincide con i limiti di F2". È esattamente il legame che una costante unica dovrebbe rendere esplicito, visto che `types.ts` è la single source of truth.
- `servings_base` (`:265`) è un concetto diverso (le porzioni della ricetta) e va lasciato com'è.

### Aree senza problemi da segnalare
- **Guardia di onboarding** con route group `app/(app)/` + `redirect()` server-side + `connection()`: è coerente con Next 15.5, evita il flash di contenuto e tiene `next build` lontano dal DB. Nessuna alternativa è migliore a questo costo.
- **Separazione client/server** in `lib/settings/` (niente barrel, `normalize.ts` e `client.ts` importabili dal client): `lib/domain/types.ts` importa solo `zod`, quindi i componenti client non trascinano il DB.
- **Formato HTTP** di `/api/settings`: identico a quello di F2, verificato.
- **Test**: stesso pattern di F2 (`isDbAvailable`/`skipIf`/`assertDbMigrated`, household dedicati). La correzione P15 di `updateHousehold` elimina l'ultimo effetto collaterale sul singleton.
- **Proporzionalità**: nessuna parte del piano è sovradimensionata. `SettingsRequestError` e `SaveSettingsResultSchema.safeParse` lato client sono il minimo per mostrare un errore sensato.
- **Concorrenza** di `saveSettings` (lettura e poi scrittura senza transazione): con un solo utente l'ultimo salvataggio vince, e `changed` al massimo è impreciso in un caso non raggiungibile dalla UI. Non serve intervenire.

---

## 2. Rischi introdotti o amplificati dalla feature

- **R1 — Il contratto U1 non copre le preferenze ingredienti (F5).** `ingredient_likes`/`ingredient_dislikes` entreranno nei vincoli (`lib/recipes/constraints.ts:25-26`) e nella selezione del planner, ma vivono in `ingredient_prefs` e non toccano `households.updated_at`. Un 👎 su un ingrediente del piano corrente non lo segnerebbe come "superato". Non va risolto in F3; va **deciso esplicitamente** nel piano di F4 (o F5): o si accetta (le preferenze agiscono dal prossimo piano senza banner), o si estende la regola.
- **R2 — Percorsi delle pagine.** Dopo WP2 la home è `app/(app)/page.tsx` e le tab sono sotto `app/(app)/`. Il piano di F4 va scritto su questi percorsi. Nessun documento autoritativo cita oggi `app/page.tsx`, quindi non c'è altro da correggere oltre alla wiki (già prevista dalla chiusura della feature).
- **R3 — Dipendenza dal P2.** Il contratto U1 viene usato per la prima volta in F4. Se P2 non si corregge ora, il difetto emergerebbe in F4, lontano dalla sua causa.
- Nessun rischio di amplificazione su moduli fragili: la feature tocca `household-repo` (piccolo, coperto da test) e non tocca l'adapter LLM né `recipe-repo`.

---

## 3. Proposte e punto di innesto

| ID | Proposta | Taglia | Innesto | Quando |
|---|---|---|---|---|
| P1 | In `household-repo.ts` aggiungere `export async function loadHousehold(id?: string): Promise<Household>`: senza `id` → `getDefaultHousehold()`; con `id` → `getHouseholdById(id)`, altrimenti `throw new Error(\`Household ${id} non trovato\`)`. Usarla in `lib/settings/service.ts` al posto della funzione interna del passo 6 e sostituire con essa le righe 70-79 di `lib/recipes/generate.ts` (comportamento e messaggio invariati; i test di F2 restano verdi). Aggiungere `lib/recipes/generate.ts` alla lista file di WP1. Nel test di `schema.test.ts` che verifica le funzioni del repo non serve nulla. | small | **WP1 passo 4** (repo) e **passo 6** (servizio) | prima, dentro WP1 |
| P2 | In `updateHousehold`: `updated_at: sql\`now()\`` (import `sql` da `drizzle-orm`) invece di `new Date()`, più un JSDoc che fissi l'invariante: *"`updated_at` = ultimo cambio dei vincoli o dell'onboarding; è il riferimento del contratto U1 (piano superato se `updated_at > meal_plans.created_at`). Non chiamare questa funzione per scritture che non cambiano i vincoli."* In `tests/helpers/db.ts` (`createTestHousehold`) togliere `created_at`/`updated_at` espliciti, così valgono i `defaultNow()` del DB e il test 3 del servizio ("`updated_at` successivo a quello iniziale") confronta due istanti dello stesso orologio. | small | **WP1 passo 4**; `tests/helpers/db.ts` da aggiungere alla lista file di WP1 | prima, dentro WP1 |
| P3 | Spostare `PERSONS_MIN = 1` / `PERSONS_MAX = 12` nella sezione dell'household, **prima** di `HouseholdSchema`, e usarli in `RecipeConstraintsSchema.persons` e `ConstraintOverridesSchema.persons`. `HouseholdSchema.persons` resta `min(1)` senza `max`: un eventuale valore fuori range in DB continua a fallire in `buildConstraints` come oggi, invece di rompere anche `GET /api/settings`. | small | **WP1 passo 1** | prima, dentro WP1 |
| R1 | Nessuna modifica in F3. Nel piano di F4, nella sezione contratti, fissare la regola per le preferenze ingredienti (accettare o estendere il contratto U1). | — | `/feature-plan 4` | dopo |
| R2 | Nessuna modifica in F3 oltre alla wiki già prevista. Nel piano di F4 usare `app/(app)/page.tsx` per la pagina Piano. | — | `/feature-plan 4` | dopo |

Nessuna delle proposte cambia contratti esposti, testi della UI, struttura delle wave o parallelismo WP3 ∥ WP4.

---

## 4. Se potessi migliorare solo 3 cose prima di procedere

1. **P2 — `updated_at` dall'orologio del DB, con l'invariante documentata.** È l'unico punto in cui questa feature consegna un contratto a un'altra (F4). Correggerlo ora costa due righe e un helper di test. Scoprirlo in F4 vorrebbe dire inseguire banner "piano superato" che compaiono a caso in sviluppo.
2. **P1 — `loadHousehold` nel repository.** Evita la seconda copia adesso e la terza in F4. Il costo è quasi nullo perché WP1 tocca già `household-repo.ts`.
3. **R1 — decidere in `/feature-plan 4` se le preferenze ingredienti rendono superato un piano.** Non costa codice in F3, ma se nessuno lo decide, F5 introdurrà un comportamento non specificato. Va preferito a P3, che resta una pulizia opzionale da fare se WP1 ha margine.

Il piano è per il resto **implementabile così com'è**: nessun refactoring preliminare è bloccante.

---

## Addendum (2026-09-28, dopo `/feature-review 3`)
- **Q1 — rinviata a F4 (decisione utente):** `getSettings()` è chiamato sia da `app/(app)/layout.tsx` sia dalle pagine del gruppo (oggi `/impostazioni`, in F4 anche il Piano): due letture dell'household per richiesta. Nel piano di F4 valutare `React.cache()` su `getSettings` / `loadHousehold` per deduplicarle nella stessa richiesta. Da considerare insieme a R1 e R2.
- **Autenticazione (decisione utente):** la v1 gira solo in locale su Raspberry + Tailscale (`ARCHITECTURE §8`); login e autenticazione delle API sono rinviati a una v2.
