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
] as const;
export type PlanErrorCode = (typeof PLAN_ERROR_CODES)[number];

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
