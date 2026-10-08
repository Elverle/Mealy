import type { PlanStatus } from './types';

/**
 * Un piano è "chiuso" (solo consultazione) se archiviato o se la sua settimana è
 * già conclusa. Calcolato, non letto dallo stato: `archivePlansBefore` scatta solo
 * alla creazione di un piano nuovo.
 */
export function isPlanClosed(
  plan: { status: PlanStatus; week_start: string },
  currentWeekStart: string
): boolean {
  return plan.status === 'archived' || plan.week_start < currentWeekStart;
}
