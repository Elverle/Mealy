// Errori di dominio del modulo recipes. Nessun import dal DB.

export const RECIPE_ERROR_CODES = ['proposal_unsuitable', 'recipe_unsuitable', 'recipe_duplicate'] as const;
export type RecipeErrorCode = (typeof RECIPE_ERROR_CODES)[number];

export const RECIPE_ERROR_HTTP: Record<RecipeErrorCode, { status: number; message: string }> = {
  proposal_unsuitable: {
    status: 422,
    message:
      'Non sono riuscito a proporre una ricetta adatta ai tuoi vincoli. Prova a cambiare la richiesta.',
  },
  recipe_unsuitable: {
    status: 422,
    message: 'La ricetta non rispetta più i vincoli delle impostazioni.',
  },
  recipe_duplicate: { status: 409, message: 'Questa ricetta è già in libreria.' },
};

export class RecipeError extends Error {
  readonly code: RecipeErrorCode;

  constructor(code: RecipeErrorCode) {
    super(RECIPE_ERROR_HTTP[code].message);
    this.name = 'RecipeError';
    this.code = code;
  }
}

export function isRecipeError(error: unknown): error is RecipeError {
  return error instanceof RecipeError;
}
