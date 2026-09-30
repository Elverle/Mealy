import { GENERATE_COUNT_MAX } from './types';

/** Parametri del planner: unico posto in cui vivono le costanti numeriche della selezione. */
export interface PlannerConfig {
  /** Sotto questa soglia (giorni dall'ultimo uso) il peso è ridotto a `recencyFloor`. */
  recencyMinDays: number;
  /** Da questa soglia (giorni dall'ultimo uso) in poi la recency non riduce più il peso. */
  recencyFullDays: number;
  /** Peso di una ricetta usata da meno di `recencyMinDays` giorni (non più 0). */
  recencyFloor: number;
  /** Peso minimo della recency per le preferite (1 = nessuna pausa; abbassarlo se si ripetono troppo). */
  favoriteRecencyFloor: number;
  favoriteBoost: number;
  noveltyBonus: number;
  ingredientLikeStep: number;
  ingredientLikeMaxCount: number;
  /** Candidate minime per l'ultimo slot di ogni tipo di pasto. */
  minPoolSize: number;
  /** Ricette in più rispetto al deficit. */
  generationExtra: number;
  /** Minimo di ricette per chiamata (anche per lo swap). */
  generationMin: number;
  /** Massimo di ricette richieste in totale per tipo di pasto (= GENERATE_COUNT_MAX). */
  generationMax: number;
  /** Dimensione di una singola chiamata LLM di generazione (latenza reale ~38 s per 3 ricette). */
  generationBatchSize: number;
  maxGenerationRoundsPlan: number;
  maxGenerationRoundsSwap: number;
}

export const PLANNER_CONFIG: PlannerConfig = {
  recencyMinDays: 10,
  recencyFullDays: 28,
  recencyFloor: 0.15,
  favoriteRecencyFloor: 1,
  favoriteBoost: 1.5,
  noveltyBonus: 1.2,
  ingredientLikeStep: 0.15,
  ingredientLikeMaxCount: 2,
  minPoolSize: 3,
  generationExtra: 2,
  generationMin: 3,
  generationMax: GENERATE_COUNT_MAX,
  generationBatchSize: 3,
  maxGenerationRoundsPlan: 2,
  maxGenerationRoundsSwap: 1,
};

/** Fuso orario in cui si calcolano "oggi" e le settimane del piano. */
export const APP_TIME_ZONE = 'Europe/Rome';
