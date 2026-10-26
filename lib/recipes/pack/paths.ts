// Percorsi degli strumenti del pacchetto (Feature 10), relativi alla radice del repository.

export const DEFAULT_WORK_DIR = '.recipe-pack';
export const DEFAULT_CSV_PATH = 'docs/recipe.csv';
export const PACK_FILE_PATH = 'fixtures/recipe-pack.json';
export const PACK_INGREDIENTS_FILE_PATH = 'fixtures/recipe-pack-ingredients.json';

export interface WorkPaths {
  candidates: string;
  selection: string;
  convertedDir: string;
  report: string;
  ingredientsReview: string;
}

/** Percorsi dei file di lavoro, sempre con "/". */
export function workPaths(workDir: string): WorkPaths {
  return {
    candidates: `${workDir}/candidates.json`,
    selection: `${workDir}/selection.md`,
    convertedDir: `${workDir}/converted`,
    report: `${workDir}/report.md`,
    ingredientsReview: `${workDir}/ingredients-review.md`,
  };
}

/** Percorso del record di conversione di un candidato. */
export function recordPath(workDir: string, code: string): string {
  return `${workDir}/converted/${code}.json`;
}
