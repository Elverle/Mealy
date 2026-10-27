import type { CourseFilter, Household, MealType, Recipe } from './types';
import { COURSE_VALUES, MEAL_TYPE_VALUES } from './types';
import { fitsCourse } from './compositions';
import { expandDietFlags, normalizeCanonicalName } from './recipe-text';
import { PLANNER_CONFIG, type PlannerConfig } from './planner-config';
import type { Rng } from './rng';

const MS_PER_DAY = 86_400_000;
const RATING_BASE = 0.25;
const RATING_DIVISOR = 4;

/** Nomi canonici già normalizzati con normalizeCanonicalName, letti da ingredient_prefs. */
export interface IngredientPreferenceSets {
  likes: ReadonlySet<string>;
  dislikes: ReadonlySet<string>;
}

export const EMPTY_INGREDIENT_PREFERENCES: IngredientPreferenceSets = {
  likes: new Set<string>(),
  dislikes: new Set<string>(),
};

/** Normalizza i nomi canonici e li raccoglie in due insiemi nuovi. */
export function toIngredientPreferenceSets(
  likes: Iterable<string>,
  dislikes: Iterable<string>
): IngredientPreferenceSets {
  return {
    likes: new Set(Array.from(likes, normalizeCanonicalName)),
    dislikes: new Set(Array.from(dislikes, normalizeCanonicalName)),
  };
}

export type ExclusionReason =
  | 'blocked'
  | 'meal_type'
  | 'course'
  | 'diet'
  | 'appliance'
  | 'disliked_ingredient'
  | 'excluded';

export interface PlannerContext {
  household: Pick<Household, 'diet_tags' | 'appliances'>;
  ingredientPrefs: IngredientPreferenceSets;
  excludeRecipeIds: ReadonlySet<string>;
}

/**
 * Motivo per cui una ricetta non è ammessa per un pasto, oppure `null` se lo è.
 * I controlli seguono un ordine fisso: vince il primo che scatta.
 *
 * Stesse regole di `findConstraintViolations` in `lib/recipes/constraints.ts`
 * (applicate alle ricette in libreria): se cambi una, controlla l'altra.
 * La portata passa da `coursesAllowed` in entrambe (qui tramite `fitsCourse`).
 */
export function exclusionReason(
  recipe: Recipe,
  meal: MealType,
  course: CourseFilter,
  ctx: PlannerContext
): ExclusionReason | null {
  if (recipe.prefs?.blocked === true) return 'blocked';
  if (!recipe.meal_types.includes(meal)) return 'meal_type';
  if (!fitsCourse(recipe.courses, course)) return 'course';

  const recipeDiets = new Set(expandDietFlags(recipe.diet_flags));
  if (ctx.household.diet_tags.some((diet) => !recipeDiets.has(diet))) return 'diet';

  const available = new Set(ctx.household.appliances);
  if (recipe.appliances_required.some((appliance) => !available.has(appliance))) return 'appliance';

  const hasDisliked = (recipe.ingredients ?? []).some((ing) =>
    ctx.ingredientPrefs.dislikes.has(normalizeCanonicalName(ing.canonical_name))
  );
  if (hasDisliked) return 'disliked_ingredient';

  if (ctx.excludeRecipeIds.has(recipe.id)) return 'excluded';
  return null;
}

const NO_EXCLUDED_RECIPES: ReadonlySet<string> = new Set<string>();

/**
 * Motivo per cui una ricetta non si può mettere a mano in un pasto, oppure `null` se si può.
 * Stesse regole di `exclusionReason`, ma senza gli ingredienti «non mi piace» e senza
 * esclusioni per id: chi sceglie una ricetta apposta la può mettere nel piano anche se
 * contiene un ingrediente scartato o se è già in un altro pasto. È l'unica definizione di
 * "adatta a questo pasto" per la scelta a mano (elenco delle candidate e assegnazione).
 */
export function manualChoiceExclusionReason(
  recipe: Recipe,
  meal: MealType,
  course: CourseFilter,
  household: Pick<Household, 'diet_tags' | 'appliances'>
): ExclusionReason | null {
  return exclusionReason(recipe, meal, course, {
    household,
    ingredientPrefs: EMPTY_INGREDIENT_PREFERENCES,
    excludeRecipeIds: NO_EXCLUDED_RECIPES,
  });
}

/** Giorni (in virgola mobile, mai negativi) trascorsi da `lastUsedAt`. */
function daysSince(lastUsedAt: Date, now: Date): number {
  return Math.max(0, (now.getTime() - lastUsedAt.getTime()) / MS_PER_DAY);
}

/** Fattore di recency senza l'eccezione delle preferite. */
function baseRecencyDecay(days: number, config: PlannerConfig): number {
  if (days < config.recencyMinDays) return config.recencyFloor;
  if (days >= config.recencyFullDays) return 1;
  const progress = (days - config.recencyMinDays) / (config.recencyFullDays - config.recencyMinDays);
  return config.recencyFloor + (1 - config.recencyFloor) * progress;
}

function recencyDecay(recipe: Recipe, now: Date, config: PlannerConfig): number {
  const lastUsedAt = recipe.prefs?.last_used_at;
  if (!lastUsedAt) return 1;
  const decay = baseRecencyDecay(daysSince(lastUsedAt, now), config);
  return recipe.prefs?.favorite ? Math.max(config.favoriteRecencyFloor, decay) : decay;
}

/**
 * Una ricetta è "fresca" se mai usata, usata da almeno `recencyMinDays` giorni,
 * oppure preferita. Le fresche alimentano il conteggio `available` di `needMore`.
 */
export function isFresh(
  recipe: Recipe,
  now: Date,
  config: PlannerConfig = PLANNER_CONFIG
): boolean {
  const lastUsedAt = recipe.prefs?.last_used_at;
  if (!lastUsedAt) return true;
  if (recipe.prefs?.favorite) return true;
  return daysSince(lastUsedAt, now) >= config.recencyMinDays;
}

/** Peso di selezione: prodotto di valutazione, preferita, recency, novità e affinità ingredienti. */
export function recipeWeight(
  recipe: Recipe,
  ingredientLikes: ReadonlySet<string>,
  now: Date,
  config: PlannerConfig = PLANNER_CONFIG
): number {
  const prefs = recipe.prefs;
  const rating = prefs?.rating;
  const ratingFactor = rating == null ? 1 : RATING_BASE + rating / RATING_DIVISOR;
  const favoriteBoost = prefs?.favorite ? config.favoriteBoost : 1;
  const noveltyBonus = (prefs?.times_used ?? 0) === 0 ? config.noveltyBonus : 1;

  const likedDistinct = new Set(
    (recipe.ingredients ?? [])
      .map((ing) => normalizeCanonicalName(ing.canonical_name))
      .filter((name) => ingredientLikes.has(name))
  ).size;
  const ingredientAffinity =
    1 + config.ingredientLikeStep * Math.min(config.ingredientLikeMaxCount, likedDistinct);

  return (
    ratingFactor * favoriteBoost * recencyDecay(recipe, now, config) * noveltyBonus * ingredientAffinity
  );
}

/** Estrazione pesata: `rng() * totale` sulla somma cumulata dei pesi. */
export function weightedPick<T>(items: readonly T[], weights: readonly number[], rng: Rng): T {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (items.length === 0 || total <= 0) {
    throw new Error('weightedPick: nessun elemento con peso positivo');
  }
  const r = rng() * total;
  let cumulative = 0;
  let lastPositive = -1;
  for (let i = 0; i < items.length; i++) {
    if (weights[i] > 0) lastPositive = i;
    cumulative += weights[i];
    if (r < cumulative) return items[i];
  }
  return items[lastPositive];
}

export interface PlannerSlot {
  key: string;
  day: string;
  meal: MealType;
  /** Portata del piatto da riempire ('any-main' = una qualsiasi principale). */
  course: CourseFilter;
}

export interface PlannerInput extends PlannerContext {
  /** Slot da riempire (qualsiasi ordine). */
  slots: readonly PlannerSlot[];
  /** Libreria dell'household con ingredients e prefs. */
  candidates: readonly Recipe[];
  now: Date;
  rng: Rng;
  /** Default PLANNER_CONFIG. */
  config?: PlannerConfig;
}

export interface PlannerAssignment {
  key: string;
  /** null = nessuna candidata. */
  recipeId: string | null;
}

export interface MealTypeShortage {
  meal_type: MealType;
  /** Portata della carenza: la stessa del filtro degli slot. */
  course: CourseFilter;
  /** Slot di quel pasto e di quella portata da riempire. */
  slots: number;
  /** Candidate idonee e fresche (mai usate, usate da almeno `recencyMinDays` giorni, o preferite). */
  available: number;
  /** slots + minPoolSize - 1. */
  required: number;
  /** Slot rimasti con recipeId null. */
  unfilled: number;
}

export interface PlannerResult {
  /** Stesso ordine di input.slots. */
  assignments: PlannerAssignment[];
  /** Ordine di MEAL_TYPE_VALUES, poi della portata ('any-main', poi COURSE_VALUES). */
  needMore: MealTypeShortage[];
}

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Filtri di portata in ordine canonico: prima 'any-main', poi le portate di COURSE_VALUES. */
const COURSE_FILTER_ORDER: readonly CourseFilter[] = ['any-main', ...COURSE_VALUES];
const groupKey = (meal: MealType, course: CourseFilter): string => `${meal}|${course}`;

/** Gruppo di slot con lo stesso pasto e la stessa portata. */
interface SlotGroup {
  meal: MealType;
  course: CourseFilter;
  key: string;
}

/**
 * Riempie gli slot con una selezione pesata dalla libreria, senza ripetere ricette.
 * Deterministica a parità di input e `rng`. Lavora per gruppi (pasto, portata): ogni gruppo
 * ha le sue candidate idonee. Segnala in `needMore` i gruppi per cui la libreria "fresca"
 * è scarsa o per cui restano slot vuoti.
 */
export function selectRecipes(input: PlannerInput): PlannerResult {
  const config = input.config ?? PLANNER_CONFIG;
  if (input.slots.length === 0) return { assignments: [], needMore: [] };

  const weightById = new Map<string, number>();
  for (const recipe of input.candidates) {
    weightById.set(
      recipe.id,
      recipeWeight(recipe, input.ingredientPrefs.likes, input.now, config)
    );
  }

  // Gruppi presenti negli slot, in ordine canonico: pasto, poi portata.
  const groups: SlotGroup[] = [];
  for (const meal of MEAL_TYPE_VALUES) {
    for (const course of COURSE_FILTER_ORDER) {
      if (input.slots.some((s) => s.meal === meal && s.course === course)) {
        groups.push({ meal, course, key: groupKey(meal, course) });
      }
    }
  }
  const eligibleByGroup = new Map<string, Recipe[]>(
    groups.map((group) => [
      group.key,
      input.candidates
        .filter((r) => exclusionReason(r, group.meal, group.course, input) === null)
        .sort((a, b) => compareStrings(a.id, b.id)),
    ])
  );

  // Il gruppo con meno candidate va per primo, così le ricette condivise non lo affamano.
  // sort è stabile: a parità vince l'ordine canonico dei gruppi.
  const groupRank = new Map<string, number>(
    [...groups]
      .sort((a, b) => eligibleByGroup.get(a.key)!.length - eligibleByGroup.get(b.key)!.length)
      .map((group, index) => [group.key, index] as const)
  );
  const orderedSlots = [...input.slots].sort(
    (a, b) =>
      groupRank.get(groupKey(a.meal, a.course))! - groupRank.get(groupKey(b.meal, b.course))! ||
      compareStrings(a.day, b.day) ||
      compareStrings(a.key, b.key)
  );

  const picked = new Set<string>();
  const assigned = new Map<string, string | null>();
  for (const slot of orderedSlots) {
    const pool = eligibleByGroup
      .get(groupKey(slot.meal, slot.course))!
      .filter((r) => !picked.has(r.id));
    if (pool.length === 0) {
      assigned.set(slot.key, null);
      continue;
    }
    const recipe = weightedPick(
      pool,
      pool.map((r) => weightById.get(r.id)!),
      input.rng
    );
    picked.add(recipe.id);
    assigned.set(slot.key, recipe.id);
  }

  const assignments = input.slots.map((slot) => ({
    key: slot.key,
    recipeId: assigned.get(slot.key) ?? null,
  }));

  const needMore: MealTypeShortage[] = [];
  for (const group of groups) {
    const groupSlots = input.slots.filter((s) => s.meal === group.meal && s.course === group.course);
    const available = eligibleByGroup
      .get(group.key)!
      .filter((r) => isFresh(r, input.now, config)).length;
    const required = groupSlots.length + config.minPoolSize - 1;
    const unfilled = groupSlots.filter((s) => assigned.get(s.key) === null).length;
    if (available < required || unfilled > 0) {
      needMore.push({
        meal_type: group.meal,
        course: group.course,
        slots: groupSlots.length,
        available,
        required,
        unfilled,
      });
    }
  }

  return { assignments, needMore };
}

/** Numero di ricette da generare per colmare una carenza, entro i limiti di configurazione. */
export function computeGenerationCount(
  shortage: MealTypeShortage,
  config: PlannerConfig = PLANNER_CONFIG
): number {
  const deficit = Math.max(shortage.required - shortage.available, shortage.unfilled);
  return Math.min(config.generationMax, Math.max(config.generationMin, deficit + config.generationExtra));
}

/** Richiesta di generazione per un gruppo (pasto, portata): quante ricette generare. */
export interface GenerationRequest {
  meal_type: MealType;
  course: CourseFilter;
  count: number;
}

/**
 * Ricette da generare per carenza, con al più `config.generationMax` ricette per tipo di pasto.
 * Dentro un tipo di pasto hanno la precedenza le carenze con slot vuoti (`unfilled > 0`), poi
 * l'ordine di `needMore`. Le carenze rimaste a 0 non compaiono.
 */
export function planGeneration(
  needMore: readonly MealTypeShortage[],
  config: PlannerConfig = PLANNER_CONFIG
): GenerationRequest[] {
  const counts = needMore.map(() => 0);
  const hasEmptySlots = (index: number): boolean => needMore[index].unfilled > 0;

  for (const meal of MEAL_TYPE_VALUES) {
    const indexes = needMore.flatMap((shortage, index) => (shortage.meal_type === meal ? [index] : []));
    const ordered = [
      ...indexes.filter((index) => hasEmptySlots(index)),
      ...indexes.filter((index) => !hasEmptySlots(index)),
    ];
    let budget = config.generationMax;
    for (const index of ordered) {
      counts[index] = Math.min(computeGenerationCount(needMore[index], config), budget);
      budget -= counts[index];
    }
  }

  return needMore.flatMap((shortage, index) =>
    counts[index] > 0
      ? [{ meal_type: shortage.meal_type, course: shortage.course, count: counts[index] }]
      : []
  );
}

/** Divide un numero di ricette in lotti da al più `generationBatchSize` (una chiamata LLM ciascuno). */
export function splitGenerationBatches(
  count: number,
  config: PlannerConfig = PLANNER_CONFIG
): number[] {
  const batches: number[] = [];
  for (let remaining = count; remaining > 0; remaining -= config.generationBatchSize) {
    batches.push(Math.min(config.generationBatchSize, remaining));
  }
  return batches;
}
