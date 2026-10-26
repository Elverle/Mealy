// Errore degli strumenti del pacchetto: il messaggio è quello da stampare (il comando esce con 1).
export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackError';
  }
}

export function isPackError(error: unknown): error is PackError {
  return error instanceof PackError;
}
