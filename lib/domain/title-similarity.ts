// Similarità dei titoli a trigrammi, come pg_trgm (Feature 10): serve agli strumenti del pacchetto, che non usano il DB.

// Stessa soglia di TITLE_SIMILARITY_THRESHOLD in lib/db/repositories/recipe-repo.ts: simili se la similarità è > 0.6.
export const SIMILAR_TITLE_THRESHOLD = 0.6;

const TRIGRAM_LENGTH = 3;

/** Trigrammi delle parole del testo: minuscole, senza accenti, ciascuna con due spazi prima e uno dopo. */
export function titleTrigrams(text: string): Set<string> {
  const plain = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const words = plain.match(/[a-z0-9]+/g) ?? [];
  const trigrams = new Set<string>();

  for (const word of words) {
    const padded = `  ${word} `;
    for (let start = 0; start + TRIGRAM_LENGTH <= padded.length; start++) {
      trigrams.add(padded.slice(start, start + TRIGRAM_LENGTH));
    }
  }

  return trigrams;
}

/** |A∩B| / |A∪B| dei trigrammi; 0 se entrambi vuoti. */
export function titleSimilarity(a: string, b: string): number {
  const trigramsA = titleTrigrams(a);
  const trigramsB = titleTrigrams(b);
  if (trigramsA.size === 0 && trigramsB.size === 0) return 0;

  let shared = 0;
  for (const trigram of trigramsA) {
    if (trigramsB.has(trigram)) shared++;
  }
  const union = trigramsA.size + trigramsB.size - shared;
  return shared / union;
}

/** true se titleSimilarity(a, b) > SIMILAR_TITLE_THRESHOLD. */
export function areTitlesSimilar(a: string, b: string): boolean {
  return titleSimilarity(a, b) > SIMILAR_TITLE_THRESHOLD;
}
