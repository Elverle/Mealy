# Feature 11 — Composizione del pasto · Piano di implementazione

**Data:** 2026-10-27 · **Stato:** planned · **Input di:** `/arch-review 11` → `/feature-dev 11`
**Spec:** [`spec.md`](spec.md) (FR-1 … FR-8, D1–D12)
**Decisioni motivate:** [`requirements.md`](requirements.md) (U1–U3 dell'utente, P1–P22 di planning), recepite qui come definitive.

---

## 0. Contesto per chi implementa (leggere tutto prima del proprio WP)

### 0.1 Obiettivo

1. Un pasto del piano (giorno + pranzo/cena) è fatto di **uno o due piatti**: un **principale** (portata `piatto-unico`, `primo` o `secondo`) e, solo con un primo o un secondo, un **contorno** (portata `contorno`).
2. Ogni piatto è una riga di `plan_slots` con la colonna nuova **`course`**. Un indice unico ammette al più un principale e un contorno per `(plan_id, day, meal)`.
3. Le **composizioni** sono cinque: `piatto-unico`, `primo`, `primo-contorno`, `secondo`, `secondo-contorno`. L'household ne tiene un elenco per pranzo e uno per cena (`households.meal_compositions`, default tutte e cinque). Si scelgono nel campo «Pasti da pianificare» dell'onboarding e delle Impostazioni.
4. *Genera piano* distribuisce le composizioni ammesse in modo bilanciato, poi riempie ogni piatto con la selezione pesata. Le carenze e la generazione LLM sono per (pasto, portata), contorni compresi.
5. Sulla card: riga contorno (⟳ / lente / ✕) o pulsante «+ Contorno». *Scegli* sul principale accetta qualsiasi principale e la composizione segue la ricetta. Il lucchetto blocca il pasto intero.
6. L'etichetta di stile `piatto-unico` sparisce (enum, dati, fixture, prompt).

Due migrazioni (`0006`, `0007`), due rotte nuove (`POST …/side`, `DELETE …/slots/{slotId}`), nessuna variabile d'ambiente nuova.

### 0.2 Stato del codice su cui si lavora

Se un nome qui sotto differisce nel codice reale, **vince il codice reale**: adeguarsi mantenendo il comportamento descritto.

- Next.js 15 App Router (root senza `src/`, alias `@/*` → `./*`), React 19, zod 3, drizzle-orm 0.45 + postgres.js, drizzle-kit 0.30, Vitest 4 (ambiente globale **jsdom**; i test lato server iniziano con `// @vitest-environment node`), Testing Library, Tailwind v4 con i token `paper / ink / basil / tomato / saffron / stone`. `tsc --noEmit` controlla **anche i test**.
- `lib/domain/types.ts` — unica fonte dei tipi. Elenchi chiusi nello stile `X_VALUES` + `X_ENUM` + `XSchema` + `type X` + `X_LABELS` (vedi `MEAL_TYPE_VALUES` riga ~39, `COURSE_VALUES` ~99). `MEAL_STYLE_TAG_VALUES` (~65, 12 valori con `piatto-unico`), `MAIN_COURSE_VALUES` (~112), `HouseholdSchema` (~211), `DEFAULT_HOUSEHOLD` (~276), `PlanSlotSchema` (~233), `HouseholdSettingsSchema` / `UpdateSettingsRequestSchema` / `SettingsViewSchema` (~397–425), `PlanSlotViewSchema` (~448), `SwapSlotRequestSchema` + `SWAP_EXCLUDE_MAX` (~524), `PlanMutationResultSchema` (~532), `ProposeRecipeRequestSchema` (~750).
- `lib/domain/courses.ts` — `normalizeCourses`, `coursesAllowed(courses, allowed)` (non classificata = sempre ammessa), `isMainDish`, `courseLabel`, `countMeasuredIngredients`, `deriveStyleTags(tags, courses, ingredients)` (regole `pochi-ingredienti` e `piatto-unico`).
- `lib/domain/planner.ts` — `ExclusionReason`, `exclusionReason(recipe, meal, ctx)` (ordine: `blocked`, `meal_type`, `course` con `isMainDish`, `diet`, `appliance`, `disliked_ingredient`, `excluded`), `manualChoiceExclusionReason(recipe, meal, household)`, `PlannerSlot {key, day, meal}`, `selectRecipes` (pool per tipo di pasto, ordine per scarsità, `needMore` per tipo di pasto), `MealTypeShortage`, `computeGenerationCount`, `splitGenerationBatches`. `lib/domain/rng.ts` — `type Rng`, `createRng(seed)`.
- `lib/plans/service.ts` — `slotKey(day, meal)`, `toPlanView`, `getPlanScreen`, `PlanContext`, `desiredSlots`, `computeSelection` (kept = giorni passati o bloccati, preassegnazioni, `selectRecipes`), `buildTargetPlan` (giri di generazione fuori transazione, poi lock + rilettura + scrittura), `generatePlan`, `loadOpenOwnedPlan`, `confirmPlan`, `setSlotLock`, `findSwappableSlot`, `swapSlot`, `listSlotCandidates`, `assignSlotRecipe`, `repeatPlan`. `lib/plans/errors.ts` — `PLAN_ERROR_CODES`, `PLAN_ERROR_HTTP`, `PlanError`. `lib/plans/client.ts` — una funzione per rotta (`requestSwapSlot`, `requestSlotLock`, `requestAssignSlotRecipe`, …). `lib/plans/http.ts` — `handlePlanRouteError`.
- `lib/db/schema.ts` — `households` (~20), `plan_slots` (~170, indice `plan_slots_plan_day_meal_idx`). `lib/db/migrations/` con `0000`–`0005` e `meta/_journal.json` + snapshot; si generano con `pnpm db:generate` (drizzle-kit).
- `lib/db/repositories/plan-repo.ts` — `PlanSlotRecord`, `NewSlotInput`, `compareSlots`, `insertSlots`, `deleteSlots`, `updateSlotsServings`, `updateSlotRecipe`, `setSlotLocked`, `incrementRecipeUsage`, `markShoppingListStale`. `lib/db/repositories/household-repo.ts` — `ensureDefaultHousehold`, `updateHousehold`.
- `lib/settings/normalize.ts` — `normalizeSettings`, `settingsEqual`, `householdToSettings`, `toSettingsView`, `toggleInOrder`. `lib/settings/service.ts` — `saveSettings`.
- `lib/recipes/generate.ts` — `GenerateAndStoreInput {householdId?, count, mealType, overrides?}`, `buildConstraints(..., MAIN_COURSE_VALUES)`. `lib/recipes/propose.ts` — `ProposeRecipeInput`, `requestConstraints(household, mealType)`, `proposeRecipe`, `saveProposedRecipe`. `lib/recipes/constraints.ts` — `buildConstraints`, `findConstraintViolations`. `lib/library/client.ts` — `requestRecipeProposal(input, signal)`.
- UI: `components/cards/meal-card.tsx` (`MealCardProps`, footer *Cambia* / *Scegli* / ★, lucchetto, long-press). `components/plan/plan-slot-card.tsx` (modalità `idle | swapping | review`, `pendingFocus`, `buildExclude`, `SlotRecipePicker`). `components/plan/plan-screen.tsx` (`withSlotFrom` ~114, `groupByDay` ~130, `setSlotLocked` / `handleToggleLock` ~501, render delle card ~550). `components/plan/slot-recipe-picker.tsx` (titolo `Scegli per …`, testo vuoto, `RecipeProposalSheet mealType=…`). `components/recipes/recipe-proposal-sheet.tsx` (`mealTypeRef`). `components/settings/settings-fields.tsx` (`SETTINGS_FIELD_COPY`, `isSettingsFieldValid`, `ChipGroupField`, `MealsField`, `SettingsField`). `components/settings/settings-editor.tsx` e `onboarding-wizard.tsx` (bozza `HouseholdSettings`). `components/sheets/recipe-detail.ts` (`recipeChips` con `COURSE_STYLE_TAG`).
- Test: `tests/helpers/db.ts` (`isDbAvailable`, `assertDbMigrated`, `createTestHousehold`, `deleteTestHousehold`), `tests/helpers/plans.ts` (`insertTestRecipe(s)`), `tests/helpers/recipes.ts` (`makeRecipe`, `makeGeneratedRecipe`), `tests/helpers/mock-llm.ts`. Modello di test di migrazione: `tests/db/recipe-courses-migration.test.ts` (DB usa-e-getta, journal filtrato). UI: `tests/ui/plan-slot-card.test.tsx` e `tests/ui/plan-screen.test.tsx` mockano `@/lib/plans/client` con `vi.mock`.

### 0.3 Regole vincolanti

1. `lib/domain/types.ts` è la sola fonte dei tipi di dominio. Le regole pure delle composizioni stanno in `lib/domain/compositions.ts` (nuovo, WP1) e **si riusano**, mai reimplementate.
2. `planner`, `compositions`, `courses` restano puri. Solo `lib/recipes/*` chiama `lib/llm/`.
3. Test senza rete. DB: il Postgres Docker locale (`docker compose -f docker-compose.dev.yml up -d`; se la 5432 è occupata, la 5433 con `DATABASE_URL` puntato lì), `pnpm db:migrate` prima dei test.
4. Gate di ogni WP: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, tutti verdi. Un WP non lascia rossi test di altri file: se una modifica del proprio WP ne rompe uno, lo aggiusta solo nei punti toccati dalla propria modifica e lo dichiara nel resoconto. Nota: sul DB di sviluppo `tests/db/seed.test.ts` può fallire per dati lasciati da prove manuali (v. indice, Feature 9); su un DB nuovo è verde. Non è un rosso del WP.
5. Codice e identificatori in inglese; commenti, microcopy, log e messaggi in italiano, nel tono dei file vicini (commenti brevi, una riga dove basta).
6. Restare nei file del proprio WP (elenco "File"). Eccezione unica: le correzioni dei test del punto 4.

### 0.4 Glossario

- **Portata** (`Course`): `piatto-unico | primo | secondo | contorno`. **Principali**: `MAIN_COURSE_VALUES` = `piatto-unico`, `primo`, `secondo`.
- **Filtro di portata** (`CourseFilter`): una `Course` oppure `'any-main'` (= una qualsiasi principale).
- **Non classificata**: `recipe.courses` vuoto.
- **Composizione** (`MealComposition`): `piatto-unico | primo | primo-contorno | secondo | secondo-contorno`.
- **Pasto**: l'insieme degli slot di un piano con lo stesso `(day, meal)`. **Principale** del pasto: lo slot con `course !== 'contorno'`. **Contorno** del pasto: lo slot con `course === 'contorno'`.
- **Chiave del pasto**: `${day}|${meal}`. **Chiave dello slot** nel servizio: `${day}|${meal}|${course}`.

### 0.5 Microcopy (testi esatti)

| Dove | Testo |
|---|---|
| `MEAL_COMPOSITION_LABELS` | «Piatto unico», «Primo», «Primo + contorno», «Secondo», «Secondo + contorno» |
| Descrizione del campo «Pasti da pianificare» | «Quali pasti vuoi trovare nel piano, e come li componi?» |
| Avviso del gruppo di composizioni vuoto | «Scegli almeno una composizione.» |
| Etichetta della riga contorno | «Contorno» (eyebrow maiuscolo, come `LUN · CENA`) |
| aria-label della riga contorno | `Cambia contorno: ${title}`, `Scegli contorno: ${title}`, `Togli contorno: ${title}` |
| Pulsante per aggiungere | testo «Contorno» con icona `Plus`; aria-label «Aggiungi un contorno» |
| Attesa nella riga contorno | «Cerco un contorno…» (aggiunta e cambio), «Tolgo il contorno…» (rimozione) |
| Titolo del selettore del contorno | `Scegli il contorno per ${formatDayLabel(day)} · ${MEAL_TYPE_LABELS[meal]}` |
| Selettore del contorno vuoto | «Nessun altro contorno adatto a questo pasto» |
| `side_not_allowed` (409) | «Questo pasto non prevede un contorno.» |
| `side_exists` (409) | «Questo pasto ha già un contorno.» |
| `not_a_side_dish` (409) | «Si può togliere solo il contorno.» |

### 0.6 Contratti trasversali (riassunto: il dettaglio è nel WP che li crea)

| Contratto | Dove | WP |
|---|---|---|
| `MEAL_COMPOSITION_*`, `MealCompositionsSchema`, `MealCompositions`, `DEFAULT_MEAL_COMPOSITIONS`, `CourseFilter` | `types.ts` | WP1 |
| `compositionDishes`, `mealCompositionOf`, `distributeCompositions`, `fitsCourse`, `filterCourses`, `mainCourseOf`, `mainCourseForChoice` | `lib/domain/compositions.ts` | WP1 |
| `deriveStyleTags(tags, ingredients)` | `courses.ts` | WP1 |
| `PlanSlot*.course`, `Household.meal_compositions`, `HouseholdSettings.meal_compositions`, `SettingsView.meal_compositions` | `types.ts` | WP2 |
| `PlanSlotRecord.course`, `NewSlotInput.course`, `setMealLocked`, `updateSlotRecipe(…, course?)` | `plan-repo.ts` | WP2 |
| `PlannerSlot.course`, `exclusionReason(r, meal, course, ctx)`, `manualChoiceExclusionReason(r, meal, course, h)`, `MealTypeShortage.course` | `planner.ts` | WP3 |
| `GenerateAndStoreInput.courses`, `ProposeRecipeInput.sideDish`, `ProposeRecipeRequest.side_dish`, `requestRecipeProposal({… sideDish})`, `RecipeProposalSheet sideDish` | recipes / library / UI | WP5 |
| errori `side_not_allowed`, `side_exists`, `not_a_side_dish`; `requestAddSideDish`, `requestRemoveSideDish` | `lib/plans/errors.ts`, `client.ts` | WP6 |
| `addSideDish`, `removeSideDish`, rotte `…/side` e `DELETE …/slots/{slotId}` | `service.ts`, `app/api/…` | WP7 |

### 0.7 Mappa dei work package

| WP | Titolo | Wave | Parallelo con |
|---|---|---|---|
| WP1 | Contratti puri delle composizioni ed etichetta `piatto-unico` tolta | 1 | — |
| WP2 | Persistenza: `plan_slots.course`, `households.meal_compositions`, repository e impostazioni | 2 | — |
| WP3 | Planner per portata | 3 | WP4, WP5, WP6 |
| WP4 | Composizioni nel campo «Pasti da pianificare» (onboarding e Impostazioni) | 3 | WP3, WP5, WP6 |
| WP5 | Generazione per portata e proposta di un contorno | 3 | WP3, WP4, WP6 |
| WP6 | Errori e client dei piani | 3 | WP3, WP4, WP5 |
| WP7 | Servizio dei piani e rotte | 4 | WP8, WP9 |
| WP8 | Card del pasto con contorno e schermata Piano | 4 | WP7, WP9 |
| WP9 | Documenti | 4 | WP7, WP8 |

---

## WP1 — Contratti puri delle composizioni ed etichetta `piatto-unico` tolta (wave 1, da solo)

**Obiettivo:** introdurre i tipi e le regole pure delle composizioni e togliere l'etichetta di stile `piatto-unico` da enum, dati, fixture e prompt, lasciando invariato il comportamento del piano.

### File

- Modificare: `lib/domain/types.ts`, `lib/domain/courses.ts`, `lib/recipes/classify.ts`, `lib/db/seed-core.ts`, `lib/recipes/store.ts`, `lib/recipes/propose.ts`, `lib/recipes/pack/build.ts`, `components/sheets/recipe-detail.ts`, `lib/llm/prompts.ts`, `fixtures/recipes.json`, `fixtures/recipe-pack.json`, `tests/fixtures/llm/recorded/gemini-cena-vegano.txt`, `tests/fixtures/llm/recorded/google-cena-portate.txt`, `tests/fixtures/llm/recorded/openrouter-cena-vegano.txt`, `tests/fixtures/llm/recorded/openrouter-glm-cena-vegano.txt`, e i test: `tests/domain/courses.test.ts`, `tests/db/schema.test.ts`, `tests/recipes/classify.test.ts`, `tests/recipes/generate.test.ts`, `tests/recipes/propose.test.ts`, `tests/recipes/pack/build.test.ts`, `tests/ui/recipe-detail.test.ts`, `tests/ui/plan-slot-card.test.tsx` (solo la riga ~579), `tests/llm/prompts.test.ts`, `tests/fixtures-data/recipes-fixtures.test.ts`, `tests/fixtures-data/recipe-pack.test.ts`, più ogni altro test che non compila o fallisce per le sole modifiche di questo WP.
- Creare: `lib/domain/compositions.ts`, `tests/domain/compositions.test.ts`, `lib/db/migrations/0006_remove_piatto_unico_tag.sql` (+ `meta/0006_snapshot.json` e la voce nel journal, generati), `tests/db/piatto-unico-tag-migration.test.ts`.

### Pattern di riferimento

- Elenchi chiusi: `COURSE_VALUES` … `COURSE_LABELS` in `types.ts`.
- Modulo puro con test: `lib/domain/courses.ts` + `tests/domain/courses.test.ts`.
- Test di migrazione: `tests/db/recipe-courses-migration.test.ts`.

### Passi

1. **`types.ts` — etichette.** Togliere `'piatto-unico'` da `MEAL_STYLE_TAG_VALUES` (restano 11 valori, stesso ordine) e la voce `'piatto-unico': 'Piatto unico'` da `MEAL_STYLE_TAG_LABELS`. Il commento sopra `MAIN_COURSE_VALUES` diventa `// Portate che da sole fanno un pasto: il principale di ogni composizione.`
2. **`types.ts` — composizioni.** Subito dopo `MAIN_COURSE_VALUES`:
   ```ts
   // Filtro di portata di uno slot: una portata precisa, oppure una qualsiasi principale.
   export type CourseFilter = Course | 'any-main';

   // Composizione di un pasto: un principale, con o senza contorno (Feature 11).
   export const MEAL_COMPOSITION_VALUES = [
     'piatto-unico',
     'primo',
     'primo-contorno',
     'secondo',
     'secondo-contorno',
   ] as const;
   export const MEAL_COMPOSITION_ENUM = MEAL_COMPOSITION_VALUES;
   export const MealCompositionSchema = z.enum(MEAL_COMPOSITION_VALUES);
   export type MealComposition = z.infer<typeof MealCompositionSchema>;

   export const MEAL_COMPOSITION_LABELS: Record<MealComposition, string> = {
     'piatto-unico': 'Piatto unico',
     primo: 'Primo',
     'primo-contorno': 'Primo + contorno',
     secondo: 'Secondo',
     'secondo-contorno': 'Secondo + contorno',
   };

   // Composizioni ammesse per pasto: almeno una per pranzo e una per cena.
   export const MealCompositionsSchema = z
     .object({
       pranzo: z.array(MealCompositionSchema).min(1),
       cena: z.array(MealCompositionSchema).min(1),
     })
     .strict();
   export type MealCompositions = z.infer<typeof MealCompositionsSchema>;

   export const DEFAULT_MEAL_COMPOSITIONS: MealCompositions = {
     pranzo: [...MEAL_COMPOSITION_VALUES],
     cena: [...MEAL_COMPOSITION_VALUES],
   };
   ```
   Nient'altro cambia in `types.ts` in questo WP (household, slot e impostazioni arrivano con WP2).
3. **`lib/domain/compositions.ts`** (nuovo). Intestazione: `// Regole pure delle composizioni del pasto (Feature 11). Nessuna dipendenza da DB, LLM o framework.` Import da `@/lib/domain/types` (`COURSE_VALUES`, `MAIN_COURSE_VALUES`, `MEAL_COMPOSITION_VALUES`, tipi `Course`, `CourseFilter`, `MealComposition`), `coursesAllowed` da `./courses`, `type Rng` da `./rng`. Funzioni esportate, tutte pure:
   ```ts
   /** Piatti di una composizione: la portata del principale e se c'è il contorno. */
   export function compositionDishes(composition: MealComposition): { main: Course; side: boolean };
   ```
   Tabella: `piatto-unico` → `{ main: 'piatto-unico', side: false }`; `primo` → `{ 'primo', false }`; `primo-contorno` → `{ 'primo', true }`; `secondo` → `{ 'secondo', false }`; `secondo-contorno` → `{ 'secondo', true }`.
   ```ts
   /**
    * Composizione formata dalle portate degli slot di un pasto (in qualsiasi ordine), oppure
    * null se non ne formano una: serve esattamente un principale e al più un contorno, e il
    * contorno solo con un primo o un secondo.
    */
   export function mealCompositionOf(courses: readonly Course[]): MealComposition | null;
   ```
   Regola: `mains = courses.filter(c => c !== 'contorno')`, `sides = courses.length - mains.length`. Se `mains.length !== 1` o `sides > 1` → `null`. Se `sides === 0` → `mains[0]` (è già un valore di composizione). Se `sides === 1`: `mains[0] === 'primo'` → `'primo-contorno'`, `'secondo'` → `'secondo-contorno'`, altrimenti `null`.
   ```ts
   /**
    * `count` composizioni bilanciate tra quelle ammesse: ognuna esce ⌊count/k⌋ volte, le
    * count mod k in più vanno a composizioni sorteggiate senza ripetizioni; poi l'elenco si
    * mescola. Deterministica a parità di input e `rng`.
    */
   export function distributeCompositions(
     allowed: readonly MealComposition[],
     count: number,
     rng: Rng
   ): MealComposition[];
   ```
   Algoritmo esatto (l'ordine delle chiamate a `rng` fa parte del contratto):
   1. `if (count <= 0) return [];`
   2. `const options = MEAL_COMPOSITION_VALUES.filter((c) => allowed.includes(c));` (ordine canonico, senza doppioni). Se `options.length === 0` → `throw new Error('distributeCompositions: nessuna composizione ammessa');`
   3. `const base = Math.floor(count / options.length); const extra = count % options.length;`
   4. `const lucky = new Set(shuffle([...options], rng).slice(0, extra));`
   5. `const list = options.flatMap((c) => Array<MealComposition>(base + (lucky.has(c) ? 1 : 0)).fill(c));`
   6. `return shuffle(list, rng);`

   `shuffle` è una funzione privata del modulo (Fisher–Yates sul posto, restituisce lo stesso array): `for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; } return items;`. Al passo 4 si chiama `shuffle` anche quando `extra === 0` (consuma comunque `rng`: il comportamento resta uno solo).
   ```ts
   /**
    * true se una ricetta con queste portate può stare in uno slot con questo filtro.
    * Non classificata: ammessa in ogni principale e in 'any-main', mai come contorno.
    */
   export function fitsCourse(courses: readonly Course[], filter: CourseFilter): boolean;
   ```
   Regola: `if (filter === 'contorno') return courses.includes('contorno');` altrimenti `return coursesAllowed(courses, filterCourses(filter));`
   ```ts
   /** Portate di un filtro: 'any-main' → le tre principali; altrimenti la portata sola. Array nuovo. */
   export function filterCourses(filter: CourseFilter): Course[];
   ```
   `'any-main'` → `[...MAIN_COURSE_VALUES]`; altrimenti `[filter]`.
   ```ts
   /** Prima portata principale della ricetta (ordine di COURSE_VALUES), altrimenti 'piatto-unico'. */
   export function mainCourseOf(courses: readonly Course[]): Course;
   ```
   `return COURSE_VALUES.find((c) => c !== 'contorno' && courses.includes(c)) ?? 'piatto-unico';` (stessa regola della migrazione `0007`, WP2).
   ```ts
   /**
    * Portata che prende il principale quando l'utente ci mette a mano questa ricetta (spec FR-5.4).
    */
   export function mainCourseForChoice(
     courses: readonly Course[],
     currentCourse: Course,
     hasSide: boolean
   ): Course;
   ```
   Regola, nell'ordine: (a) `courses.length === 0` → `currentCourse`; (b) `courses.includes(currentCourse)` → `currentCourse`; (c) se `hasSide`: `courses.includes('primo')` → `'primo'`, poi `courses.includes('secondo')` → `'secondo'`; (d) altrimenti `mainCourseOf(courses)`. (Se la ricetta è solo contorno, (d) restituisce `'piatto-unico'`: non succede, perché il selettore del principale non elenca i contorni.)
4. **`courses.ts`.** `deriveStyleTags` diventa `deriveStyleTags(tags: readonly MealStyleTag[], ingredients: readonly { unit: Unit }[]): MealStyleTag[]`: resta solo la regola di `pochi-ingredienti`; il commento JSDoc perde il punto su `piatto-unico`. Togliere l'import di `Course` se non serve più (resta per le altre funzioni). Nel commento di `coursesAllowed` sostituire «lo usano il planner (`isMainDish`) e i vincoli di generazione. La Feature 11 cambierà solo l'elenco ammesso.» con «lo usano `fitsCourse` (planner) e i vincoli di generazione.» `isMainDish` resta com'è.
5. **Chiamanti di `deriveStyleTags`** (togliere l'argomento `courses`, nient'altro): `lib/recipes/classify.ts` (~136), `lib/db/seed-core.ts` (~53), `lib/recipes/store.ts` (~63), `lib/recipes/propose.ts` (~91), `lib/recipes/pack/build.ts` (~158). Il commento di `store.ts` (~41) resta valido.
6. **`components/sheets/recipe-detail.ts`.** Togliere la costante `COURSE_STYLE_TAG` e il filtro: `const styleTags = recipe.tags;`. Se `courses` non serve più nel `Pick` del parametro, lasciarlo (non è un errore e i chiamanti non cambiano).
7. **`lib/llm/prompts.ts`.** `TAGS_LINE` diventa: `` `- tags: solo tra ${MEAL_STYLE_TAG_VALUES.join(', ')} ("veloce" solo se prep_minutes è al massimo 30; "pochi-ingredienti" lo calcola l'app, puoi ometterlo).` ``. Nient'altro.
8. **Dati.**
   - `fixtures/recipe-pack.json`: con uno script usa-e-getta (non committato) `JSON.parse` → per ogni ricetta `recipe.tags = recipe.tags.filter((t) => t !== 'piatto-unico')` → `fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n')`. Il file è già in quel formato: il diff deve toccare solo le righe dei `tags` (41 ricette). I `courses` non cambiano.
   - `fixtures/recipes.json` (array su una riga): togliere a mano `"piatto-unico"` (e la virgola relativa) dalle 4 righe `"tags": [...]` che lo contengono. Le righe `"courses"` non si toccano.
   - Le 4 registrazioni in `tests/fixtures/llm/recorded/` elencate sopra: stesso intervento solo dentro gli array `"tags"`.
9. **Migrazione `0006`.** `pnpm db:generate --custom --name remove_piatto_unico_tag` (crea il file vuoto, lo snapshot e la voce `idx: 6` del journal; se il nome generato è diverso, rinominare file e `tag` in `0006_remove_piatto_unico_tag`). Contenuto esatto del file:
   ```sql
   UPDATE "households" SET "meal_style_tags" = array_remove("meal_style_tags", 'piatto-unico');
   --> statement-breakpoint
   UPDATE "recipes" SET "tags" = array_remove("tags", 'piatto-unico');
   ```
10. **Test.**
    - `tests/domain/compositions.test.ts` (`// @vitest-environment node`): `compositionDishes` per i 5 valori; `mealCompositionOf` per `['secondo']`, `['contorno','secondo']` → `'secondo-contorno'`, `['primo','contorno']`, `['piatto-unico','contorno']` → `null`, `['contorno']` → `null`, `['primo','secondo']` → `null`, `['secondo','contorno','contorno']` → `null`, `[]` → `null`; `distributeCompositions`: con `createRng(1)` e tutte e 5, `count` 7 → 7 elementi, ogni composizione 1 o 2 volte, esattamente 2 composizioni con 2; `count` 10 → 2 ciascuna; `count` 3 con 5 composizioni → 3 distinte; una sola composizione ammessa → tutte uguali; `allowed` con doppioni e fuori ordine dà lo stesso risultato della versione canonica con lo stesso seed; stesso seed ⇒ stesso array; `count` 0 → `[]`; `allowed` vuoto con `count` 1 → lancia. `fitsCourse`: non classificata con `'primo'` → true, con `'any-main'` → true, con `'contorno'` → false; `['contorno']` con `'contorno'` → true, con `'any-main'` → false, con `'secondo'` → false; `['secondo','piatto-unico']` con `'piatto-unico'` e `'secondo'` → true, con `'primo'` → false. `filterCourses('any-main')` → le tre principali; `filterCourses('contorno')` → `['contorno']`. `mainCourseOf`: `['secondo','piatto-unico']` → `'piatto-unico'`; `['contorno']` → `'piatto-unico'`; `[]` → `'piatto-unico'`; `['primo']` → `'primo'`. `mainCourseForChoice`: (`[]`, `'secondo'`, true) → `'secondo'`; (`['secondo','piatto-unico']`, `'secondo'`, true) → `'secondo'`; (`['primo','piatto-unico']`, `'secondo'`, true) → `'primo'`; (`['primo','piatto-unico']`, `'secondo'`, false) → `'piatto-unico'`; (`['piatto-unico']`, `'secondo'`, true) → `'piatto-unico'`; (`['secondo']`, `'piatto-unico'`, false) → `'secondo'`.
    - `tests/domain/courses.test.ts`: i casi di `deriveStyleTags` su `piatto-unico` (righe ~123–141) si tolgono; gli altri passano alla firma a due argomenti.
    - `tests/db/schema.test.ts` (~65): l'elenco atteso perde `'piatto-unico'`.
    - `tests/recipes/classify.test.ts`, `generate.test.ts`, `propose.test.ts`, `pack/build.test.ts`, `tests/ui/recipe-detail.test.ts`, `tests/ui/plan-slot-card.test.tsx` (~579), `tests/fixtures-data/*.test.ts`: dove `'piatto-unico'` è usato come **etichetta** (`tags`), toglierlo o sostituirlo con un'etichetta valida (`'comfort-food'`), e riscrivere le attese che dipendevano dalla regola tolta. I test che parlavano solo della regola `piatto-unico` (es. `classify.test.ts` ~175 «removes a piatto-unico tag…», `generate.test.ts` ~361 e ~378, `pack/build.test.ts` ~188, `recipe-detail.test.ts` ~110 e ~261–268) si riscrivono sulla sola regola `pochi-ingredienti` o si tolgono se restano senza oggetto. Dove `'piatto-unico'` è una **portata** (`courses`) non si tocca nulla.
    - `tests/llm/prompts.test.ts`: aggiornare l'attesa su `TAGS_LINE` se il test la confronta.
    - `tests/db/piatto-unico-tag-migration.test.ts` (`// @vitest-environment node`, `describe.skipIf(!dbUp)`), sul modello di `recipe-courses-migration.test.ts`: DB usa-e-getta `mealy_tag_${process.pid}_${Date.now()}`, journal filtrato a `idx < 6`, `migrate` fino a `0005`; con SQL grezzo un household con `meal_style_tags = ARRAY['veloce','piatto-unico']` e due ricette con `tags` `ARRAY['piatto-unico','comfort-food']` e `ARRAY['leggero']`; `migrate` con la cartella reale; verificare `['veloce']`, `['comfort-food']`, `['leggero']`. `afterAll` chiude e fa `drop database … with (force)`.

### Contratti esposti

- `types.ts`: `CourseFilter`, `MEAL_COMPOSITION_VALUES`, `MEAL_COMPOSITION_ENUM`, `MealCompositionSchema`, `MealComposition`, `MEAL_COMPOSITION_LABELS`, `MealCompositionsSchema`, `MealCompositions`, `DEFAULT_MEAL_COMPOSITIONS`; `MEAL_STYLE_TAG_VALUES` a 11 valori.
- `compositions.ts`: le sette funzioni del passo 3 con quelle firme.
- `courses.ts`: `deriveStyleTags(tags, ingredients)`.

### Dipendenze

Nessuna.

### Criteri di accettazione

- Gate verde dopo `pnpm db:migrate`. `pnpm db:generate` dopo il WP risponde «No schema changes».
- `grep -rn "'piatto-unico'" lib components` trova solo usi come portata o composizione (nessuno come etichetta).
- Nessun comportamento del piano cambia: i test di `tests/plans/` e `tests/domain/planner.test.ts` passano senza modifiche.

### Fuori ambito

Colonne nuove, planner, servizio, UI del piano, Impostazioni.

---

## WP2 — Persistenza: `plan_slots.course`, `households.meal_compositions`, repository e impostazioni (wave 2, da solo)

**Obiettivo:** dare al DB e ai tipi la portata dello slot e le composizioni dell'household, propagarle nei repository, nelle impostazioni (tipi, normalizzazione, bozze di wizard e form) e nella vista del piano, senza ancora cambiare come si genera il piano.

### File

- Modificare: `lib/domain/types.ts`, `lib/db/schema.ts`, `lib/db/repositories/plan-repo.ts`, `lib/db/repositories/household-repo.ts`, `lib/settings/normalize.ts`, `lib/plans/service.ts` (solo i punti del passo 6), `components/settings/settings-editor.tsx` (solo `toHouseholdSettings`), `components/settings/onboarding-wizard.tsx` (solo la bozza iniziale), `tests/helpers/db.ts`, e ogni test che non compila o fallisce per i campi nuovi (in particolare `tests/db/plan-repo.test.ts`, `tests/db/schema.test.ts`, `tests/plans/*.test.ts`, `tests/shopping/service.test.ts`, `tests/settings/*.test.ts`, `tests/api/settings.test.ts`, `tests/ui/settings-*.test.tsx`, `tests/ui/onboarding-wizard.test.tsx`, `tests/ui/plan-slot-card.test.tsx`, `tests/ui/plan-screen.test.tsx`, `tests/ui/meal-card-plan.test.tsx`, `tests/app/*.test.tsx`).
- Creare: `lib/db/migrations/0007_add_meal_compositions.sql` (+ snapshot e voce del journal, generati), `tests/db/meal-compositions-migration.test.ts`.

### Pattern di riferimento

- Colonna array con default SQL: `households.meal_style_tags` in `schema.ts`.
- Migrazione con `UPDATE` sui dati esistenti: `0005_add_recipe_courses.sql`.
- Test di migrazione: `tests/db/recipe-courses-migration.test.ts`.

### Passi

1. **`types.ts`.**
   - `HouseholdSchema`: aggiungere `meal_compositions: MealCompositionsSchema.default(DEFAULT_MEAL_COMPOSITIONS),` dopo `meal_style_tags`. `DEFAULT_HOUSEHOLD`: `meal_compositions: DEFAULT_MEAL_COMPOSITIONS,`.
   - `PlanSlotSchema` e `PlanSlotViewSchema`: aggiungere `course: CourseSchema,` dopo `meal`. Il commento di `PlanViewSchema.slots` diventa `// ordinati per giorno, poi pranzo → cena, poi principale → contorno`.
   - `HouseholdSettingsSchema` e `SettingsViewSchema`: aggiungere `meal_compositions: MealCompositionsSchema,` dopo `meals`. (`UpdateSettingsRequestSchema` lo eredita.)
2. **`schema.ts`.**
   - `households`: dopo `meal_style_tags`:
     ```ts
     meal_compositions: jsonb('meal_compositions')
       .$type<Record<string, string[]>>()
       .notNull()
       .default(
         sql`'{"pranzo":["piatto-unico","primo","primo-contorno","secondo","secondo-contorno"],"cena":["piatto-unico","primo","primo-contorno","secondo","secondo-contorno"]}'::jsonb`
       ),
     ```
   - `plan_slots`: `course: text('course').notNull(),` dopo `meal`; l'indice diventa
     ```ts
     uniqueIndex('plan_slots_plan_day_meal_side_idx').on(
       table.plan_id,
       table.day,
       table.meal,
       sql`(${table.course} = 'contorno')`
     ),
     ```
     con il commento `// Al più un principale e un contorno per pasto.`
3. **Migrazione `0007`.** `pnpm db:generate --name add_meal_compositions` (crea SQL, snapshot e voce `idx: 7`; rinominare in `0007_add_meal_compositions` se serve). Poi **sostituire** il contenuto del file SQL con questo (drizzle genererebbe `ADD COLUMN "course" text NOT NULL`, che fallisce sulle righe esistenti):
   ```sql
   ALTER TABLE "households" ADD COLUMN "meal_compositions" jsonb DEFAULT '{"pranzo":["piatto-unico","primo","primo-contorno","secondo","secondo-contorno"],"cena":["piatto-unico","primo","primo-contorno","secondo","secondo-contorno"]}'::jsonb NOT NULL;
   --> statement-breakpoint
   ALTER TABLE "plan_slots" ADD COLUMN "course" text;
   --> statement-breakpoint
   UPDATE "plan_slots" AS s
   SET "course" = coalesce(
     (
       SELECT CASE
         WHEN 'piatto-unico' = ANY(r."courses") THEN 'piatto-unico'
         WHEN 'primo' = ANY(r."courses") THEN 'primo'
         WHEN 'secondo' = ANY(r."courses") THEN 'secondo'
       END
       FROM "recipes" AS r
       WHERE r."id" = s."recipe_id"
     ),
     'piatto-unico'
   );
   --> statement-breakpoint
   ALTER TABLE "plan_slots" ALTER COLUMN "course" SET NOT NULL;
   --> statement-breakpoint
   DROP INDEX "plan_slots_plan_day_meal_idx";
   --> statement-breakpoint
   CREATE UNIQUE INDEX "plan_slots_plan_day_meal_side_idx" ON "plan_slots" USING btree ("plan_id","day","meal",("course" = 'contorno'));
   ```
   Se drizzle-kit ha scritto la riga `CREATE UNIQUE INDEX` con un'altra forma dell'espressione, tenere la sua forma (deve restare l'espressione `"course" = 'contorno'`). Verifica: `pnpm db:migrate` sul DB di sviluppo, poi `pnpm db:generate` deve rispondere «No schema changes»; se segnala differenze, correggere `schema.ts` (non la migrazione) finché non le segnala più.
4. **`plan-repo.ts`.**
   - `PlanSlotRecord` e `NewSlotInput`: `course: Course;` dopo `meal`. `mapPlanWithSlots`: `course: CourseSchema.parse(slot.course),`. `insertSlots`: scrive `course: slot.course`.
   - `compareSlots`: dopo giorno e pasto, il contorno va dopo il principale: `if (a.meal !== b.meal) return …; return (a.course === 'contorno' ? 1 : 0) - (b.course === 'contorno' ? 1 : 0);`. Commento di `PlanWithSlots.slots`: `/** Ordinati per giorno, poi per indice del pasto in MEAL_TYPE_VALUES, poi principale → contorno. */`
   - `updateSlotRecipe(executor, slotId, recipeId, course?: Course)`: con `course` definito scrive anche `course`.
   - Nuova funzione:
     ```ts
     /** Blocca/sblocca tutti gli slot di un pasto. Restituisce il numero di slot aggiornati. */
     export async function setMealLocked(
       executor: DbExecutor,
       planId: string,
       day: string,
       meal: MealType,
       locked: boolean
     ): Promise<number>;
     ```
     (`update plan_slots set locked where plan_id = … and day = … and meal = … returning id`). `setSlotLocked` resta (lo usano i test).
5. **`household-repo.ts`.** `ensureDefaultHousehold`: `meal_compositions: { pranzo: [...DEFAULT_HOUSEHOLD.meal_compositions.pranzo], cena: [...DEFAULT_HOUSEHOLD.meal_compositions.cena] },`. `updateHousehold`: `if (data.meal_compositions !== undefined) updateValues.meal_compositions = { pranzo: [...data.meal_compositions.pranzo], cena: [...data.meal_compositions.cena] };`.
6. **`lib/plans/service.ts` (transitorio, fino a WP7).**
   - `toPlanView`: aggiungere `course: slot.course,` nella mappa degli slot.
   - `buildTargetPlan`, dentro la transazione: leggere la libreria una volta (`const library = await loadLibrary(tx);`), passarla a `computeSelection` al posto della chiamata inline, e in `insertSlots` scrivere `course: mainCourseOf(libraryById.get(recipeId)?.courses ?? [])` dove `libraryById = new Map(library.map((r) => [r.id, r]))` (per `recipeId` null: `mainCourseOf([])`, cioè `'piatto-unico'`). Import di `mainCourseOf` da `@/lib/domain/compositions`. Commento: `// Fino alla composizione dei pasti: un piatto per pasto, con la portata della ricetta.` Nient'altro cambia nel servizio.
7. **Impostazioni.**
   - `lib/settings/normalize.ts`: `normalizeSettings` restituisce anche `meal_compositions: { pranzo: reduceToOrder(settings.meal_compositions.pranzo, MEAL_COMPOSITION_VALUES), cena: reduceToOrder(settings.meal_compositions.cena, MEAL_COMPOSITION_VALUES) }`. `settingsEqual` confronta anche `meal_compositions.pranzo` e `.cena` elemento per elemento (stessa regola degli altri array). `householdToSettings` passa `meal_compositions: household.meal_compositions`. Aggiornare il commento «i quattro array» in «gli array». `lib/settings/service.ts` non cambia.
   - `settings-editor.tsx` (`toHouseholdSettings`) e `onboarding-wizard.tsx` (bozza iniziale): aggiungere `meal_compositions: view.meal_compositions` / `initialSettings.meal_compositions`.
8. **`tests/helpers/db.ts`.** `createTestHousehold(overrides?: Partial<Pick<Household, 'persons' | 'meals' | 'diet_tags' | 'meal_style_tags' | 'appliances' | 'meal_compositions'>>)`: scrive `meal_compositions: overrides?.meal_compositions ?? TEST_MEAL_COMPOSITIONS`, con `const TEST_MEAL_COMPOSITIONS: MealCompositions = { pranzo: ['piatto-unico'], cena: ['piatto-unico'] };` e il commento `// Un piatto per pasto, come prima della Feature 11: i test della composizione passano le loro.`
9. **Test da aggiornare** (solo i campi nuovi): ogni `insertSlots`/`NewSlotInput` dei test riceve `course: 'piatto-unico'`; ogni `PlanSlotView` costruito a mano (`makeSlot` di `plan-slot-card.test.tsx`, gli slot di `plan-screen.test.tsx`) riceve `course: 'piatto-unico'`; ogni `HouseholdSettings`/`SettingsView`/corpo di `PUT /api/settings` costruito a mano riceve `meal_compositions` (per i corpi delle API: `DEFAULT_MEAL_COMPOSITIONS`). `tests/db/plan-repo.test.ts`: le attese sugli slot letti includono `course`.
10. **Test nuovi.**
    - `tests/db/meal-compositions-migration.test.ts` (sul modello di `recipe-courses-migration.test.ts`, journal filtrato a `idx < 7`, DB `mealy_compositions_${process.pid}_${Date.now()}`): prima di `0007`, con SQL grezzo, un household, ricette A `courses ARRAY['secondo','piatto-unico']`, B `ARRAY['primo']`, C `ARRAY['secondo']`, D `ARRAY[]::text[]`, un piano e cinque slot (giorni diversi) con A, B, C, D e `recipe_id NULL`. Dopo `0007`: corsi `'piatto-unico'`, `'primo'`, `'secondo'`, `'piatto-unico'`, `'piatto-unico'`; `households.meal_compositions` uguale a `DEFAULT_MEAL_COMPOSITIONS`; un secondo slot non contorno nello stesso `(plan_id, day, meal)` viola l'indice; un contorno nello stesso pasto passa; un secondo contorno lo viola.
    - `tests/db/plan-repo.test.ts`: `setMealLocked` blocca principale e contorno dello stesso pasto e non tocca l'altro pasto; `updateSlotRecipe` con `course` cambia la portata; ordine di lettura principale → contorno anche se il contorno è inserito per primo.
    - `tests/settings/normalize.test.ts`: `normalizeSettings` ordina e toglie i doppioni delle composizioni; `settingsEqual` è `false` se cambia solo una composizione.
    - `tests/settings/service.test.ts`: salvare composizioni diverse cambia `updated_at` e restituisce `changed: true`; rileggendo, `meal_compositions` è quello salvato.

### Contratti esposti

- `Household.meal_compositions: MealCompositions` (default `DEFAULT_MEAL_COMPOSITIONS`); `HouseholdSettings.meal_compositions`; `SettingsView.meal_compositions`; `PlanSlot.course`, `PlanSlotView.course: Course`.
- `PlanSlotRecord.course`, `NewSlotInput.course`, `setMealLocked(executor, planId, day, meal, locked): Promise<number>`, `updateSlotRecipe(executor, slotId, recipeId, course?)`.
- `createTestHousehold({ meal_compositions })`, default un solo `'piatto-unico'` per pasto.

### Dipendenze

WP1 (tipi delle composizioni, `mainCourseOf`, migrazione `0006` già nel journal).

### Criteri di accettazione

- Gate verde dopo `pnpm db:migrate`; `pnpm db:generate` risponde «No schema changes».
- `GET /api/plans/current` restituisce `course` per ogni slot; `GET /api/settings` restituisce `meal_compositions`.
- Generazione, swap, scelta e *Ripeti* si comportano come prima (test di `tests/plans/` verdi con i soli ritocchi del passo 9).

### Fuori ambito

Planner, UI delle composizioni, contorni nel piano, rotte nuove.

---

## WP3 — Planner per portata (wave 3, parallelo a WP4, WP5, WP6)

**Obiettivo:** far lavorare il planner per (pasto, filtro di portata): idoneità, ordine per scarsità e carenze, lasciando al servizio il valore `'any-main'` che riproduce il comportamento di oggi.

### File

- Modificare: `lib/domain/planner.ts`, `tests/domain/planner.test.ts`, `lib/recipes/constraints.ts` (solo il commento di `findConstraintViolations`), `lib/plans/service.ts` (solo le chiamate del passo 5).

### Pattern di riferimento

- Struttura attuale di `selectRecipes` (pool, `mealRank`, `orderedSlots`, `needMore`): si generalizza, non si riscrive.

### Passi

1. **Firme.**
   ```ts
   export interface PlannerSlot {
     key: string;
     day: string;
     meal: MealType;
     /** Portata del piatto da riempire ('any-main' = una qualsiasi principale). */
     course: CourseFilter;
   }

   export function exclusionReason(
     recipe: Recipe,
     meal: MealType,
     course: CourseFilter,
     ctx: PlannerContext
   ): ExclusionReason | null;

   export function manualChoiceExclusionReason(
     recipe: Recipe,
     meal: MealType,
     course: CourseFilter,
     household: Pick<Household, 'diet_tags' | 'appliances'>
   ): ExclusionReason | null;

   export interface MealTypeShortage {
     meal_type: MealType;
     /** Portata della carenza: la stessa del filtro degli slot. */
     course: CourseFilter;
     slots: number;
     available: number;
     required: number;
     unfilled: number;
   }
   ```
   `ExclusionReason` non cambia.
2. **`exclusionReason`.** Il controllo `course` resta terzo: `if (!fitsCourse(recipe.courses, course)) return 'course';` (import da `./compositions`; via l'import di `isMainDish` e il commento «Fino alla Feature 11…»). Commento JSDoc: l'ultima riga diventa `La portata passa da \`coursesAllowed\` in entrambe (qui tramite \`fitsCourse\`).` `manualChoiceExclusionReason` passa `course`.
3. **`selectRecipes`.**
   - Costante privata `const COURSE_FILTER_ORDER: readonly CourseFilter[] = ['any-main', ...COURSE_VALUES];` e `const groupKey = (meal: MealType, course: CourseFilter): string => \`${meal}|${course}\`;`
   - Gruppi presenti: per ogni `meal` di `MEAL_TYPE_VALUES` e ogni `course` di `COURSE_FILTER_ORDER`, il gruppo esiste se almeno uno slot ha quel pasto e quella portata. Ordine "canonico" dei gruppi: pasto, poi portata in quell'ordine.
   - `eligibleByGroup`: `input.candidates.filter((r) => exclusionReason(r, meal, course, input) === null).sort((a, b) => compareStrings(a.id, b.id))`.
   - Rango: gruppi ordinati per numero di candidate idonee crescente, a parità nell'ordine canonico. `orderedSlots`: rango del gruppo, poi `day`, poi `key`.
   - Il ciclo di scelta resta identico (pool = idonee del gruppo non ancora scelte; `weightedPick`; `picked` condiviso tra tutti i gruppi, quindi nessuna ricetta due volte nel piano).
   - `needMore`: per ogni gruppo nell'ordine canonico, `slots` = slot del gruppo, `available` = idonee fresche del gruppo, `required = slots + config.minPoolSize - 1`, `unfilled` = slot del gruppo rimasti `null`; si aggiunge `{ meal_type, course, slots, available, required, unfilled }` se `available < required || unfilled > 0`. Il commento di `PlannerResult.needMore` diventa `/** Ordine di MEAL_TYPE_VALUES, poi della portata ('any-main', poi COURSE_VALUES). */`
4. **`computeGenerationCount`, `splitGenerationBatches`, pesi, recency**: invariati.
5. **`lib/plans/service.ts` — adattamento delle chiamate, comportamento invariato.** Ogni `PlannerSlot` costruito nel servizio riceve `course: 'any-main'` (`desiredSlots` e `pickRecipe` di `swapSlot`); `exclusionReason(recipe, slot.meal, 'any-main', {...})` in `computeSelection`; `manualChoiceExclusionReason(recipe, slot.meal, 'any-main', household)` in `listSlotCandidates` e `assignSlotRecipe`. Commento sopra `desiredSlots`: `// 'any-main' fino alla composizione dei pasti (WP7).` Nient'altro.
6. **`lib/recipes/constraints.ts`.** Nel JSDoc di `findConstraintViolations` l'ultima frase diventa `La portata passa da \`coursesAllowed\` in entrambe.`
7. **Test (`tests/domain/planner.test.ts`).** Aggiornare le chiamate alle firme nuove (`course: 'any-main'` negli slot esistenti, terzo argomento `'any-main'` nelle chiamate a `exclusionReason` dei test esistenti: il loro esito non cambia). Aggiungere:
   - `exclusionReason` con `'contorno'`: non classificata → `'course'`; `['contorno']` → `null`; con `'primo'`: `['secondo']` → `'course'`, `[]` → `null`; l'ordine resta (una ricetta bloccata e di portata sbagliata → `'blocked'`).
   - `selectRecipes` con slot `primo` e `contorno` sugli stessi giorni: nessuna ricetta solo contorno in uno slot `primo`, nessuna non classificata in uno slot `contorno`, nessun id ripetuto; una ricetta `['secondo','contorno']` non compare due volte.
   - Scarsità: ricetta A `['contorno']` e ricetta B `['contorno','secondo']`, uno slot `secondo` e uno `contorno` di cena → il gruppo `secondo` (1 candidata) va prima del gruppo `contorno` (2 candidate): `secondo` riceve B e `contorno` riceve A, con qualsiasi seme. Ripetere con 5 semi diversi.
   - `needMore` per gruppo: 3 slot `contorno` di cena con 2 contorni freschi → una voce `{ meal_type: 'cena', course: 'contorno', slots: 3, available: 2, required: 3 + minPoolSize - 1, unfilled: 1 }`; nessuna voce per un gruppo con abbastanza candidate; ordine delle voci pranzo → cena, poi `'any-main'`, `piatto-unico`, `primo`, `secondo`, `contorno`.
   - Determinismo: stesso seed ⇒ stesse assegnazioni con slot misti.

### Contratti esposti

Le firme del passo 1. `selectRecipes(input)` invariata nella forma.

### Dipendenze

WP1 (`CourseFilter`, `fitsCourse`), WP2 (il servizio compila con i campi nuovi).

### Criteri di accettazione

- Gate verde; i test di `tests/plans/` passano senza modifiche (il servizio usa `'any-main'`).

### Fuori ambito

Composizioni nel servizio, generazione per portata, contorni.

---

## WP4 — Composizioni nel campo «Pasti da pianificare» (wave 3, parallelo a WP3, WP5, WP6)

**Obiettivo:** far scegliere le composizioni di ogni pasto selezionato dentro `MealsField`, con la validazione che blocca *Avanti* nell'onboarding e *Salva* nelle Impostazioni.

### File

- Modificare: `components/settings/settings-fields.tsx`, `tests/ui/settings-fields.test.tsx`, `tests/ui/onboarding-wizard.test.tsx`, `tests/ui/settings-editor.test.tsx`.

### Pattern di riferimento

- `ChipGroupField` e `MealsField` in `settings-fields.tsx` (stessi `ChipFilter`, `toggleInOrder`, stile dell'avviso «Scegli almeno un pasto.»).

### Passi

1. **Copia.** `SETTINGS_FIELD_COPY.meals.description` = «Quali pasti vuoi trovare nel piano, e come li componi?».
2. **`MealsField`** riceve e restituisce pasti e composizioni insieme:
   ```ts
   export interface MealsFieldValue {
     meals: MealType[];
     compositions: MealCompositions;
   }
   export function MealsField(props: FieldProps<MealsFieldValue>): React.JSX.Element;
   ```
   Render: una `<section aria-labelledby={id}>` con `FieldHeading`, descrizione e il gruppo dei pasti come oggi (stesse classi di `ChipGroupField`; si può comporre `ChipGroupField` per la parte dei pasti, passando come `footer` l'avviso dei pasti e, sotto, i gruppi delle composizioni). Per ogni `meal` di `MEAL_TYPE_VALUES` **presente in `value.meals`**, nell'ordine:
   ```tsx
   <div className="flex flex-col gap-1 pt-3">
     <p id={groupId} className="text-sm font-semibold text-ink">{MEAL_TYPE_LABELS[meal]}</p>
     <div role="group" aria-labelledby={groupId} className="flex flex-wrap gap-2">
       {MEAL_COMPOSITION_VALUES.map((c) => (
         <ChipFilter key={c} label={MEAL_COMPOSITION_LABELS[c]} isSelected={…} onClick={…} />
       ))}
     </div>
     {value.compositions[meal].length === 0 && (
       <p role="alert" className="text-xs text-tomato">Scegli almeno una composizione.</p>
     )}
   </div>
   ```
   `groupId`: `${useId()}-${meal}`. Il clic su una composizione: `onChange({ ...value, compositions: { ...value.compositions, [meal]: toggleInOrder(value.compositions[meal], MEAL_COMPOSITION_VALUES, c) } })`.
3. **Clic su un pasto.** `nextMeals = toggleInOrder(value.meals, MEAL_TYPE_VALUES, meal)`. Se il pasto **esce** da `meals` e le sue composizioni sono vuote, si riportano a `[...MEAL_COMPOSITION_VALUES]` (requirements P18, commento `// Un pasto nascosto non può restare senza composizioni: il server lo rifiuterebbe.`). Altrimenti le composizioni non cambiano.
4. **`SettingsField`**, caso `"meals"`: `value={{ meals: settings.meals, compositions: settings.meal_compositions }}` e `onChange={(next) => onChange({ ...settings, meals: next.meals, meal_compositions: next.compositions })}`.
5. **`isSettingsFieldValid("meals", settings)`**: `settings.meals.length >= 1 && settings.meals.every((meal) => settings.meal_compositions[meal].length >= 1)`. Aggiornare il JSDoc: «`meals` richiede almeno un pasto e almeno una composizione per ogni pasto scelto».
6. `onboarding-wizard.tsx` e `settings-editor.tsx` non cambiano: usano già `SettingsField` e `isSettingsFieldValid`.
7. **Test.**
   - `settings-fields.test.tsx`: con pranzo e cena selezionati compaiono due gruppi («Pranzo», «Cena») da 5 chip; deselezionando *Pranzo* il gruppo «Pranzo» sparisce e `onChange` riceve `meals: ['cena']`; un clic su «Secondo + contorno» lo toglie dalle composizioni di quel pasto e l'ordine resta canonico; con un gruppo vuoto compare «Scegli almeno una composizione.»; deselezionare un pasto con composizioni vuote le riporta a tutte e cinque; `isSettingsFieldValid("meals", …)` è `false` con un pasto scelto senza composizioni e `true` se quel pasto non è scelto.
   - `onboarding-wizard.test.tsx`: al passo «Pasti da pianificare», togliendo tutte le composizioni di *Cena*, *Avanti* è disattivato; rimettendone una torna attivo; completando il wizard il corpo di `PUT /api/settings` contiene le composizioni scelte.
   - `settings-editor.test.tsx`: cambiare una composizione rende la bozza modificata e attiva *Salva*; togliere tutte le composizioni di un pasto scelto disattiva *Salva*.

### Contratti esposti

`MealsFieldValue`, nuova firma di `MealsField`.

### Dipendenze

WP1 (etichette e valori), WP2 (`HouseholdSettings.meal_compositions`).

### Criteri di accettazione

- Gate verde. A 360 px i chip vanno a capo senza scroll orizzontale (`flex-wrap`).

### Fuori ambito

Servizio delle impostazioni, API, altri campi.

---

## WP5 — Generazione per portata e proposta di un contorno (wave 3, parallelo a WP3, WP4, WP6)

**Obiettivo:** permettere al piano di generare ricette di una portata precisa (contorni compresi) e al selettore del contorno di chiedere al modello un contorno.

### File

- Modificare: `lib/domain/types.ts` (solo `ProposeRecipeRequestSchema`), `lib/recipes/generate.ts`, `lib/recipes/propose.ts`, `app/api/recipes/propose/route.ts`, `lib/library/client.ts`, `components/recipes/recipe-proposal-sheet.tsx`, `tests/recipes/generate.test.ts`, `tests/recipes/propose.test.ts`, `tests/api/recipes-propose.test.ts`, `tests/library/client.test.ts`, `tests/ui/recipe-proposal-sheet.test.tsx`.

### Pattern di riferimento

- `requestConstraints` in `propose.ts`; `mealTypeRef` in `recipe-proposal-sheet.tsx`.

### Passi

1. **`generate.ts`.** `GenerateAndStoreInput` riceve `/** Portate ammesse. Default: MAIN_COURSE_VALUES (ricette che fanno da pasto). */ courses?: readonly Course[];`. In `generateAndStoreRecipes` l'ultimo argomento di `buildConstraints` diventa `input.courses ?? MAIN_COURSE_VALUES`. Il commento «Piano, swap e /api/recipes/generate: solo ricette che fanno da pasto.» diventa «Default: ricette che fanno da pasto. Il piano chiede anche una portata precisa, contorni compresi.»
2. **`types.ts`.** In `ProposeRecipeRequestSchema`, dopo `meal_type`: `side_dish: z.boolean().default(false), // true: dal selettore del contorno, si chiede un contorno`.
3. **`propose.ts`.** `ProposeRecipeInput` riceve `/** Dal selettore del contorno: la ricetta deve essere un contorno. Default false. */ sideDish?: boolean;`. `requestConstraints(household, mealType, sideDish: boolean)`: portate = `sideDish ? ['contorno'] : mealType === null ? null : MAIN_COURSE_VALUES`. Aggiornare il JSDoc («… dal selettore del contorno solo un contorno»). `proposeRecipe` passa `input.sideDish ?? false`; il ricontrollo di `saveProposedRecipe` passa `false` (portata qualsiasi, come oggi).
4. **Rotta `propose`.** Passa `sideDish: parsed.data.side_dish`.
5. **`lib/library/client.ts`.** L'input di `requestRecipeProposal` riceve `sideDish?: boolean`. Nel corpo JSON si aggiunge `side_dish: true` **solo** se `sideDish === true` (i corpi esistenti restano identici).
6. **`recipe-proposal-sheet.tsx`.** Prop nuova `sideDish?: boolean` (default `false`, JSDoc `/** true: si chiede un contorno (selettore del contorno). */`), tenuta in un ref come `mealType` e passata a `requestRecipeProposal` come `sideDish`.
7. **Test.**
   - `generate.test.ts`: senza `courses` i vincoli passati al modello hanno `courses: ['piatto-unico','primo','secondo']` (come oggi); con `courses: ['contorno']` hanno `['contorno']` e una ricetta generata con `courses: ['secondo']` viene scartata con `constraint_violation`.
   - `propose.test.ts`: con `sideDish: true` i vincoli hanno `courses: ['contorno']` e una proposta `['secondo']` fallisce con `proposal_unsuitable`; senza, comportamento di oggi.
   - `recipes-propose.test.ts`: `side_dish: true` arriva al servizio (`sideDish: true`); un `side_dish` non booleano → 400.
   - `library/client.test.ts`: con `sideDish: true` il corpo contiene `"side_dish":true`; senza, il corpo è identico a prima.
   - `recipe-proposal-sheet.test.tsx`: con `sideDish` la chiamata riceve `sideDish: true`.

### Contratti esposti

`GenerateAndStoreInput.courses?`, `ProposeRecipeInput.sideDish?`, `ProposeRecipeRequest.side_dish`, `requestRecipeProposal({ …, sideDish? })`, `RecipeProposalSheet` con `sideDish?`.

### Dipendenze

WP2 (solo per il gate: `types.ts` è già stabile).

### Criteri di accettazione

Gate verde; `POST /api/recipes/generate` e la proposta dalla Libreria si comportano come prima.

### Fuori ambito

Servizio dei piani, selettore del Piano (WP8).

---

## WP6 — Errori e client dei piani (wave 3, parallelo a WP3, WP4, WP5)

**Obiettivo:** definire i nuovi errori di dominio e le funzioni client delle due rotte nuove.

### File

- Modificare: `lib/plans/errors.ts`, `lib/plans/client.ts`, `tests/plans/client.test.ts`.

### Passi

1. **`errors.ts`.** In coda a `PLAN_ERROR_CODES`: `'side_not_allowed'`, `'side_exists'`, `'not_a_side_dish'`. In `PLAN_ERROR_HTTP`: `side_not_allowed: { status: 409, message: 'Questo pasto non prevede un contorno.' }`, `side_exists: { status: 409, message: 'Questo pasto ha già un contorno.' }`, `not_a_side_dish: { status: 409, message: 'Si può togliere solo il contorno.' }`.
2. **`client.ts`.**
   ```ts
   /** POST /api/plans/{planId}/slots/{mainSlotId}/side: aggiunge un contorno al pasto. */
   export function requestAddSideDish(
     planId: string,
     mainSlotId: string,
     excludeRecipeIds: string[]
   ): Promise<PlanMutationResult>;
   // body: JSON.stringify({ exclude_recipe_ids: excludeRecipeIds }), schema PlanMutationResultSchema

   /** DELETE /api/plans/{planId}/slots/{sideSlotId}: toglie il contorno. */
   export function requestRemoveSideDish(planId: string, sideSlotId: string): Promise<PlanResult>;
   // { method: 'DELETE' }, schema PlanResultSchema
   ```
   Stesso schema di `requestSwapSlot` (`planPath`, `encodeURIComponent`, `request`).
3. **Test (`client.test.ts`)**, come quelli di `requestSwapSlot`: URL, metodo, corpo, risposta validata, errore `409 side_exists` tradotto in `PlanRequestError` con `code`.

### Contratti esposti

I tre codici e i due client.

### Dipendenze

WP2 (vista del piano con `course`).

### Criteri di accettazione

Gate verde.

### Fuori ambito

Rotte e servizio (WP7).

---

## WP7 — Servizio dei piani e rotte (wave 4, parallelo a WP8, WP9)

**Obiettivo:** comporre i pasti nella generazione e in *Ripeti*, lavorare per portata in swap, scelta e blocco, aggiungere e togliere il contorno, ed esporre le due rotte nuove.

### File

- Modificare: `lib/plans/service.ts`, `app/api/plans/[id]/slots/[slotId]/route.ts`, `tests/plans/service.test.ts`, `tests/plans/swap.test.ts`, `tests/plans/assign.test.ts`, `tests/plans/repeat.test.ts`, `tests/api/plans-swap.test.ts` (solo se rompe), `tests/api/plans.test.ts` (solo se rompe).
- Creare: `app/api/plans/[id]/slots/[slotId]/side/route.ts`, `tests/plans/compose.test.ts`, `tests/plans/side-dish.test.ts`, `tests/api/plans-side.test.ts`.

### Pattern di riferimento

- `swapSlot` (due fasi, lock, rilettura) e `app/api/plans/[id]/slots/[slotId]/swap/route.ts` (validazione uuid, `readJsonBody`, `SwapSlotRequestSchema`, `maxDuration`).
- Test DB dei piani: `tests/plans/swap.test.ts` (household di test, `insertTestRecipes`, `generate` finto, `now` fisso).

### Passi

1. **Chiavi.** `const slotKey = (day: string, meal: MealType, course: Course): string => \`${day}|${meal}|${course}\`;` e `const mealKey = (day: string, meal: MealType): string => \`${day}|${meal}\`;`. Helper privato `const sameMeal = (a: { day: string; meal: MealType }, b: { day: string; meal: MealType }): boolean => a.day === b.day && a.meal === b.meal;`
2. **Opzioni di costruzione.**
   ```ts
   interface BuildTargetPlanOptions {
     /** Chiave slot `${day}|${meal}|${course}` -> id ricetta da assegnare in anticipo (validata qui). */
     preassigned?: ReadonlyMap<string, string>;
     /** Chiave pasto `${day}|${meal}` -> composizione imposta (Ripeti). */
     presetCompositions?: ReadonlyMap<string, MealComposition>;
     generation: 'needMore' | 'unfilledOnly';
     maxRounds: number;
   }
   ```
3. **`computeSelection(ctx, existing, library, build, compositionSeed)`** (sostituisce `desiredSlots`, che si toglie):
   1. `keptMealKeys` = chiavi pasto degli slot di `existing` con `slot.day < ctx.target.first_day || slot.locked`; `kept` = tutti gli slot di `existing` la cui chiave pasto è in `keptMealKeys` (requirements P6).
   2. Pasti da riempire: per ogni giorno di `listDays(first_day, last_day)` e ogni pasto di `MEAL_TYPE_VALUES` in `household.meals`, se la chiave pasto non è in `keptMealKeys`.
   3. Composizioni: `const rng = createRng(compositionSeed);` Per ogni `meal` di `MEAL_TYPE_VALUES` (in quest'ordine): i pasti di quel tipo con una composizione in `build.presetCompositions` la prendono; gli altri (in ordine di giorno) ricevono, nell'ordine, `distributeCompositions(ctx.household.meal_compositions[meal], count, rng)`. Se `count` è 0 non si chiama.
   4. Slot da riempire: per ogni pasto, `compositionDishes(c)` → uno slot `{ key: slotKey(day, meal, main), day, meal, course: main }` e, se `side`, uno slot `{ …, course: 'contorno' }`.
   5. Preassegnazioni: come oggi, ma con la chiave slot nuova e `exclusionReason(recipe, slot.meal, slot.course, { … })`.
   6. `selectRecipes` sugli slot non preassegnati (con la loro `course`), poi `fills` come oggi (ogni `fill.slot` porta `course`).

   `Selection.fills` diventa `{ slot: PlannerSlot & { course: Course }; recipeId: string | null }[]`.
4. **`buildTargetPlan`.** All'inizio: `const compositionSeed = Math.floor(ctx.rng() * 0x1_0000_0000);` (commento: `// Un solo seme per tutta la costruzione: le composizioni restano le stesse tra un giro e l'altro.`). Tutte le chiamate a `computeSelection` (fuori e dentro la transazione) passano `build` e `compositionSeed`. I lotti di generazione passano la portata: `ctx.generate({ householdId, count, mealType: shortage.meal_type, courses: filterCourses(shortage.course) })`. In `insertSlots` ogni slot scrive `course: slot.course` (via la logica transitoria di WP2 con `mainCourseOf` e la mappa della libreria; via anche il commento). Il resto (kept, servings, archiviazione, lista) non cambia.
5. **`repeatPlan`.** Per ogni pasto della sorgente (gruppi di slot con stessa chiave pasto): `day = addDays(target.week_start, isoWeekday(slot.day) - 1)`; `c = mealCompositionOf(courses degli slot del pasto)`; se `c !== null`, `presetCompositions.set(mealKey(day, meal), c)`; per ogni slot con ricetta, `preassigned.set(slotKey(day, meal, slot.course), slot.recipe_id)`. Passa entrambe le mappe a `buildTargetPlan`. I pasti della sorgente fuori da `household.meals` restano ignorati come oggi.
6. **Pasto bloccato.** `findSwappableSlot(plan, slotId, today)`: dopo `slot_not_found`, `if (plan.slots.some((s) => sameMeal(s, slot) && s.locked)) throw new PlanError('slot_locked');`, poi `slot_past` come oggi.
7. **`fillDish`** (privata, requirements P12), estratta dal corpo attuale di `swapSlot`:
   ```ts
   interface DishFill {
     /** Controlli in più sullo slot di partenza, ripetuti sotto lock. Lanciano PlanError. */
     check: (plan: PlanWithSlots, slot: PlanSlotRecord) => void;
     /** Portata del piatto da riempire. */
     course: (slot: PlanSlotRecord) => Course;
     /** Scrive la ricetta scelta, dentro la transazione. */
     write: (tx: DbExecutor, slot: PlanSlotRecord, recipeId: string) => Promise<void>;
   }
   async function fillDish(
     planId: string,
     slotId: string,
     request: SwapSlotRequest,
     options: PlanServiceOptions,
     fill: DishFill
   ): Promise<PlanMutationResult>;
   ```
   Corpo = quello di `swapSlot` di oggi, con queste differenze: dopo ogni `findSwappableSlot` si chiama `fill.check(plan, slot)`; `pickRecipe` usa lo slot `{ key: slot.id, day: slot.day, meal: slot.meal, course: fill.course(slot) }`; la generazione usa `courses: filterCourses(fill.course(slot))` (e `mealType: slot.meal`, `count: config.generationMin`); in transazione, al posto di `updateSlotRecipe` si chiama `await fill.write(tx, currentSlot, recipeId)`. Uso della ricetta (`incrementRecipeUsage` con `day: currentSlot.day` se il piano è `active`) e `markShoppingListStale` restano.
   - `swapSlot(planId, slotId, request, options)` = `fillDish(…, { check: () => {}, course: (slot) => slot.course, write: (tx, slot, recipeId) => updateSlotRecipe(tx, slot.id, recipeId) })`.
   - `addSideDish(planId, mainSlotId, request, options)` (esportata, JSDoc «Aggiunge un contorno al pasto dello slot principale indicato. Stesse regole dello swap.») = `fillDish(…, { check: assertCanAddSide, course: () => 'contorno', write: (tx, slot, recipeId) => insertSlots(tx, planId, [{ day: slot.day, meal: slot.meal, course: 'contorno', recipe_id: recipeId, servings: slot.servings, locked: false }]) })`, con
     ```ts
     function assertCanAddSide(plan: PlanWithSlots, slot: PlanSlotRecord): void {
       if (slot.course !== 'primo' && slot.course !== 'secondo') throw new PlanError('side_not_allowed');
       if (plan.slots.some((s) => sameMeal(s, slot) && s.course === 'contorno')) throw new PlanError('side_exists');
     }
     ```
8. **`removeSideDish(planId, sideSlotId, options)`** (esportata): una sola transazione — `acquirePlanLock`, `loadOpenOwnedPlan`, `findSwappableSlot`, `if (slot.course !== 'contorno') throw new PlanError('not_a_side_dish')`, `deleteSlots(tx, [slot.id])`, `markShoppingListStale(tx, planId)`, rilettura (`getPlanById`). Restituisce `{ plan: toPlanView(fresh, household) }` con l'household letto nella transazione (`getHouseholdById`).
9. **`listSlotCandidates`**: filtro `slot.course === 'contorno' ? 'contorno' : 'any-main'` in `manualChoiceExclusionReason`. JSDoc: «… adatte al piatto: un contorno per il contorno, una qualsiasi principale per il principale.»
10. **`assignSlotRecipe`**: stesso filtro per l'idoneità. Poi:
    - se `slot.course === 'contorno'`: come oggi (`updateSlotRecipe(tx, slotId, recipeId)`), con il ritorno anticipato se la ricetta è già quella;
    - altrimenti: `side = plan.slots.find((s) => sameMeal(s, slot) && s.course === 'contorno')`; `course = mainCourseForChoice(recipe.courses, slot.course, side !== undefined)`; ritorno anticipato se `slot.recipe_id === recipeId && course === slot.course`; `await updateSlotRecipe(tx, slotId, recipeId, course)`; se `course === 'piatto-unico' && side` → `await deleteSlots(tx, [side.id])` (commento `// Un piatto unico non ha contorno.`). Uso e lista come oggi.
11. **`setSlotLock`**: dopo il controllo dello slot, `await setMealLocked(tx, planId, slot.day, slot.meal, locked)` al posto di `setSlotLocked`. JSDoc: «Blocca/sblocca tutti i piatti del pasto dello slot…».
12. **Rotte.**
    - `app/api/plans/[id]/slots/[slotId]/side/route.ts`: copia della rotta dello swap con `TAG = '[api/plans/side]'`, stessa `maxDuration = 250` e stesso commento, che chiama `addSideDish`.
    - `app/api/plans/[id]/slots/[slotId]/route.ts`: aggiungere `export async function DELETE(_request, { params })`: stessa validazione degli uuid del `PATCH`, nessun corpo, `Response.json(await removeSideDish(id, slotId), { status: 200 })`, errori con `handlePlanRouteError`.
13. **Test esistenti.** `swap.test.ts` (~191–205), `assign.test.ts` (~232–237, ~368), `service.test.ts` (~131–153) usano ricette `['secondo']`/`['contorno']` con l'household di test a un solo `'piatto-unico'`: passare a `createTestHousehold` le composizioni che il test intende (per esempio `{ pranzo: ['secondo'], cena: ['secondo'] }`) e adeguare le attese al significato nuovo (un contorno non entra in uno slot principale; *Scegli* sul principale elenca tutte le principali). Le attese su `generate` che confrontano l'oggetto intero ricevono `courses`.
14. **Test nuovi (DB, `// @vitest-environment node`, `describe.skipIf(!dbUp)`).**
    - `tests/plans/compose.test.ts` — *Genera piano*: household con le 5 composizioni per la sola cena e ricette sufficienti per portata (es. 10 `['piatto-unico']`, 10 `['primo']`, 10 `['secondo']`, 10 `['contorno']`, tutte `meal_types: ['cena']`), `now` fisso a lunedì, `rng` fisso: ogni pasto ha una composizione valida (`mealCompositionOf` delle portate dei suoi slot ≠ `null`); i conteggi per composizione differiscono al più di 1; ogni slot contiene una ricetta con quella portata; nessuna ricetta ripetuta; `generate` mai chiamata. Con una sola composizione `['secondo-contorno']` tutti i pasti sono secondo + contorno. Con 0 contorni in libreria e `generate` finto che crea contorni: `generate` chiamata con `courses: ['contorno']` e `mealType: 'cena'`. *Rigenera* con un pasto bloccato (secondo + contorno): il pasto resta identico (stessi id e ricette, tutti e due gli slot bloccati). Con 7 cene, solo `['secondo-contorno']` ammessa, 12 secondi e 5 contorni in libreria (i contorni sotto la soglia `7 + minPoolSize − 1`, i secondi no) e `generate` finto che salva le ricette della portata richiesta: il piano si scrive con 7 contorni, e `generate` riceve solo `courses: ['contorno']`, mai `['secondo']`.
    - `tests/plans/side-dish.test.ts` — su un piano scritto con `insertSlots`: `addSideDish` su un `secondo` aggiunge un contorno (`course: 'contorno'`, stesse porzioni, ricetta `['contorno']`), lista segnata da rifare, uso contato se il piano è `active`; su `piatto-unico` → `side_not_allowed`; su un pasto che ha già il contorno → `side_exists`; su un pasto bloccato → `slot_locked`; su un giorno passato → `slot_past`; senza contorni in libreria e `generate` finto → generazione con `courses: ['contorno']`. `removeSideDish` su un contorno lo cancella; su un principale → `not_a_side_dish`. `assignSlotRecipe` sul principale di un secondo + contorno con una ricetta `['piatto-unico']` → principale `piatto-unico` e contorno tolto; con una `['primo']` → principale `primo`, contorno tenuto. `listSlotCandidates` sul principale elenca principali di tutte le portate e nessun contorno solo contorno; sul contorno elenca solo contorni. `setSlotLock` sul contorno blocca anche il principale. `swapSlot` sul contorno sceglie un altro contorno. `buildPlanShoppingList` (`lib/shopping/service.ts`) su un piano con contorno contiene gli ingredienti del contorno.
    - `tests/plans/repeat.test.ts`: una sorgente con un pasto secondo + contorno produce nel giorno corrispondente un secondo + contorno con le stesse ricette; un contorno non più idoneo (bloccato) viene sostituito da un altro contorno.
    - `tests/api/plans-side.test.ts`: `POST …/side` 200 con `PlanMutationResult`; uuid non valido → 404 `slot_not_found`; `side_exists` → 409 con il messaggio; `DELETE …/slots/{id}` 200 su un contorno, 409 `not_a_side_dish` su un principale.

### Contratti esposti

`addSideDish(planId, mainSlotId, request, options?): Promise<PlanMutationResult>`, `removeSideDish(planId, sideSlotId, options?): Promise<PlanResult>`; rotte `POST /api/plans/{id}/slots/{slotId}/side` e `DELETE /api/plans/{id}/slots/{slotId}`.

### Dipendenze

WP3 (planner), WP5 (`courses` in `GenerateAndStoreInput`), WP6 (errori), WP1 e WP2.

### Criteri di accettazione

- Gate verde. Con l'household di default (5 composizioni) e il pacchetto in libreria, *Genera piano* non chiama il modello.
- Ogni pasto scritto rispetta FR-1.3; il DB rifiuta un secondo principale o un secondo contorno.

### Fuori ambito

UI, documenti, composizioni dell'onboarding.

---

## WP8 — Card del pasto con contorno e schermata Piano (wave 4, parallelo a WP7, WP9)

**Obiettivo:** mostrare un pasto con 1–2 piatti in una card sola, con riga contorno e «+ Contorno», aggiornare la schermata per pasto e far scegliere un contorno dal selettore.

### File

- Modificare: `components/cards/meal-card.tsx`, `components/plan/plan-slot-card.tsx`, `components/plan/plan-screen.tsx`, `components/plan/slot-recipe-picker.tsx`, `tests/ui/plan-slot-card.test.tsx`, `tests/ui/plan-screen.test.tsx`, `tests/ui/slot-recipe-picker.test.tsx`, `tests/ui/meal-card-plan.test.tsx` (solo se rompe).
- Creare: `components/plan/side-dish-row.tsx`, `tests/ui/side-dish-row.test.tsx`.

### Pattern di riferimento

- Pulsanti icona da 44 px e `aria-label` di `meal-card.tsx`; `pendingFocus` + `FOCUS_SELECTORS` di `plan-slot-card.tsx`; `withSlotFrom` di `plan-screen.tsx`.

### Passi

1. **`MealCard`.** Due prop nuove:
   ```ts
   /** Contenuto sotto il footer, dentro la card (riga contorno o «+ Contorno»). */
   extra?: React.ReactNode;
   /** Disattiva Cambia e Scegli (azione in corso su un altro piatto della card). */
   actionsDisabled?: boolean;
   ```
   `extra` si rende dopo il footer: `{extra && <div className="mt-2 border-t border-dashed border-stone/25 pt-2">{extra}</div>}`. *Cambia* e *Scegli*: `disabled={isLocked || actionsDisabled}`. Nient'altro cambia.
2. **`components/plan/side-dish-row.tsx`** (`"use client"`):
   ```ts
   export interface SideDishRowProps {
     title: string;
     /** Tap sul titolo: dettaglio. Assente → titolo non interattivo. */
     onOpen?: () => void;
     /** Assenti → nessun pulsante (riga di sola lettura). */
     onSwap?: () => void;
     onPick?: () => void;
     onRemove?: () => void;
     /** Pulsanti disattivati: azione in corso altrove nella card. */
     disabled?: boolean;
     /** Se presente, al posto di titolo e pulsanti: messaggio di attesa. */
     pendingMessage?: string | null;
   }
   ```
   Render: eyebrow `<span className="text-xs font-bold uppercase tracking-wider text-stone">Contorno</span>`; sotto, se `pendingMessage`: `<p role="status" className="flex min-h-[44px] items-center text-sm font-medium text-stone">{pendingMessage}</p>`; altrimenti una riga `flex items-center gap-1`: il titolo (con `onOpen`: `<button type="button" className="min-h-[44px] flex-1 truncate rounded-lg text-left text-sm font-semibold text-ink hover:text-basil focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil">`; senza: `<span className="flex-1 truncate text-sm font-semibold text-ink">`), poi i pulsanti presenti, ciascuno `h-11 w-11` con le classi di quelli di `meal-card.tsx`: ⟳ (`RefreshCw`, `text-tomato`, `aria-label={\`Cambia contorno: ${title}\`}`, `data-side-action="swap"`), lente (`Search`, `text-ink`, `Scegli contorno: …`, `data-side-action="pick"`), ✕ (`X`, `text-stone`, `Togli contorno: …`, `data-side-action="remove"`), tutti `disabled={disabled}` e con `e.stopPropagation()` nel clic.
3. **`PlanSlotCard`.** Props: `slot` resta il principale; nuova `side?: PlanSlotView | null` (default `null`). Stato in più: `sideMode: 'idle' | 'adding' | 'swapping' | 'removing'`, `sideRejected: string[]`, `pickerFor: 'main' | 'side' | null` (sostituisce `pickerOpen`).
   - Disponibilità: `canEditDishes = editable && swappable && !slot.locked`. `busy = mode === 'swapping' || sideMode !== 'idle'`.
   - Riga contorno (se `side`): `<SideDishRow title={side.recipe?.title ?? MISSING_RECIPE_TITLE} onOpen={side.recipe ? () => onSelectRecipe(side) : undefined} onSwap/onPick/onRemove={canEditDishes ? … : undefined} disabled={busy || mode === 'review'} pendingMessage={…} />`. `pendingMessage`: «Cerco un contorno…» con `sideMode` `swapping`, «Tolgo il contorno…» con `removing`, altrimenti `null`.
   - «+ Contorno» (se `!side && canEditDishes && (slot.course === 'primo' || slot.course === 'secondo')`): `<Button variant="ghost" className="min-h-[44px] text-basil" data-side-action="add" aria-label="Aggiungi un contorno" disabled={busy || mode === 'review'} onClick={…}><Plus className="h-4 w-4" aria-hidden="true" />Contorno</Button>`; con `sideMode === 'adding'` al suo posto `<p role="status" …>Cerco un contorno…</p>`.
   - Si passa a `MealCard` come `extra` e `actionsDisabled={sideMode !== 'idle'}`.
   - Azioni (tutte: `onError(apiErrorMessage(err))` in caso di errore; se il codice è in `STALE_CODES = new Set(['slot_locked','slot_past','plan_archived','plan_not_found','slot_not_found','side_exists','side_not_allowed','not_a_side_dish'])` si chiama anche `onPlanStale?.()`):
     - aggiunta: `sideMode = 'adding'` → `requestAddSideDish(planId, slot.id, [])` → `onPlanChange(result.plan)`, `sideRejected = []`, focus su `[data-side-action="swap"]`; errore → focus su `[data-side-action="add"]`. Sempre `sideMode = 'idle'` alla fine.
     - cambio: `exclude = buildExclude(sideRejected, side.recipe?.id)`; `sideMode = 'swapping'` → `requestSwapSlot(planId, side.id, exclude)` → `setSideRejected(exclude)`, `onPlanChange`, focus su `[data-side-action="swap"]`.
     - rimozione: `sideMode = 'removing'` → `requestRemoveSideDish(planId, side.id)` → `onPlanChange`, `sideRejected = []`, focus su `[data-side-action="add"]`; errore → focus su `[data-side-action="remove"]`.
     - scelta: `pickerFor = 'side'`; chiusura → focus su `[data-side-action="pick"]`; assegnazione → `onPlanChange`, `sideRejected = []`, stesso focus.
   - `FocusTarget` si estende con `"sideSwap" | "sidePick" | "sideAdd" | "sideRemove"` e i selettori `[data-side-action="…"]`; il meccanismo `pendingFocus` resta quello attuale.
   - Il selettore si rende una volta sola, fuori dal div con `key`: `pickerFor !== null && <SlotRecipePicker slot={pickerFor === 'side' && side ? side : slot} …/>`; `closePicker` e `handleAssigned` scelgono il focus in base a `pickerFor`.
   - Se lo slot viene bloccato durante un'azione sul contorno, la richiesta in corso arriva al server e torna `slot_locked`: basta la gestione d'errore sopra.
4. **`plan-screen.tsx`.**
   - `groupByDay` diventa
     ```ts
     interface MealGroup { main: PlanSlotView; side: PlanSlotView | null }
     function groupMealsByDay(slots: readonly PlanSlotView[]): { day: string; meals: MealGroup[] }[];
     ```
     Gli slot arrivano già ordinati (giorno, pasto, principale → contorno). Per ogni (giorno, pasto): `main` = il primo slot con `course !== 'contorno'`, se manca il primo slot del gruppo; `side` = lo slot `contorno` diverso da `main`, altrimenti `null`.
   - Nuova funzione pura accanto a `withSlotFrom`:
     ```ts
     /** Sostituisce gli slot del pasto (day, meal) con quelli della risposta: aggiunte e rimozioni comprese. */
     function withMealFrom(
       screen: PlanScreenView,
       serverPlan: PlanView,
       day: string,
       meal: MealType,
       planFields: Partial<Pick<PlanView, "shopping_list">> = {}
     ): PlanScreenView;
     ```
     Se il piano mostrato non c'è o ha un altro id → `screen`. Altrimenti scorre gli slot locali: al primo slot di quel pasto inserisce tutti gli slot della risposta di quel pasto (nell'ordine della risposta), salta gli altri slot locali di quel pasto, tiene il resto. Se il pasto non c'era localmente → `screen`.
   - Render: per ogni gruppo `<PlanSlotCard key={group.main.id} slot={group.main} side={group.side} swappable={group.main.day >= screen.today} onPlanChange={(next) => { shoppingListTouchedRef.current = true; setScreen((prev) => withMealFrom(prev, next, group.main.day, group.main.meal, { shopping_list: next.shopping_list })); }} …/>` (le altre prop come oggi).
   - Blocco: `setSlotLocked(slotId, locked)` diventa `setMealLocked(day, meal, locked)` (tutti gli slot del pasto). `handleToggleLock(slotId)`: trova lo slot, applica `setMealLocked(slot.day, slot.meal, next)`, chiama `requestSlotLock(plan.id, slotId, next)`; in risposta, per ogni slot locale del pasto prende `locked` dallo slot della risposta con lo stesso id (se c'è); in errore ripristina `!next` su tutto il pasto.
5. **`slot-recipe-picker.tsx`.** `const isSide = slot.course === "contorno";` Titolo: `isSide ? \`Scegli il contorno per ${…} · ${…}\` : \`Scegli per ${…} · ${…}\``. Testo dell'elenco vuoto: `isSide ? "Nessun altro contorno adatto a questo pasto" : "Nessun'altra ricetta adatta a questo pasto"`. `<RecipeProposalSheet … sideDish={isSide} />`.
6. **Test.**
   - `side-dish-row.test.tsx`: etichetta «Contorno» e titolo; i tre pulsanti con i loro `aria-label`; senza callback nessun pulsante; `disabled` li disattiva; con `pendingMessage` compare lo `status` e spariscono titolo e pulsanti; il tap sul titolo chiama `onOpen`.
   - `plan-slot-card.test.tsx` (con `requestAddSideDish`, `requestRemoveSideDish`, `requestSwapSlot` mockati): un secondo senza contorno mostra «Aggiungi un contorno»; un piatto unico no; un pasto bloccato o non modificabile non mostra pulsanti nella riga contorno né l'aggiunta; aggiunta → chiamata con `(planId, slot.id, [])`, attesa «Cerco un contorno…», poi `onPlanChange`; rimozione → `requestRemoveSideDish(planId, side.id)`; cambio contorno → `requestSwapSlot(planId, side.id, [idContornoAttuale])`, e un secondo cambio esclude anche il precedente; errore `side_exists` → `onError` e `onPlanStale`; durante lo swap del principale i pulsanti del contorno sono disattivati; durante un'azione sul contorno *Cambia* e *Scegli* del principale sono disattivati; il pulsante «Scegli contorno» apre il selettore con lo slot contorno.
   - `plan-screen.test.tsx`: un piano con un pasto secondo + contorno mostra una sola card con la riga contorno; dopo l'aggiunta (risposta con un contorno in più) la card mostra la riga; dopo la rimozione la riga sparisce e torna «Aggiungi un contorno»; il lucchetto blocca localmente entrambi gli slot del pasto e la `PATCH` parte con l'id del principale; un errore del blocco ripristina entrambi.
   - `slot-recipe-picker.test.tsx`: con uno slot `contorno` il titolo è «Scegli il contorno per …» e l'elenco vuoto dice «Nessun altro contorno adatto a questo pasto».

### Contratti esposti

`MealCardProps.extra`, `MealCardProps.actionsDisabled`, `SideDishRowProps`, `PlanSlotCardProps.side`.

### Dipendenze

WP2 (`PlanSlotView.course`), WP5 (`RecipeProposalSheet.sideDish`), WP6 (client e codici d'errore). Non dipende da WP7: i test mockano il client.

### Criteri di accettazione

- Gate verde. A 360 px la riga contorno sta su una riga sola (titolo troncato con `truncate`), tap target ≥ 44 px, nessuno scroll orizzontale.

### Fuori ambito

Servizio e rotte; selettore di composizione; ★ nella riga contorno (si mette dal dettaglio).

---

## WP9 — Documenti (wave 4, parallelo a WP7, WP8)

**Obiettivo:** allineare architettura, design e guida di deploy alla feature.

### File

- Modificare: `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/DEPLOY.md`.

### Passi

1. **`ARCHITECTURE.md`.** §4.2: `households.meal_compositions` (jsonb, composizioni ammesse per pasto, default tutte e cinque) e `plan_slots.course` (portata del piatto) con l'indice «al più un principale e un contorno per pasto»; l'etichetta di stile `piatto-unico` non c'è più. §5.2: prima della selezione, le composizioni ammesse si distribuiscono in modo bilanciato sui pasti da riempire (seme unico per costruzione); ogni pasto produce uno o due slot; idoneità per portata (non classificate: solo principali); carenze per (pasto, portata) e generazione per portata. §5.3: lo swap tiene la portata del piatto; «+ Contorno» e *Togli contorno*; *Scegli* sul principale fissa la portata e, con un piatto unico, toglie il contorno; il blocco vale per il pasto. §6: le due rotte nuove e `side_dish` nella proposta.
2. **`DESIGN.md`.** §3 (elemento firma): la card del pasto può avere una riga contorno sotto un divisore tratteggiato (etichetta «Contorno», titolo, ⟳ / lente / ✕) o il pulsante «+ Contorno»; il lucchetto blocca tutto il pasto. §4.1: un pasto = una card con 1–2 piatti. §4.5: il campo «Pasti da pianificare» comprende le composizioni per ogni pasto scelto (anche nel wizard). §5: i testi nuovi della tabella 0.5 di questo piano.
3. **`DEPLOY.md`.** In §6, dopo il paragrafo sulla 0.8: «Dalla 0.10 (Feature 11) i piani hanno una portata per piatto e l'household le composizioni dei pasti: tornando a una versione precedente alla 0.10, ripristina sempre il dump `mealy-predeploy-…`.» Se alla chiusura la versione scelta non è 0.10, correggere il numero.

### Dipendenze

Nessuna di codice (si scrive dal piano e dalla spec).

### Criteri di accettazione

I tre documenti descrivono il comportamento di questo piano; nessun riferimento all'etichetta di stile `piatto-unico` come etichetta.

### Fuori ambito

Wiki (`docs/wiki/`), README e versione: li fa la chiusura di `/feature-dev`.

---

## Mappa delle dipendenze

```
WP1 ──► WP2 ──┬─► WP3 ─┐
              ├─► WP4  │
              ├─► WP5 ─┼─► WP7
              └─► WP6 ─┤
                       ├─► WP8 (WP5, WP6)
                       └─► WP9
```

- **Sequenziali**: WP1 → WP2 → (wave 3) → (wave 4).
- **Wave 3 in parallelo** (file disgiunti): WP3 (`planner.ts`, `planner.test.ts`, `constraints.ts`, chiamate in `service.ts`), WP4 (`settings-fields.tsx` e test UI delle impostazioni), WP5 (`types.ts` per `side_dish`, `generate.ts`, `propose.ts`, rotta propose, `library/client.ts`, `recipe-proposal-sheet.tsx` e test), WP6 (`plans/errors.ts`, `plans/client.ts`, `client.test.ts`).
- **Wave 4 in parallelo** (file disgiunti): WP7 (`service.ts`, rotte, test `tests/plans/*` tranne `client.test.ts`, `tests/api/plans-*`), WP8 (componenti del Piano e loro test), WP9 (documenti).

## Checklist finale

- [ ] **WP1** — `CourseFilter` e composizioni in `types.ts`; `compositions.ts` (7 funzioni) + test; etichetta `piatto-unico` tolta da enum, `deriveStyleTags` (5 chiamanti), `recipeChips`, `TAGS_LINE`, fixture, pacchetto, 4 registrazioni, test; migrazione `0006` + test.
- [ ] **WP2** — `course` e `meal_compositions` in tipi, schema e migrazione `0007` (con `UPDATE` e indice su espressione) + test; `plan-repo` (`course`, ordine, `setMealLocked`, `updateSlotRecipe` con `course`); `household-repo`; `normalize.ts`; bozze di form e wizard; `toPlanView` e scrittura transitoria; `createTestHousehold`; ritocchi dei test.
- [ ] **WP3** — `PlannerSlot.course`, `exclusionReason`/`manualChoiceExclusionReason` con la portata, gruppi (pasto, portata), `needMore.course`; servizio con `'any-main'`; test.
- [ ] **WP4** — `MealsField` con le composizioni, validazione, ripristino al deselezionare; test di campo, wizard e form.
- [ ] **WP5** — `GenerateAndStoreInput.courses`; `side_dish` / `sideDish` in schema, servizio, rotta, client e sheet di proposta; test.
- [ ] **WP6** — tre codici d'errore; `requestAddSideDish`, `requestRemoveSideDish`; test.
- [ ] **WP7** — composizioni in `computeSelection` (seme unico, pasti tenuti, preset di *Ripeti*); generazione per portata; `fillDish`, `swapSlot`, `addSideDish`, `removeSideDish`; candidate e scelta per portata; blocco del pasto; rotte; test DB e API.
- [ ] **WP8** — `MealCard.extra`/`actionsDisabled`; `SideDishRow`; card con contorno e «+ Contorno»; `groupMealsByDay`, `withMealFrom`, blocco del pasto; selettore del contorno; test.
- [ ] **WP9** — ARCHITECTURE §4.2, §5.2, §5.3, §6; DESIGN §3, §4.1, §4.5, §5; DEPLOY §6.
- [ ] **Chiusura** (`/feature-dev`): wiki, README, versione (proposta 0.10.0), indice; verifiche manuali di `requirements.md` §5.
