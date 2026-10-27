// Solo lato server: importa il DB e il modulo recipes. I componenti client usano client.ts, format.ts ed errors.ts.
// Punto d'ingresso del servizio dei piani per rotte e test: il piano intero è in build.ts,
// le operazioni sui piatti in dishes.ts, tipi e helper comuni in shared.ts.

export { isPlanClosed } from '@/lib/domain/plan-status';
export { confirmPlan, generatePlan, getPlanScreen, repeatPlan } from './build';
export {
  addSideDish,
  assignSlotRecipe,
  listSlotCandidates,
  removeSideDish,
  setSlotLock,
  swapSlot,
} from './dishes';
export { toPlanView, type GenerateRecipesFn, type PlanServiceOptions } from './shared';
