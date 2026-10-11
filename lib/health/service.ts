import { client } from '@/lib/db';

const DEFAULT_TIMEOUT_MS = 2000;

/** Risolve se il database risponde a `select 1` entro `timeoutMs`; altrimenti lancia. */
export async function checkDatabase(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`database: nessuna risposta in ${timeoutMs} ms`)),
      timeoutMs
    );
  });
  try {
    await Promise.race([client`select 1`, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
