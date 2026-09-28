# Feature 3 — E5 Impostazioni · Piano di implementazione

**Data:** 2026-09-17 · **Stato:** done · **Input di:** `/arch-review 3` → `/feature-dev 3`
**Story:** S5.1 Onboarding e impostazioni (`docs/BACKLOG.md`)
**Decisioni motivate:** [`requirements.md`](requirements.md) (U1–U3 dell'utente, P1–P16 di planning), recepite qui come definitive.

---

## 0. Contesto per chi implementa (leggere tutto prima del proprio WP)

### 0.1 Obiettivo
I vincoli dell'household entrano davvero nel sistema: `GET/PUT /api/settings`, wizard a 5 passi obbligatorio al primo avvio, form unico di modifica con pulsante Salva e banner "Il prossimo piano userà i nuovi vincoli.".

### 0.2 Stato del codice su cui si lavora
**Prerequisito:** la Feature 2 è già implementata. Se un nome qui sotto differisce nel codice reale, **vince il codice reale**: adeguarsi mantenendo il comportamento descritto.
- Next.js **15.5** App Router (root senza `src/`, alias `@/*` → `./*`), React 19, zod 3.25, Drizzle + postgres.js, Vitest (ambiente globale **jsdom**; i test lato server iniziano con `// @vitest-environment node`), Testing Library, Tailwind v4 con token `paper / ink / basil / tomato / saffron / stone` (`app/globals.css`), font `font-display` (Fraunces) e `font-sans` (Figtree).
- `app/layout.tsx` — root layout: font, `<div className="flex-1 pb-24">{children}</div>` e `<BottomNav />`.
- `app/page.tsx`, `app/lista/page.tsx`, `app/libreria/page.tsx`, `app/impostazioni/page.tsx` — pagine client (`"use client"`) con **dati finti**. `app/impostazioni/page.tsx` è il mock da sostituire (sezioni: persone 1–6, pasti, diete, elettrodomestici, "I miei ingredienti" con liste finte).
- `components/navigation/bottom-nav.tsx` (`BottomNav`), `components/filters/chip-filter.tsx` (`ChipFilter`: `role="checkbox"`, `aria-checked`, `min-h-[44px]`, props `label`, `isSelected`, `onClick`), `components/ui/{button,card,badge,checkbox,sheet}.tsx` (`Button` con varianti `default | destructive | outline | secondary | ghost | link` e taglie `default | sm | lg | icon`; `Card`), `components/feedback/empty-state.tsx`, `lib/utils.ts` (`cn`).
- `lib/domain/types.ts` — enum ed etichette: `MEAL_TYPE_VALUES`, `MEAL_STYLE_TAG_VALUES`, `DIET_FLAG_VALUES` + `DIET_FLAG_LABELS`, `APPLIANCE_VALUES` + `APPLIANCE_LABELS`, `HouseholdSchema`, `Household`, `DEFAULT_HOUSEHOLD_ID`, `DEFAULT_HOUSEHOLD` (+ contratti aggiunti da F2).
- `lib/db/schema.ts` — tabella `households` (`id, persons, meals, diet_tags, meal_style_tags, appliances, created_at, updated_at`).
- `lib/db/repositories/household-repo.ts` — `getHouseholdById`, `ensureDefaultHousehold`, `getDefaultHousehold`, `updateHousehold(data, id = DEFAULT_HOUSEHOLD_ID)`.
- Da F2: `tests/helpers/db.ts` (`isDbAvailable`, `assertDbMigrated`, `createTestHousehold`, `deleteTestHousehold`), `lib/recipes/constraints.ts` (`buildConstraints(household, mealType, overrides?)`), la route `app/api/recipes/generate/route.ts` (riferimento per il formato degli errori HTTP).
- Test di F1 che toccano i file interessati: `tests/ui/shell.test.tsx` (importa le 4 pagine; renderizza `<SettingsPage />` e si aspetta i testi `Impostazioni` (h1), `Persone nel nucleo`, `I miei ingredienti`), `tests/home.test.tsx` (importa `@/app/page`), `tests/verification.test.ts` (verifica che esista `app/page.tsx`), `tests/db/schema.test.ts` (colonne di `households`, `HouseholdSchema.parse(DEFAULT_HOUSEHOLD)`).

### 0.3 Regole vincolanti
1. Tipi e schemi di dominio **solo** in `lib/domain/types.ts`.
2. I componenti client (`"use client"`) importano da `lib/settings/` **solo** `normalize.ts` e `client.ts`, **mai** `service.ts` (che importa il DB). Non creare `lib/settings/index.ts`.
3. UI copy in italiano, esattamente come scritta nel piano. Tap target ≥ 44 px, focus visibile (`focus-visible:ring-2 focus-visible:ring-basil`), niente animazioni oltre alle transizioni di colore già usate da `ChipFilter`.
4. Gate per ogni wave: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdi. Test DB: `docker compose -f docker-compose.dev.yml up -d` e `pnpm db:migrate`.

### 0.4 Mappa dei work package
| WP | Wave | Contenuto |
|---|---|---|
| WP1 | 1 (da solo) | Contratti, colonna `onboarded_at` + migrazione, repository, servizio settings, `GET/PUT /api/settings` |
| WP2 | 2 (da solo) | Controlli condivisi dei campi, client fetch, route group `app/(app)` con guardia di onboarding, spostamento delle pagine |
| WP3 | 3 | Form di modifica in `/impostazioni` (Salva, banner, errori, segnaposto ingredienti) |
| WP4 | 3 | Wizard in `/benvenuto` |

---

## WP1 — Dati, servizio e API delle impostazioni (wave 1)

**Obiettivo:** persistere i vincoli e lo stato di onboarding dell'household ed esporli con un servizio testato e con `GET/PUT /api/settings`.

### File
- Modifica: `lib/domain/types.ts`, `lib/db/schema.ts`, `lib/db/repositories/household-repo.ts`
- Crea (generato): `lib/db/migrations/0002_add_household_onboarded_at.sql` + aggiornamenti in `lib/db/migrations/meta/` (`_journal.json`, `0002_snapshot.json`)
- Crea: `lib/settings/normalize.ts`, `lib/settings/service.ts`, `app/api/settings/route.ts`
- Crea: `tests/settings/normalize.test.ts`, `tests/settings/service.test.ts`, `tests/api/settings.test.ts`

### Pattern di riferimento
- Schemi/etichette: stile esistente in `lib/domain/types.ts` (`DIET_FLAG_LABELS`).
- Route Handler ed errori: `app/api/recipes/generate/route.ts` (F2): `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `Response.json`, corpo d'errore `{ error: { code, message, details? } }`, `console.error('[api/…]', err)`.
- Test DB: `tests/recipes/generate.test.ts` (F2): `const dbUp = await isDbAvailable()`, `describe.skipIf(!dbUp)`, `beforeAll(assertDbMigrated)`, household dedicati.

### Passi

**1. `lib/domain/types.ts`** — solo aggiunte e due modifiche puntuali:
- Dopo `MealTypeSchema`/`MealType` aggiungere:
  ```ts
  export const MEAL_TYPE_LABELS: Record<MealType, string> = { pranzo: 'Pranzo', cena: 'Cena' };
  ```
- Dopo `MealStyleTag` aggiungere:
  ```ts
  export const MEAL_STYLE_TAG_LABELS: Record<MealStyleTag, string> = {
    veloce: 'Veloce',
    salutare: 'Salutare',
    proteico: 'Proteico',
    leggero: 'Leggero',
    'comfort-food': 'Comfort food',
    economico: 'Economico',
    'piatto-unico': 'Piatto unico',
  };
  ```
- In `HouseholdSchema`, dopo `appliances`, aggiungere: `onboarded_at: z.coerce.date().nullable().default(null),`
- In `DEFAULT_HOUSEHOLD`, dopo `appliances`, aggiungere: `onboarded_at: null,`
- In coda al file, sezione `// Household Settings (Feature 3)`:
  ```ts
  export const PERSONS_MIN = 1;
  export const PERSONS_MAX = 12;

  export const HouseholdSettingsSchema = z
    .object({
      persons: z.number().int().min(PERSONS_MIN).max(PERSONS_MAX),
      meals: z.array(MealTypeSchema).min(1),
      meal_style_tags: z.array(MealStyleTagSchema),
      diet_tags: z.array(DietFlagSchema),
      appliances: z.array(ApplianceSchema),
    })
    .strict();
  export type HouseholdSettings = z.infer<typeof HouseholdSettingsSchema>;

  // Body di PUT /api/settings
  export const UpdateSettingsRequestSchema = HouseholdSettingsSchema.extend({
    complete_onboarding: z.boolean().default(false),
  }).strict();
  export type UpdateSettingsRequest = z.input<typeof UpdateSettingsRequestSchema>;

  // Risposta di GET /api/settings. updated_at (ISO) è il riferimento per F4:
  // un piano è superato dai vincoli se updated_at > meal_plans.created_at.
  export const SettingsViewSchema = z.object({
    persons: z.number().int(),
    meals: z.array(MealTypeSchema),
    meal_style_tags: z.array(MealStyleTagSchema),
    diet_tags: z.array(DietFlagSchema),
    appliances: z.array(ApplianceSchema),
    onboarded: z.boolean(),
    updated_at: z.string().datetime(),
  });
  export type SettingsView = z.infer<typeof SettingsViewSchema>;

  // Risposta di PUT /api/settings
  export const SaveSettingsResultSchema = z.object({
    settings: SettingsViewSchema,
    changed: z.boolean(),
  });
  export type SaveSettingsResult = z.infer<typeof SaveSettingsResultSchema>;
  ```
  Nota: `UpdateSettingsRequest` usa `z.input` perché `complete_onboarding` è facoltativo in ingresso.

**2. `lib/db/schema.ts`** — in `households`, dopo `appliances`, aggiungere:
`onboarded_at: timestamp('onboarded_at', { withTimezone: true }),`

**3. Migrazione** — eseguire `pnpm db:generate --name add_household_onboarded_at`. Il file generato deve chiamarsi `lib/db/migrations/0002_add_household_onboarded_at.sql` e contenere **solo** `ALTER TABLE "households" ADD COLUMN "onboarded_at" timestamp with time zone;`. Se drizzle-kit genera altre istruzioni (per esempio DROP/CREATE di indici), **non** modificare a mano snapshot o journal: annullare i file generati, verificare che `lib/db/schema.ts` coincida con `meta/0001_snapshot.json` a parte la nuova colonna, e segnalare la discrepanza all'orchestratore. Poi `pnpm db:migrate`.

**4. `lib/db/repositories/household-repo.ts`**
- `ensureDefaultHousehold`: aggiungere `onboarded_at: null` ai valori inseriti.
- `updateHousehold`: sostituire la chiamata incondizionata `await ensureDefaultHousehold();` con `if (id === DEFAULT_HOUSEHOLD_ID) await ensureDefaultHousehold();`; aggiungere `if (data.onboarded_at !== undefined) updateValues.onboarded_at = data.onboarded_at;`. Il resto è invariato (il messaggio `Household with id … not found for update` resta per gli id inesistenti).

**5. `lib/settings/normalize.ts`** (puro, importabile dal client; importa solo da `@/lib/domain/types`)
```ts
export function normalizeSettings(settings: HouseholdSettings): HouseholdSettings;
export function settingsEqual(a: HouseholdSettings, b: HouseholdSettings): boolean;
export function householdToSettings(household: Household): HouseholdSettings;
export function toSettingsView(household: Household): SettingsView;
export function toggleInOrder<T extends string>(values: readonly T[], order: readonly T[], value: T): T[];
```
- `normalizeSettings`: ritorna un nuovo oggetto con `persons` invariato e ciascun array ridotto ai valori presenti, senza duplicati e **nell'ordine dell'enum** (`MEAL_TYPE_VALUES`, `MEAL_STYLE_TAG_VALUES`, `DIET_FLAG_VALUES`, `APPLIANCE_VALUES`). Esempio: `meals: ['cena','pranzo','cena']` → `['pranzo','cena']`.
- `settingsEqual`: `true` se, dopo `normalizeSettings` di entrambi, `persons` è uguale e i quattro array hanno gli stessi elementi nello stesso ordine.
- `householdToSettings`: `normalizeSettings` dei 5 campi dell'household (nessuna validazione: un household con `meals` vuoto restituisce `meals: []`).
- `toSettingsView`: `{ ...householdToSettings(h), onboarded: h.onboarded_at !== null, updated_at: h.updated_at.toISOString() }`.
- `toggleInOrder(values, order, value)`: se `value` è in `values` lo toglie, altrimenti lo aggiunge; ritorna `order.filter(v => nuovoInsieme.has(v))`. Usata dai controlli UI (WP2).

**6. `lib/settings/service.ts`** (solo server; commento in testa: `// Solo lato server: importa il DB. I componenti client usano normalize.ts e client.ts.`)
```ts
export async function getSettings(householdId?: string): Promise<SettingsView>;
export async function saveSettings(input: UpdateSettingsRequest, householdId?: string): Promise<SaveSettingsResult>;
```
- Lettura dell'household (funzione interna `loadHousehold(id = DEFAULT_HOUSEHOLD_ID)`): se `id === DEFAULT_HOUSEHOLD_ID` → `getDefaultHousehold()`; altrimenti `getHouseholdById(id)`, e se `null` → `throw new Error(\`Household ${id} non trovato\`)`.
- `getSettings` → `toSettingsView(await loadHousehold(householdId))`.
- `saveSettings`:
  1. `const parsed = UpdateSettingsRequestSchema.parse(input)` (lo `ZodError` si propaga);
  2. `const { complete_onboarding, ...fields } = parsed; const next = normalizeSettings(fields);`
  3. `const current = await loadHousehold(householdId);`
  4. `const changed = !settingsEqual(next, householdToSettings(current));`
  5. `const completing = complete_onboarding && current.onboarded_at === null;`
  6. se `!changed && !completing` → ritorna `{ settings: toSettingsView(current), changed: false }` **senza scrivere**;
  7. altrimenti `const updated = await updateHousehold({ ...next, ...(completing ? { onboarded_at: new Date() } : {}) }, current.id)` → ritorna `{ settings: toSettingsView(updated), changed }`.

**7. `app/api/settings/route.ts`**
```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(): Promise<Response>;
export async function PUT(request: Request): Promise<Response>;
```
Import consentiti: `@/lib/settings/service`, `@/lib/domain/types`.
- `GET` → 200 `Response.json(await getSettings())`. Errore → `console.error('[api/settings]', err)` + 500 `{ error: { code: 'internal_error', message: 'Qualcosa è andato storto. Riprova.' } }`.
- `PUT`:
  1. `await request.json()` fallisce → 400 `{ error: { code: 'invalid_request', message: 'Richiesta non valida.' } }`;
  2. `UpdateSettingsRequestSchema.safeParse(body)` fallisce → 400 `{ error: { code: 'invalid_request', message: 'Richiesta non valida.', details: issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } }`;
  3. `Response.json(await saveSettings(parsed.data))` → 200;
  4. altro errore → come per `GET` (500 `internal_error`, nessun dettaglio interno nel corpo).

**8. Test**
- `tests/settings/normalize.test.ts` (`// @vitest-environment node`): ordine e deduplica di `normalizeSettings`; `settingsEqual` vero con array in ordine diverso e falso con `persons` diverso; `toSettingsView` con `onboarded_at: null` → `onboarded: false` e con una data → `true`, `updated_at` in ISO; `toggleInOrder(['cena'], MEAL_TYPE_VALUES, 'pranzo')` → `['pranzo','cena']`, `toggleInOrder(['pranzo','cena'], MEAL_TYPE_VALUES, 'pranzo')` → `['cena']`; `HouseholdSchema.parse({...DEFAULT_HOUSEHOLD})` ha `onboarded_at === null`; un oggetto household senza `onboarded_at` viene parsato con `null`; `UpdateSettingsRequestSchema` rifiuta `persons: 0`, `persons: 13`, `meals: []`, `diet_tags: ['keto']` e chiavi sconosciute, e mette `complete_onboarding: false` di default.
- `tests/settings/service.test.ts` (`// @vitest-environment node`; `describe.skipIf(!dbUp)`, `beforeAll(assertDbMigrated)`; ogni test crea un household con `createTestHousehold()` e lo elimina in `afterEach`; si passa sempre `householdId`):
  1. `getSettings(id)` → `onboarded: false`, campi uguali ai default di `DEFAULT_HOUSEHOLD` (normalizzati).
  2. `saveSettings(stessiValori, id)` → `changed: false`; `updated_at` identico a prima.
  3. `saveSettings({ persons: 4, meals: ['cena'], meal_style_tags: ['proteico','veloce'], diet_tags: ['vegano'], appliances: ['friggitrice-ad-aria'] }, id)` → `changed: true`; `meal_style_tags` salvato come `['veloce','proteico']`; `updated_at` successivo a quello iniziale; rileggendo con `getSettings(id)` si ottengono gli stessi valori.
  4. `saveSettings({ ...stessiValori, complete_onboarding: true }, id)` → `changed: false`, `settings.onboarded: true`; una seconda chiamata identica non cambia `onboarded_at` (verificare con `getHouseholdById(id)`).
  5. `saveSettings({ ...valori, meals: [] }, id)` → rifiuta con `ZodError`; nessuna modifica in DB.
  6. `saveSettings(valori, crypto.randomUUID())` → rifiuta con messaggio che contiene `non trovato`.
  7. **Vincoli verso planner e LLM:** dopo il test 3, `buildConstraints((await getHouseholdById(id))!, null)` (da `@/lib/recipes/constraints`) ha `persons: 4`, `diet_tags: ['vegano']`, `appliances: ['friggitrice-ad-aria']`, `meal_style_tags: ['veloce','proteico']`.
  8. La migrazione `lib/db/migrations/0002_add_household_onboarded_at.sql` esiste e contiene `ADD COLUMN "onboarded_at"` (lettura file, eseguibile anche senza DB: metterlo in un `describe` separato **fuori** da `skipIf`).
- `tests/api/settings.test.ts` (`// @vitest-environment node`; `vi.mock('@/lib/settings/service', () => ({ getSettings: vi.fn(), saveSettings: vi.fn() }))`):
  - `GET` → 200 con il valore del mock; mock che lancia → 500 `internal_error`, il corpo non contiene il messaggio originale.
  - `PUT` con corpo `'{'` → 400; con `{ persons: 0, … }` → 400 con `details` che contiene un elemento con `path: 'persons'`; con `{ foo: 1 }` → 400.
  - `PUT` valido senza `complete_onboarding` → `saveSettings` chiamato con l'oggetto parsato (`complete_onboarding: false`), 200 con il risultato del mock.
  - `PUT` valido con `complete_onboarding: true` → inoltrato.

### Contratti esposti
- Da `@/lib/domain/types`: `MEAL_TYPE_LABELS`, `MEAL_STYLE_TAG_LABELS`, `PERSONS_MIN`, `PERSONS_MAX`, `HouseholdSettingsSchema`/`HouseholdSettings`, `UpdateSettingsRequestSchema`/`UpdateSettingsRequest`, `SettingsViewSchema`/`SettingsView`, `SaveSettingsResultSchema`/`SaveSettingsResult`, `Household.onboarded_at: Date | null`.
- Da `@/lib/settings/normalize`: le 5 funzioni del passo 5.
- Da `@/lib/settings/service`: `getSettings(householdId?)`, `saveSettings(input, householdId?)`.
- **HTTP**
  - `GET /api/settings` → 200 `SettingsView` (`{ persons, meals, meal_style_tags, diet_tags, appliances, onboarded, updated_at }`).
  - `PUT /api/settings` — body `{ persons, meals, meal_style_tags, diet_tags, appliances, complete_onboarding? }` → 200 `{ settings: SettingsView, changed: boolean }`; 400 `invalid_request` (+ `details`); 500 `internal_error`.
- **Contratto per F4 (decisione U1):** un piano è *superato dai vincoli* se `Date.parse(settings.updated_at) > plan.created_at`. `updated_at` cambia solo quando i vincoli cambiano davvero o quando si completa l'onboarding (che avviene prima di qualsiasi piano).

### Dipendenze
F2 già implementata (`tests/helpers/db.ts`, `buildConstraints`). Nessun altro WP di questa feature.

### Criteri di accettazione
- `pnpm db:migrate` applica `0002` su un DB migrato fino a `0001`; `households.onboarded_at` esiste ed è `null` per le righe esistenti.
- I tre file di test passano; i test di F1 e F2 restano verdi.
- `curl localhost:3000/api/settings` risponde con i campi di `SettingsView`.

### Fuori scope
UI (WP2–WP4); `ingredient_prefs` (F5); più household o utenti; storico delle modifiche.

---

## WP2 — Controlli condivisi, client e guardia di onboarding (wave 2)

**Obiettivo:** fornire i controlli dei 5 campi riusati da wizard e form, la funzione client per salvare, e il route group `app/(app)` che reindirizza a `/benvenuto` finché l'onboarding non è completato.

### File
- Sposta con `git mv` (contenuto invariato):
  `app/page.tsx` → `app/(app)/page.tsx`
  `app/lista/page.tsx` → `app/(app)/lista/page.tsx`
  `app/libreria/page.tsx` → `app/(app)/libreria/page.tsx`
  `app/impostazioni/page.tsx` → `app/(app)/impostazioni/page.tsx`
- Crea: `app/(app)/layout.tsx`, `components/settings/settings-fields.tsx`, `lib/settings/client.ts`
- Modifica: `app/layout.tsx`, `tests/ui/shell.test.tsx` (solo gli import delle pagine), `tests/home.test.tsx` (solo l'import), `tests/verification.test.ts` (solo il percorso `app/page.tsx`)
- Crea: `tests/ui/settings-fields.test.tsx`, `tests/settings/client.test.ts`, `tests/app/app-layout.test.tsx`

### Pattern di riferimento
- Chip di selezione: `components/filters/chip-filter.tsx` (**riusarlo**, non ricreare pulsanti-chip come nel mock).
- Card e pulsanti: `components/ui/card.tsx`, `components/ui/button.tsx`.
- Accessibilità della navigazione: `components/navigation/bottom-nav.tsx`.

### Passi

**1. Spostamento delle pagine.** Eseguire i 4 `git mv`. Poi:
- `tests/ui/shell.test.tsx`: `@/app/page` → `@/app/(app)/page`, `@/app/lista/page` → `@/app/(app)/lista/page`, `@/app/libreria/page` → `@/app/(app)/libreria/page`, `@/app/impostazioni/page` → `@/app/(app)/impostazioni/page`.
- `tests/home.test.tsx`: `@/app/page` → `@/app/(app)/page`.
- `tests/verification.test.ts`: nell'elenco `requiredFiles`, `"app/page.tsx"` → `"app/(app)/page.tsx"`.
Gli URL (`/`, `/lista`, `/libreria`, `/impostazioni`) non cambiano. `BottomNav` non va modificata.

**2. `app/layout.tsx`** — rimuovere l'import e il rendering di `BottomNav` e il `div` wrapper: il `body` (stesse classi di oggi) contiene solo `{children}`. Font e metadata invariati.

**3. `app/(app)/layout.tsx`** (server component)
```tsx
import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { BottomNav } from '@/components/navigation/bottom-nav';
import { getSettings } from '@/lib/settings/service';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const settings = await getSettings();
  if (!settings.onboarded) redirect('/benvenuto');
  return (
    <>
      <div className="flex-1 pb-24">{children}</div>
      <BottomNav />
    </>
  );
}
```
Nessuna gestione speciale degli errori: un DB irraggiungibile produce l'errore standard di Next.

**4. `lib/settings/client.ts`** (importabile dal client)
```ts
export class SettingsRequestError extends Error {
  readonly status: number;
  readonly code: string; // error.code della risposta, oppure 'network_error' / 'invalid_response'
}
export async function putSettings(body: UpdateSettingsRequest): Promise<SaveSettingsResult>;
```
- `fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })`.
- `fetch` che lancia → `SettingsRequestError` con `status: 0`, `code: 'network_error'`, messaggio `Connessione non disponibile.`
- Risposta non 2xx → leggere il JSON (se non leggibile, `code: 'unknown_error'`) e lanciare `SettingsRequestError(status, body.error.code, body.error.message)`.
- Risposta 2xx → `SaveSettingsResultSchema.safeParse(json)`; se fallisce → `SettingsRequestError(status, 'invalid_response', 'Risposta del server non valida.')`; altrimenti ritorna i dati.

**5. `components/settings/settings-fields.tsx`** (`"use client"`)
```ts
export type SettingsFieldKey = 'persons' | 'meals' | 'meal_style_tags' | 'diet_tags' | 'appliances';
export const SETTINGS_FIELD_ORDER: readonly SettingsFieldKey[]; // ['persons','meals','meal_style_tags','diet_tags','appliances']
export const SETTINGS_FIELD_COPY: Record<SettingsFieldKey, { title: string; description: string }>;
export function isSettingsFieldValid(key: SettingsFieldKey, settings: HouseholdSettings): boolean;

interface FieldProps<T> {
  value: T;
  onChange: (value: T) => void;
  headingLevel?: 'h1' | 'h2';   // default 'h2'
  headingRef?: React.Ref<HTMLHeadingElement>; // usato dal wizard per spostare il focus
}
export function PersonsField(props: FieldProps<number>): React.JSX.Element;
export function MealsField(props: FieldProps<MealType[]>): React.JSX.Element;
export function MealStyleField(props: FieldProps<MealStyleTag[]>): React.JSX.Element;
export function DietField(props: FieldProps<DietFlag[]>): React.JSX.Element;
export function AppliancesField(props: FieldProps<Appliance[]>): React.JSX.Element;
export function SettingsField(props: { fieldKey: SettingsFieldKey; settings: HouseholdSettings; onChange: (next: HouseholdSettings) => void; headingLevel?: 'h1' | 'h2'; headingRef?: React.Ref<HTMLHeadingElement> }): React.JSX.Element;
```
- `SETTINGS_FIELD_COPY` (testi esatti):
  | chiave | title | description |
  |---|---|---|
  | `persons` | Persone nel nucleo | Serve a calcolare le porzioni e le quantità della spesa. |
  | `meals` | Pasti da pianificare | Quali pasti vuoi trovare nel piano settimanale? |
  | `meal_style_tags` | Tipo di pasti | Che cucina preferisci? La useremo come preferenza, non come obbligo. |
  | `diet_tags` | Esigenze alimentari | Le ricette proposte le rispetteranno sempre. |
  | `appliances` | Elettrodomestici | Proporremo solo ricette che puoi preparare con questi. |
- `isSettingsFieldValid`: `meals` → `settings.meals.length >= 1`; `persons` → intero in `[PERSONS_MIN, PERSONS_MAX]`; gli altri → sempre `true`.
- Struttura comune di ogni campo: `<section aria-labelledby={id}>` con heading (`headingLevel`, classi `font-display text-base font-bold text-ink` per `h2`, `font-display text-2xl font-bold text-ink` per `h1`, `tabIndex={-1}` e `ref={headingRef}`), `<p className="text-xs text-stone">{description}</p>`, poi il controllo. Gli id vengono da `React.useId()`.
- `PersonsField`: riga con `Button` `variant="outline"` `size="icon"` (icona `Minus`, `aria-label="Una persona in meno"`, disabilitato se `value <= PERSONS_MIN`), valore `<output aria-live="polite" className="font-bold text-basil text-2xl tabular-nums">{value}</output>` seguito dal testo `persona` se 1, altrimenti `persone`, e `Button` con icona `Plus` (`aria-label="Una persona in più"`, disabilitato se `value >= PERSONS_MAX`). I click chiamano `onChange(value ∓ 1)`.
- `MealsField`, `MealStyleField`, `DietField`, `AppliancesField`: contenitore `<div role="group" aria-labelledby={id} className="flex flex-wrap gap-2 pt-1">` con un `ChipFilter` per valore dell'enum, nell'ordine dell'enum, con `label` dalle etichette (`MEAL_TYPE_LABELS`, `MEAL_STYLE_TAG_LABELS`, `DIET_FLAG_LABELS`, `APPLIANCE_LABELS`), `isSelected = value.includes(v)`, `onClick = () => onChange(toggleInOrder(value, VALUES, v))`.
- Messaggi sotto il gruppo:
  - `MealsField` con `value.length === 0` → `<p role="alert" className="text-xs text-tomato">Scegli almeno un pasto.</p>`
  - `AppliancesField` con `value.length === 0` → `<p className="text-xs text-stone">Senza elettrodomestici proporrò solo piatti senza cottura.</p>`
- `SettingsField` smista su `fieldKey` e chiama `onChange({ ...settings, [fieldKey]: nuovoValore })`.

**6. Test**
- `tests/ui/settings-fields.test.tsx` (jsdom): `PersonsField` con 1 → "Una persona in meno" disabilitato e testo `persona`; con 12 → "Una persona in più" disabilitato; un click su + chiama `onChange(3)` partendo da 2. `MealsField` con `['cena']`: il chip "Pranzo" ha `aria-checked="false"`, un click chiama `onChange(['pranzo','cena'])`; con `[]` compare "Scegli almeno un pasto.". `AppliancesField` con `[]` mostra l'avviso. `isSettingsFieldValid('meals', { …, meals: [] })` è `false`. `SettingsField` con `fieldKey="diet_tags"` aggiorna solo `diet_tags`.
- `tests/settings/client.test.ts` (jsdom; `vi.stubGlobal('fetch', vi.fn())`, ripristino in `afterEach` con `vi.unstubAllGlobals()`): 200 valido → dati; 200 con JSON non conforme → `invalid_response`; 400 con corpo d'errore → `status 400`, `code 'invalid_request'`; `fetch` che lancia → `network_error`; la richiesta usa `PUT` e il corpo JSON passato.
- `tests/app/app-layout.test.tsx` (`// @vitest-environment node`): `vi.mock('next/server', () => ({ connection: vi.fn() }))`, `vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT'); }), usePathname: () => '/' }))`, `vi.mock('@/lib/settings/service', () => ({ getSettings: vi.fn() }))`. Con `onboarded: false` → `AppLayout({ children: null })` rifiuta con `NEXT_REDIRECT` e `redirect` è stato chiamato con `'/benvenuto'`; con `onboarded: true` → ritorna un elemento e `redirect` non è stato chiamato; `connection` è stato chiamato in entrambi i casi.

### Contratti esposti
- `@/components/settings/settings-fields`: tutto il blocco del passo 5.
- `@/lib/settings/client`: `putSettings`, `SettingsRequestError`.
- `app/(app)/layout.tsx`: ogni pagina sotto `app/(app)/` è protetta dalla guardia e mostra la `BottomNav`; le pagine fuori dal gruppo (per esempio `/benvenuto`) non hanno barra di navigazione.

### Dipendenze
WP1 (etichette, schemi, `toggleInOrder`, `getSettings`).

### Criteri di accettazione
- Gate verde, compresi i test di F1 con gli import aggiornati.
- `pnpm dev` con household non onboardato: `/`, `/lista`, `/libreria`, `/impostazioni` reindirizzano a `/benvenuto` (404 finché WP4 non crea la pagina: atteso in questa wave).

### Fuori scope
Contenuto delle pagine Impostazioni e Benvenuto (WP3, WP4); modifiche a `BottomNav`; middleware.

---

## WP3 — Form di modifica in `/impostazioni` (wave 3, parallelo a WP4)

**Obiettivo:** sostituire il mock con un form reale che carica i vincoli dal server, salva con un pulsante esplicito e mostra il banner quando qualcosa cambia.

### File
- Riscrive: `app/(app)/impostazioni/page.tsx`
- Crea: `components/settings/settings-editor.tsx`, `components/settings/ingredient-prefs-placeholder.tsx`
- Modifica: `tests/ui/shell.test.tsx` (solo il test "renders Settings page with sections")
- Crea: `tests/ui/settings-editor.test.tsx`, `tests/app/settings-page.test.tsx`

### Pattern di riferimento
- Layout di pagina e header: mock attuale `app/(app)/impostazioni/page.tsx` (`<main className="min-h-screen px-4 py-6 max-w-xl mx-auto space-y-6">`, h1 `font-display text-2xl font-bold text-ink`, sottotitolo `text-stone text-xs`).
- Controlli: `components/settings/settings-fields.tsx` (WP2); salvataggio: `putSettings` (WP2).

### Passi

**1. `app/(app)/impostazioni/page.tsx`** (server component, **senza** `"use client"`)
```tsx
import { connection } from 'next/server';
import { SettingsEditor } from '@/components/settings/settings-editor';
import { getSettings } from '@/lib/settings/service';

export default async function SettingsPage() {
  await connection();
  const settings = await getSettings();
  return <SettingsEditor initialSettings={settings} />;
}
```

**2. `components/settings/ingredient-prefs-placeholder.tsx`**
`IngredientPrefsPlaceholder()` → `Card` (`className="p-4 space-y-1"`) con `<h2 className="font-display text-base font-bold text-ink">I miei ingredienti</h2>` e `<p className="text-xs text-stone">Qui ritroverai gli ingredienti che segni con 👍 o 👎 nelle ricette.</p>`. Nessun dato, nessun input. In testa al file il commento `// Segnaposto: la Feature 5 (S2.3) lo sostituisce con le liste reali di ingredient_prefs.`

**3. `components/settings/settings-editor.tsx`** (`"use client"`)
```ts
export interface SettingsEditorProps { initialSettings: SettingsView; }
export function SettingsEditor({ initialSettings }: SettingsEditorProps): React.JSX.Element;
```
Stato:
- `saved: HouseholdSettings` = campi di `initialSettings` (senza `onboarded` / `updated_at`);
- `draft: HouseholdSettings` = copia di `saved`;
- `status: 'idle' | 'saving' | 'error'`; `showBanner: boolean` (iniziale `false`).

Derivati: `dirty = !settingsEqual(draft, saved)`; `valid = SETTINGS_FIELD_ORDER.every((k) => isSettingsFieldValid(k, draft))`; `canSave = dirty && valid && status !== 'saving'`.

Render:
- `<main className="min-h-screen px-4 py-6 max-w-xl mx-auto space-y-6">`
- Header: a sinistra h1 `Impostazioni` + sottotitolo `Vincoli del tuo nucleo per piano e ricette`; a destra `Button size="sm"` con `disabled={!canSave}`, icona `Save` e testo `Salva` (con `status === 'saving'`: testo `Salvataggio…`).
- Se `showBanner`: `<div role="status" className="flex items-start gap-3 rounded-xl border border-basil/30 bg-basil/10 p-3 text-sm text-ink">` con icona `Info` (basil), testo `Il prossimo piano userà i nuovi vincoli.` e pulsante `Button variant="ghost" size="icon"` con icona `X` e `aria-label="Chiudi avviso"` che imposta `showBanner = false`.
- Se `status === 'error'`: `<p role="alert" className="rounded-xl border border-tomato/30 bg-tomato/10 p-3 text-sm text-ink">Non sono riuscito a salvare. Riprova.</p>`
- Per ogni chiave di `SETTINGS_FIELD_ORDER`: `<Card className="p-4">` con dentro `<SettingsField fieldKey={k} settings={draft} onChange={setDraft} />`.
- In fondo: `<IngredientPrefsPlaceholder />`.

Salvataggio (`onClick` del pulsante): `status = 'saving'` → `const res = await putSettings(draft)` (senza `complete_onboarding`) →
- successo: `saved = draft = { campi di res.settings }`; `status = 'idle'`; se `res.changed` → `showBanner = true` (se `false` il banner resta com'era);
- errore (qualsiasi): `status = 'error'`; `draft` resta invariato (l'utente può riprovare).
Qualsiasi modifica al `draft` quando `status === 'error'` riporta `status` a `'idle'` (il messaggio d'errore sparisce).

**4. `tests/ui/shell.test.tsx`** — nel test "renders Settings page with sections", sostituire `render(<SettingsPage />)` con `render(<SettingsEditor initialSettings={FIXTURE} />)`, dove `FIXTURE` è un `SettingsView` con i valori di `DEFAULT_HOUSEHOLD`, `onboarded: true`, `updated_at: '2026-01-01T00:00:00.000Z'`. Le tre asserzioni restano (h1 `Impostazioni`, `Persone nel nucleo`, `I miei ingredienti`). Rimuovere l'import ormai inutile di `SettingsPage`.

**5. Test**
- `tests/ui/settings-editor.test.tsx` (jsdom; `vi.mock('@/lib/settings/client', async (orig) => ({ ...(await orig()), putSettings: vi.fn() }))`):
  1. All'avvio "Salva" è disabilitato, nessun banner, compaiono i 5 titoli di `SETTINGS_FIELD_COPY` e "I miei ingredienti".
  2. Clic sul chip "Vegano" → "Salva" abilitato; un secondo clic → di nuovo disabilitato (nessuna modifica netta).
  3. Clic su "Vegano" e poi su "Salva" con il mock che risolve `{ settings: {...con diet_tags ['vegano']}, changed: true }` → `putSettings` chiamato una volta con i 5 campi (`diet_tags: ['vegano']`, nessuna chiave `complete_onboarding`); appare il `role="status"` con "Il prossimo piano userà i nuovi vincoli."; "Salva" torna disabilitato; "Chiudi avviso" nasconde il banner.
  4. Mock che risolve con `changed: false` → nessun banner.
  5. Mock che rifiuta → appare "Non sono riuscito a salvare. Riprova."; "Salva" resta abilitato; un nuovo clic su un chip fa sparire l'errore.
  6. Deselezionando tutti i pasti → compare "Scegli almeno un pasto." e "Salva" è disabilitato.
  7. Durante il salvataggio (promessa non ancora risolta) il pulsante mostra "Salvataggio…" ed è disabilitato.
- `tests/app/settings-page.test.tsx` (`// @vitest-environment node`; mock di `next/server` (`connection`) e di `@/lib/settings/service` (`getSettings`)): `await SettingsPage()` ritorna un elemento di tipo `SettingsEditor` con `props.initialSettings` uguale al valore del mock.

### Contratti esposti
`SettingsEditor` (`@/components/settings/settings-editor`) e `IngredientPrefsPlaceholder` (`@/components/settings/ingredient-prefs-placeholder`), quest'ultimo da sostituire in F5 con la sezione reale nello stesso punto del form.

### Dipendenze
WP1, WP2.

### Criteri di accettazione (S5.1 — modifica)
- Da `/impostazioni` i valori mostrati sono quelli salvati; una modifica salvata sopravvive al reload.
- Dopo una modifica reale compare "Il prossimo piano userà i nuovi vincoli."; nessuna rigenerazione di piani.
- Gate verde.

### Fuori scope
Wizard (WP4); avviso di modifiche non salvate all'uscita dalla pagina; toast globali; sezione ingredienti reale (F5); banner sul Piano (F4).

---

## WP4 — Wizard di primo avvio in `/benvenuto` (wave 3, parallelo a WP3)

**Obiettivo:** al primo avvio guidare l'utente nei 5 passi, precompilati con i valori attuali, e completare l'onboarding con un unico salvataggio.

### File
- Crea: `app/benvenuto/page.tsx`, `components/settings/onboarding-wizard.tsx`
- Crea: `tests/ui/onboarding-wizard.test.tsx`, `tests/app/benvenuto-page.test.tsx`

### Pattern di riferimento
- Controlli e testi: `components/settings/settings-fields.tsx` (WP2) — **non** duplicare titoli, descrizioni o validazione.
- Pulsanti: `components/ui/button.tsx`.

### Passi

**1. `app/benvenuto/page.tsx`** (server component)
```tsx
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { OnboardingWizard } from '@/components/settings/onboarding-wizard';
import { getSettings } from '@/lib/settings/service';

export const metadata: Metadata = { title: 'Benvenuto — Mealy' };

export default async function WelcomePage() {
  await connection();
  const settings = await getSettings();
  if (settings.onboarded) redirect('/');
  return <OnboardingWizard initialSettings={settings} />;
}
```

**2. `components/settings/onboarding-wizard.tsx`** (`"use client"`)
```ts
export interface OnboardingWizardProps { initialSettings: SettingsView; }
export function OnboardingWizard({ initialSettings }: OnboardingWizardProps): React.JSX.Element;
```
Stato: `step` (indice 0..4 su `SETTINGS_FIELD_ORDER`), `draft: HouseholdSettings` (dai campi di `initialSettings`), `status: 'idle' | 'saving' | 'error'`. Costante `TOTAL = SETTINGS_FIELD_ORDER.length` (5).

Render (`<main className="min-h-screen px-4 py-8 max-w-xl mx-auto flex flex-col gap-6">`):
- Solo al passo 0, sopra tutto: `<p className="font-display text-3xl font-bold text-ink">Benvenuto in Mealy</p>` e `<p className="text-sm text-stone">Cinque domande veloci e il piano settimanale sarà su misura. Potrai cambiare tutto in seguito da Impostazioni.</p>`
- Indicatore: `<p className="text-xs font-semibold uppercase tracking-wider text-stone">Passo {step + 1} di {TOTAL}</p>` e barra `<div role="progressbar" aria-label="Avanzamento" aria-valuemin={1} aria-valuemax={TOTAL} aria-valuenow={step + 1} className="h-1.5 rounded-full bg-stone/20">` con riempimento interno `bg-basil` largo `${((step + 1) / TOTAL) * 100}%`.
- Il campo corrente: `<SettingsField fieldKey={SETTINGS_FIELD_ORDER[step]} settings={draft} onChange={setDraft} headingLevel="h1" headingRef={headingRef} />`.
- Se `status === 'error'`: `<p role="alert" …>Non sono riuscito a salvare. Riprova.</p>` (stesse classi del form in WP3).
- Barra azioni in fondo (`mt-auto flex gap-3`):
  - `Button variant="outline"` "Indietro" (visibile solo se `step > 0`, disabilitato durante il salvataggio) → `step - 1`;
  - `Button` principale (`className="flex-1"`), disabilitato se `!isSettingsFieldValid(chiaveCorrente, draft)` o `status === 'saving'`:
    - passi 0–3: testo "Avanti" → `step + 1`;
    - passo 4: testo "Inizia a pianificare" (durante il salvataggio "Un attimo…") → `submit()`.
- Focus: a ogni cambio di `step` (non al primo render) chiamare `headingRef.current?.focus()`.

`submit()`: `status = 'saving'` → `await putSettings({ ...draft, complete_onboarding: true })` →
- successo: `router.replace('/')` e poi `router.refresh()` (`useRouter` da `next/navigation`); lo `status` resta `'saving'` (la pagina sta cambiando);
- errore: `status = 'error'`, si resta al passo 4 con i dati invariati. Un clic su "Indietro" o una modifica riportano `status` a `'idle'`.

**3. Test**
- `tests/ui/onboarding-wizard.test.tsx` (jsdom; mock di `next/navigation` con `useRouter: () => ({ replace, refresh })` e di `putSettings` come in WP3; `initialSettings` = default con `onboarded: false`):
  1. Al passo 1 si vedono "Benvenuto in Mealy", "Passo 1 di 5", l'h1 "Persone nel nucleo", nessun "Indietro"; `progressbar` con `aria-valuenow="1"`.
  2. "Avanti" ×4 porta all'h1 "Elettrodomestici", "Passo 5 di 5" e al pulsante "Inizia a pianificare"; "Indietro" torna a "Esigenze alimentari".
  3. Al passo 2 deselezionando "Pranzo" e "Cena" → "Avanti" disabilitato e "Scegli almeno un pasto." visibile.
  4. Dopo aver cambiato le persone a 3 al passo 1 e completato il wizard → `putSettings` chiamato una volta con `persons: 3`, gli altri 4 campi di default e `complete_onboarding: true`; poi `replace('/')` e `refresh()` chiamati in quest'ordine.
  5. `putSettings` che rifiuta → "Non sono riuscito a salvare. Riprova.", `replace` non chiamato, pulsante di nuovo attivo.
  6. Dopo "Avanti" il focus è sull'h1 del nuovo passo (`document.activeElement`).
- `tests/app/benvenuto-page.test.tsx` (`// @vitest-environment node`; mock di `next/server`, di `next/navigation` (`redirect` che lancia `NEXT_REDIRECT`) e di `@/lib/settings/service`): con `onboarded: true` → `redirect('/')`; con `onboarded: false` → elemento `OnboardingWizard` con `props.initialSettings` uguale al mock.

### Contratti esposti
Rotta `/benvenuto`; `OnboardingWizard` (`@/components/settings/onboarding-wizard`).

### Dipendenze
WP1, WP2.

### Criteri di accettazione (S5.1 — primo avvio)
- Con un household non onboardato qualunque tab porta a `/benvenuto`; completati i 5 passi si arriva al Piano con la barra di navigazione, e un reload non riporta al wizard.
- Visitare `/benvenuto` dopo l'onboarding reindirizza a `/`.
- Gate verde.

### Fuori scope
Saltare il wizard (decisione U3); animazioni tra i passi; salvataggio parziale per passo; reset dell'onboarding.

---

## Mappa delle dipendenze

```
Wave 1:  WP1  dati + servizio + API                 (da solo)
           │
Wave 2:  WP2  controlli, client, route group         (da solo: sposta file usati da WP3)
           │
Wave 3:  WP3  form /impostazioni   ∥   WP4  wizard /benvenuto
```

- **Sequenziali obbligati:** WP1 → WP2 (etichette, schemi, `getSettings`) → WP3/WP4 (controlli, `putSettings`, route group).
- **Parallelizzabili:** WP3 e WP4. File disgiunti: WP3 tocca `app/(app)/impostazioni/page.tsx`, `components/settings/settings-editor.tsx`, `components/settings/ingredient-prefs-placeholder.tsx`, `tests/ui/shell.test.tsx`, `tests/ui/settings-editor.test.tsx`, `tests/app/settings-page.test.tsx`; WP4 tocca `app/benvenuto/page.tsx`, `components/settings/onboarding-wizard.tsx`, `tests/ui/onboarding-wizard.test.tsx`, `tests/app/benvenuto-page.test.tsx`. `tests/ui/shell.test.tsx` è modificato in WP2 (import) e poi solo da WP3.
- Prima dei gate con test DB: Postgres attivo e `pnpm db:migrate` (serve la migrazione `0002` di WP1).

## Checklist finale

| WP | Wave | File principali | Stato |
|---|---|---|---|
| WP1 — Dati, servizio e API | 1 | `lib/domain/types.ts`, `lib/db/schema.ts`, migrazione `0002`, `household-repo.ts`, `lib/settings/{normalize,service}.ts`, `app/api/settings/route.ts`, `tests/settings/*`, `tests/api/settings.test.ts` | ☑ |
| WP2 — Controlli, client, guardia | 2 | spostamento in `app/(app)/`, `app/(app)/layout.tsx`, `app/layout.tsx`, `components/settings/settings-fields.tsx`, `lib/settings/client.ts`, test F1 aggiornati, 3 nuovi test | ☑ |
| WP3 — Form di modifica | 3 | `app/(app)/impostazioni/page.tsx`, `components/settings/{settings-editor,ingredient-prefs-placeholder}.tsx`, 2 nuovi test | ☑ |
| WP4 — Wizard | 3 | `app/benvenuto/page.tsx`, `components/settings/onboarding-wizard.tsx`, 2 nuovi test | ☑ |

**Chiusura feature** (`execution-strategy.md §3`): primo avvio forza il wizard; una modifica dei vincoli mostra il banner; i vincoli arrivano a planner e LLM (test 7 di WP1 su `buildConstraints`); gate verde; verifica manuale da telefono (`pnpm dev` su rete locale): wizard completo, modifica e salvataggio, reload; code-review `high`; wiki aggiornata (nuove entità `settings-service`, `settings-fields`, `onboarding-wizard`, concetto "guardia di onboarding / route group `(app)`"; aggiornamento di `household-repo`, `domain-types`, `database-schema`, `shell-navigation-pattern`); riga di `feature-index.md` aggiornata; commit su conferma.
