// Errori di dominio dei piani. Nessun import dal DB: usabile anche dal client.

export const PLAN_ERROR_CODES = [
  'plan_not_found',
  'slot_not_found',
  'plan_confirmed',
  'plan_archived',
  'slot_locked',
  'slot_past',
  'insufficient_recipes',
  'no_alternatives',
  'repeat_same_week',
  'recipe_not_found',
  'recipe_not_eligible',
  'side_not_allowed',
  'side_exists',
  'not_a_side_dish',
] as const;
export type PlanErrorCode = (typeof PLAN_ERROR_CODES)[number];

// Codici che impongono di rileggere il piano mostrato.
export const STALE_PLAN_ERROR_CODES: ReadonlySet<string> = new Set<PlanErrorCode>([
  'slot_locked',
  'slot_past',
  'plan_archived',
  'plan_not_found',
  'slot_not_found',
  'side_exists',
  'side_not_allowed',
  'not_a_side_dish',
]);

export const PLAN_ERROR_HTTP: Record<PlanErrorCode, { status: number; message: string }> = {
  plan_not_found: { status: 404, message: 'Piano non trovato.' },
  slot_not_found: { status: 404, message: 'Pasto non trovato.' },
  plan_confirmed: {
    status: 409,
    message: 'Il piano è già confermato: puoi cambiare i singoli pasti.',
  },
  plan_archived: {
    status: 409,
    message: 'Questa settimana è conclusa: il piano si può solo consultare.',
  },
  slot_locked: { status: 409, message: 'Sblocca il pasto per cambiarlo.' },
  slot_past: { status: 409, message: 'Questo pasto è già passato.' },
  insufficient_recipes: {
    status: 422,
    message:
      'Non ho trovato abbastanza ricette per i tuoi vincoli. Prova ad allargare le impostazioni.',
  },
  no_alternatives: {
    status: 422,
    message: 'Non ci sono altre ricette adatte a questo pasto.',
  },
  repeat_same_week: {
    status: 409,
    message: 'Questo piano è già quello della settimana da pianificare.',
  },
  recipe_not_found: { status: 404, message: 'Ricetta non trovata.' },
  recipe_not_eligible: { status: 422, message: 'Questa ricetta non è adatta a questo pasto.' },
  side_not_allowed: { status: 409, message: 'Questo pasto non prevede un contorno.' },
  side_exists: { status: 409, message: 'Questo pasto ha già un contorno.' },
  not_a_side_dish: { status: 409, message: 'Si può togliere solo il contorno.' },
};

export class PlanError extends Error {
  readonly code: PlanErrorCode;

  constructor(code: PlanErrorCode) {
    super(PLAN_ERROR_HTTP[code].message);
    this.name = 'PlanError';
    this.code = code;
  }
}

export function isPlanError(error: unknown): error is PlanError {
  return error instanceof PlanError;
}
