/** Generatore pseudo-casuale: ogni chiamata restituisce un numero in [0, 1). */
export type Rng = () => number;

/** mulberry32: deterministico, stesso seed ⇒ stessa sequenza. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed casuale per l'uso reale (non nei test). Chiamata solo da `lib/plans/service.ts`. */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
