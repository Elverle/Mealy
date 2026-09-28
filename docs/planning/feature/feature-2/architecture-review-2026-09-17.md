# Architecture review — Feature 2 (E1 Motore ricette)

**Data:** 2026-09-17 · **Piano esaminato:** [`plan.md`](plan.md) (+ [`requirements.md`](requirements.md)) · **Contesto:** as-built della Feature 1 (commit `bb5f247`), `docs/ARCHITECTURE.md`, `docs/planning/execution-strategy.md`, piano della Feature 7.

## Metodo e prove raccolte
- Gate eseguito sul codice attuale: `pnpm lint` ✅ (con avviso di deprecazione), `pnpm typecheck` ✅, `pnpm test` ✅ 49 passati / **1 saltato**.
- Avviato il Postgres di sviluppo (`docker compose -f docker-compose.dev.yml up -d`, container mai creato prima) ed eseguito `pnpm db:migrate` ✅.
- Rieseguito `tests/db/schema.test.ts` sul DB **attivo e migrato**: il test CRUD live è **ancora saltato** con il messaggio "PostgreSQL container not reachable".
- Script di prova (scratchpad, non nel repo) su DB reale: `ensureDefaultHousehold`, `insertRecipe` (con `qty` decimale e `null`), `getRecipeById`, `listRecipes`, `deleteRecipe` → **funzionano**; `similarity()` di pg_trgm: `'Pasta al pomodoro'` vs `'Pasta al pomodoro fresco'` = **0.708**, vs `'Pasta al Pomodoro!'` = **1.0**, `'Salmone al forno con patate'` vs `'Hamburger di manzo con patate al forno'` = **0.426** (coincidono con le ipotesi dei test di WP3/WP4).
- AI SDK 7: `@ai-sdk/provider-utils@5.0.43` contiene un convertitore dedicato `zod3ToJsonSchema` (lo `zod` 3.25 del progetto con API v3 è supportato); `@ai-sdk/google@4.0.74` invia lo schema come `responseJsonSchema` sanificando solo `const`, quindi `nullable` / `anyOf` / `minimum` dello schema di WP1 passano. Nessuna incompatibilità trovata.

---

## 1. Problemi attuali (ordinati per impatto)

### P1 — Il test DB live di F1 non gira mai su un DB migrato · **bloccante** per questa feature
**File:** `tests/db/schema.test.ts:401-433`, `:439-441`
- Il test applica a mano **solo** `0000_init_schema.sql` (`CREATE TABLE` senza `IF NOT EXISTS`). Su un DB già migrato con `pnpm db:migrate` il primo `CREATE TABLE` fallisce, il `catch` generico imposta `isDbAvailable = false` e il test viene **saltato come se il container fosse spento** (verificato).
- Nel caso opposto (DB nuovo, test lanciati prima di `db:migrate`) le tabelle vengono create **fuori dal journal di drizzle**: il successivo `pnpm db:migrate` riapplica `0000` e fallisce con "relation already exists" (dedotto dal codice: `0000` non è idempotente e `__drizzle_migrations` non esiste).
- Il test modifica il household singleton di default (`updateHousehold({ persons: 4 })`) senza ripristinarlo: sporca i dati di sviluppo su cui si basano seed, smoke test e le Feature 3 e 4.

**Perché conta ora:** WP4 rifattorizza `insertRecipe` in `insertRecipeWith(executor, …)`, e l'unico test d'integrazione di quella funzione è di fatto spento. In più contraddice la regola P18 del piano ("DB presente ma non migrato ⇒ fallimento esplicito, nessuno skip silenzioso").

### P2 — Un solo record non valido rompe la lettura dell'intera libreria · **da tenere d'occhio**
**File:** `lib/db/repositories/recipe-repo.ts:25-51` (`InsertIngredientInput`), `:66-92` (`formatRecipe`), `:222-236` (`listRecipes`)
- In scrittura il repository accetta `unit: Unit | string` e `category: Category | string`, e le colonne DB sono `text` senza vincolo `CHECK` (`lib/db/schema.ts`). In lettura, invece, `formatRecipe` esegue `RecipeSchema.parse` / `IngredientSchema.parse`, che **lanciano** con valori fuori enum.
- Risultato: un ingrediente scritto con `unit: 'kg'` fa fallire `listRecipes()` per **tutta** la libreria (F5), e con essa la selezione del planner (F4).
- Con questa feature la libreria inizia a ricevere dati da una fonte inaffidabile (l'LLM). Il piano li valida con Zod prima dell'inserimento, quindi oggi il rischio è contenuto; ma la firma del repository permette di aggirare la regola "ingredienti normalizzati alla fonte" (`ARCHITECTURE §4.1`) senza che il typecheck se ne accorga.

### P3 — Next.js dichiarato 16, installato 15.5; `next lint` deprecato · **da tenere d'occhio**
**File:** `package.json` (`next ^15.2.0` → 15.5.25), script `"lint": "next lint"`, `.eslintrc.json` (config legacy), `docs/wiki/topics/e0-fondamenta.md`, `docs/planning/feature/feature-1/requirements.md`, messaggio del commit `bb5f247`
- La documentazione autoritativa descrive una major diversa da quella reale. `pnpm lint` stampa: "`next lint` is deprecated and will be removed in Next.js 16".
- Per F2 non cambia nulla (Route Handler, `runtime`, `maxDuration` sono identici in 15 e 16). Diventa bloccante solo al passaggio a Next 16, dove lo script di lint smette di esistere.
- Chi implementa e si fida della wiki potrebbe usare API solo di Next 16 (per esempio `proxy.ts`, `cacheComponents`).

### P4 — Nessun DB di test separato; fallback silenzioso sul DB di sviluppo · **da tenere d'occhio**
**File:** `lib/db/index.ts:5-6`, `drizzle.config.ts:8`
- `DATABASE_URL` assente ⇒ connessione silenziosa a `mealy_dev`, **anche con `NODE_ENV=production`**. In F7 (Raspberry) una variabile mancante produce errori di connessione fuorvianti invece di un errore di configurazione chiaro.
- I test scrivono nello stesso DB dei dati di sviluppo. Il piano di F2 mitiga già il problema con household di test dedicati (P18): per questa feature basta così.

### P5 — Suite di test lenta per via di jsdom globale · **cosmetico**
**File:** `vitest.config.ts:8`
- 49 test in circa 50 s (`environment 93s` cumulati). Il piano di F2 prevede già `// @vitest-environment node` per i nuovi test lato server, quindi non peggiora la situazione. Nessuna azione necessaria ora.

### Aree senza problemi rilevanti
- **Tipi di dominio** (`lib/domain/types.ts`): enum chiusi, schemi e `DEFAULT_HOUSEHOLD` sono coerenti con `ARCHITECTURE §4`; le aggiunte di WP1 si innestano senza toccare l'esistente.
- **Schema DB e migrazioni** (`lib/db/schema.ts`, `0000` + `0001`): `pg_trgm` e l'indice GIN trigram sul titolo ci sono, le cascade sono corrette, la migrazione da zero funziona (verificato).
- **Repository in scrittura/lettura**: funzionano su DB reale, compreso il round-trip `numeric` ↔ `number` e `null` (verificato).
- **Confini dei moduli**: `lib/llm/` è vuoto e nessun modulo parla già con un provider; la regola "solo `recipes` → `llm`" parte pulita.

---

## 2. Rischi introdotti o amplificati dal piano

| ID | Rischio | Legato a | Impatto |
|---|---|---|---|
| R1 | WP4 rifattorizza `insertRecipe` senza un test d'integrazione funzionante (vedi P1); WP3 (seed) usa la stessa funzione nella wave precedente | P1 | **bloccante** |
| R2 | `generateAndStoreRecipes` apre una **propria** transazione con advisory lock. Se F4 (`POST /api/plans`, protocollo `needMore`) la chiamasse dentro una transazione già aperta, la scrittura avverrebbe su una connessione separata: niente atomicità col piano, e un possibile blocco se la transazione esterna tiene lock su `recipes`. Il contratto non lo dice | nuovo | da tenere d'occhio |
| R3 | Il modello di default `gemini-2.5-flash` potrebbe non essere più disponibile nel free tier al momento dello smoke test (la documentazione attuale dell'AI SDK usa già modelli Gemini più recenti negli esempi). Il danno è limitato perché il modello si cambia via env, ma lo smoke test fallirebbe con un 4xx del provider mappato su `llm_unavailable` | U1 | da tenere d'occhio |
| R4 | Le nuove ricette dall'LLM ampliano la superficie di P2: se in futuro qualcuno inserisse ricette senza passare da `GeneratedRecipeSchema` (per esempio una ricetta "manuale" in F5), la libreria intera potrebbe diventare illeggibile | P2 | da tenere d'occhio |
| R5 | Le 18 fixture hanno tutte lo stesso `created_at` (`FIXTURE_CREATED_AT`): `listRecipes` / `listRecipeTitles` ordinano solo per `created_at`, quindi l'ordine tra fixture non è deterministico | nuovo | cosmetico (nessun test di F2 dipende dall'ordine) |

**Aderenza ai pattern:** il piano riusa i repository esistenti (senza cambiarne le firme), la single source of truth dei tipi, lo stile dei test e il controllo di disponibilità del DB di F1. Non duplica logica: la normalizzazione è concentrata in `lib/domain/recipe-text.ts` e condivisa da seed, adapter e servizio.

**Proporzionalità:** nessun eccesso di ingegneria rilevante. Advisory lock, dedup dentro il batch e `overrides` sono piccoli e motivati. Lo script `llm:record` è una scelta esplicita dell'utente ed è isolato (solo typecheck). Il ciclo `-2…-99` per gli slug è più verboso di una singola query `LIKE`, ma è corretto e non merita una modifica.

**Serve un refactoring preliminare?** Solo P1 (piccolo), da fare **prima** di WP3/WP4. Il resto del piano si implementa così com'è.

---

## 3. Proposte di miglioramento (con aggancio ai WP)

### Fix-P1 — Rendere reale il test CRUD di F1 · piccolo · **dentro WP1, prima delle wave 2–3**
Aggiungere `tests/db/schema.test.ts` all'elenco dei file di WP1 e, **dopo** aver creato `tests/helpers/db.ts`:
1. Nel `describe('WP2 Repository Pattern Integration & CRUD')`, sostituire il blocco manuale "disponibilità + applicazione di `0000`" (righe ~402-433) con: `const dbUp = await isDbAvailable();` a livello di modulo, il test live dentro `describe.skipIf(!dbUp)` e `beforeAll(assertDbMigrated)`. **Eliminare** l'esecuzione manuale dei file SQL e gli import `fs` / `path` diventati inutili, se nessun altro test del file li usa (i test `WP2 Migration Generation & File Verification` li usano: in quel caso lasciarli).
2. Lasciare `ensureDefaultHousehold()` (idempotente), ma sostituire `updateHousehold({ persons: 4 })` sul singleton con: `const testId = await createTestHousehold();` → `updateHousehold({ persons: 4 }, testId)` → verifica → inserire la ricetta di prova con `household_id: testId`; in `finally` chiamare `deleteTestHousehold(testId)`. Il household di default non deve più essere modificato.
3. Criterio d'accettazione aggiuntivo per WP1: con il DB attivo e migrato, `pnpm vitest run tests/db/schema.test.ts` riporta **0 skipped**; con il container fermo il test è saltato; dopo l'esecuzione, `select persons from households where id = '00000000-0000-0000-0000-000000000001'` è invariato.

### Fix-P2 — Tipi stretti in ingresso al repository · piccolo · **dentro WP4, passo 1**
In `lib/db/repositories/recipe-repo.ts` cambiare `InsertIngredientInput.unit: Unit | string` → `unit: Unit` e `category: Category | string` → `category: Category`. Il test di F1 e il seed di WP3 passano già valori degli enum. Il typecheck del gate verifica che nessun chiamante si rompa. Non aggiungere vincoli `CHECK` al DB in questa feature: servirebbe una migrazione, fuori scope; da rivalutare in F5 insieme alla migrazione di `ingredient_prefs`.
Rendere `listRecipes` tollerante ai record invalidi **non** è previsto qui: con input tipizzati e validati alla fonte il costo supera il beneficio.

### Fix-R2 — Chiarire il contratto transazionale del servizio · minimo · **dentro WP4, passo 3**
Nel JSDoc di `generateAndStoreRecipes` aggiungere: *"Apre una propria transazione con advisory lock ed esegue la chiamata LLM fuori da qualsiasi transazione: non va invocata dentro una transazione del chiamante (F4 deve chiamarla prima di aprire la transazione del piano)."* Stessa nota nella sezione "Contratti esposti" di WP4, perché `/feature-plan 4` la legga.

### Fix-R3 — Verificare il modello prima dello smoke test · minimo · **dentro WP1 (`.env.example`) e allo smoke test di WP4**
- In `.env.example`, sopra `LLM_MODEL=gemini-2.5-flash`, aggiungere il commento: `# Verificare che il modello sia disponibile nel proprio piano Gemini (https://ai.google.dev/gemini-api/docs/models); si cambia solo qui.`
- Nello smoke test di WP4, passo 1: se la prima chiamata risponde `llm_unavailable`, controllare nel log del server (`[api/recipes/generate]`) lo status del provider prima di sospettare il codice (un 404 indica un modello inesistente).

### Fix-P3 — Allineare la documentazione alla versione reale · piccolo · **chiusura della feature (step del documenter), dopo WP4**
Il `feature-documenter` di `/feature-dev 2` corregge "Next.js 16" → "Next.js 15.5" in `docs/wiki/topics/e0-fondamenta.md` (e nelle altre pagine wiki che lo citano). La migrazione di `next lint` alla CLI di ESLint e l'eventuale upgrade a Next 16 **non** vanno fatti in questa feature: meglio una feature o un chore dedicato prima di F7 (deploy), per non mescolare un cambio di framework con il motore ricette.

### Fix-P4 — Errore esplicito senza `DATABASE_URL` in produzione · piccolo · **Feature 7, non ora**
In `lib/db/index.ts`: se `NODE_ENV === 'production'` e `DATABASE_URL` è assente, lanciare `Error('DATABASE_URL non impostata')` invece di usare il fallback. Va agganciato al piano di F7 (`/feature-plan 7`), dove si definiscono i secret del Raspberry. In F2 nessun intervento.

### P5, R5 — nessuna azione
P5 è già mitigato dal piano; R5 non ha effetti su F2 (da ricordare in F5 se la Libreria ordinerà per data: aggiungere un secondo criterio d'ordinamento su `title`).

---

## 4. Se potessi migliorare solo 3 cose prima di procedere

1. **Fix-P1 (dentro WP1).** È l'unico punto bloccante: senza, il refactoring di `insertRecipe` in WP4 e il seed di WP3 non hanno alcuna rete di sicurezza d'integrazione, il gate "verde" nasconde un test sempre saltato e i dati di sviluppo vengono sporcati a ogni esecuzione. Costa poco perché WP1 crea proprio gli helper necessari.
2. **Fix-P2 (dentro WP4).** Da questa feature la libreria riceve dati generati dall'LLM. Tipizzare strettamente l'ingresso del repository chiude, a costo quasi nullo, l'unica strada per cui un valore fuori enum può rendere illeggibile l'intera libreria per F4 e F5.
3. **Fix-R2 (dentro WP4).** È una sola frase di contratto, ma evita che F4, pianificato senza questo contesto, annidi la generazione dentro la transazione del piano: un errore che emergerebbe solo come blocco o incoerenza a runtime, difficile da diagnosticare.

Fix-R3 e Fix-P3 sono economici e vanno fatti nei punti indicati, ma non cambiano la solidità della feature; Fix-P4 appartiene alla Feature 7.
