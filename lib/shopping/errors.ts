// Errori di dominio della lista della spesa. Nessun import dal DB: usabile anche dal client.

export const SHOPPING_ERROR_CODES = [
  'plan_not_found',
  'list_not_found',
  'item_not_found',
  'plan_not_confirmed',
  'plan_archived',
  'item_not_manual',
] as const;
export type ShoppingErrorCode = (typeof SHOPPING_ERROR_CODES)[number];

export const SHOPPING_ERROR_HTTP: Record<ShoppingErrorCode, { status: number; message: string }> = {
  plan_not_found: { status: 404, message: 'Piano non trovato.' },
  list_not_found: { status: 404, message: 'Lista della spesa non trovata.' },
  item_not_found: { status: 404, message: 'Articolo non trovato.' },
  plan_not_confirmed: { status: 409, message: 'Conferma il piano per creare la lista della spesa.' },
  plan_archived: {
    status: 409,
    message: 'Questa settimana è conclusa: la lista si può solo consultare.',
  },
  item_not_manual: { status: 409, message: 'Si possono rimuovere solo gli articoli aggiunti a mano.' },
};

export class ShoppingError extends Error {
  readonly code: ShoppingErrorCode;

  constructor(code: ShoppingErrorCode) {
    super(SHOPPING_ERROR_HTTP[code].message);
    this.name = 'ShoppingError';
    this.code = code;
  }
}

export function isShoppingError(error: unknown): error is ShoppingError {
  return error instanceof ShoppingError;
}
