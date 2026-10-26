// Report del pacchetto (Feature 10): esito delle conversioni per gruppo e statistiche di build.
// Scrive report.md nella cartella di lavoro; non importa il DB né l'LLM.

import fs from 'node:fs/promises';
import {
  COURSE_LABELS,
  COURSE_VALUES,
  DIET_FLAG_LABELS,
  DIET_FLAG_VALUES,
  MEAL_TYPE_LABELS,
  MEAL_TYPE_VALUES,
  PACK_GROUP_LABELS,
  PACK_GROUP_QUOTAS,
  PACK_GROUP_VALUES,
  PACK_MAIN_INGREDIENT_VALUES,
  type PackGroup,
  type PackStats,
} from '@/lib/domain/types';
import { workPaths } from './paths';
import type { PackWorkState } from './state';

const UTF8 = 'utf8';
const EMPTY_SECTION = 'Nessuna.';

export interface ReportInput {
  state: PackWorkState;
  stats: PackStats | null;
  generatedAt: Date;
  /** Default PACK_GROUP_QUOTAS. */
  quotas?: Readonly<Record<PackGroup, number>>;
}

interface AcceptedEntry {
  code: string;
  title: string;
  link: string;
  warnings: string[];
}

interface RejectedEntry {
  code: string;
  title: string;
  link: string;
  errors: string[];
}

type StatsRow = [label: string, count: number | undefined];

/** Codici spuntati del gruppo che hanno un record, nell'ordine di selection.md. */
function splitEntries(
  state: PackWorkState,
  group: PackGroup
): { accepted: AcceptedEntry[]; rejected: RejectedEntry[] } {
  const accepted: AcceptedEntry[] = [];
  const rejected: RejectedEntry[] = [];
  for (const code of state.checkedByGroup[group]) {
    const candidate = state.candidates.get(code);
    const record = state.records.get(code);
    if (candidate === undefined || record === undefined) continue;

    if (record.status === 'accepted' && record.recipe !== null) {
      accepted.push({
        code,
        title: record.recipe.title,
        link: candidate.link,
        warnings: record.warnings,
      });
    } else if (record.status === 'rejected') {
      rejected.push({ code, title: candidate.title, link: candidate.link, errors: record.errors });
    }
  }
  return { accepted, rejected };
}

function linesOrNone(lines: string[]): string[] {
  return lines.length > 0 ? lines : [EMPTY_SECTION];
}

function renderGroup(state: PackWorkState, group: PackGroup, quota: number): string {
  const { accepted, rejected } = splitEntries(state, group);
  const acceptedLines = accepted.flatMap((entry) => [
    `- ${entry.code} · ${entry.title} · ${entry.link}`,
    ...entry.warnings.map((warning) => `  - avviso: ${warning}`),
  ]);
  const rejectedLines = rejected.flatMap((entry) => [
    `- ${entry.code} · ${entry.title} · ${entry.link}`,
    ...entry.errors.map((error) => `  - ${error}`),
  ]);

  return [
    `## ${PACK_GROUP_LABELS[group]} — accettate ${accepted.length}/${quota}`,
    '',
    '### Accettate',
    '',
    ...linesOrNone(acceptedLines),
    '',
    '### Scartate',
    '',
    ...linesOrNone(rejectedLines),
  ].join('\n');
}

function statsTable(header: string, rows: StatsRow[]): string {
  return [
    `| ${header} | Ricette |`,
    '|---|---|',
    ...rows.map(([label, count]) => `| ${label} | ${count ?? 0} |`),
  ].join('\n');
}

function renderStats(stats: PackStats): string {
  const tables = [
    statsTable(
      'Portata',
      COURSE_VALUES.map((course): StatsRow => [COURSE_LABELS[course], stats.by_course[course]])
    ),
    statsTable(
      'Pasto',
      MEAL_TYPE_VALUES.map((mealType): StatsRow => [
        MEAL_TYPE_LABELS[mealType],
        stats.by_meal_type[mealType],
      ])
    ),
    statsTable(
      'Dieta',
      DIET_FLAG_VALUES.map((flag): StatsRow => [DIET_FLAG_LABELS[flag], stats.by_diet[flag]])
    ),
    statsTable(
      'Ingrediente principale',
      PACK_MAIN_INGREDIENT_VALUES.map((main): StatsRow => [main, stats.by_main_ingredient[main]])
    ),
    statsTable('Minuti', [
      ['fino a 30', stats.prep_minutes.up_to_30],
      ['31–60', stats.prep_minutes.up_to_60],
      ['61–120', stats.prep_minutes.up_to_120],
      ['oltre 120', stats.prep_minutes.over_120],
    ]),
  ];

  return ['## Statistiche', '', `Ricette: ${stats.total}`, '', tables.join('\n\n')].join('\n');
}

/** Testo di report.md: una sezione per gruppo, poi le statistiche se presenti. Termina con "\n". */
export function renderReport(input: ReportInput): string {
  const { state, stats, generatedAt, quotas = PACK_GROUP_QUOTAS } = input;
  const blocks = [
    '# Pacchetto di ricette — report',
    `Generato il ${generatedAt.toISOString()}.`,
    ...PACK_GROUP_VALUES.map((group) => renderGroup(state, group, quotas[group])),
  ];
  if (stats !== null) blocks.push(renderStats(stats));
  return `${blocks.join('\n\n')}\n`;
}

/** Scrive il report in workPaths(workDir).report, creando la cartella di lavoro se manca. */
export async function writeReport(workDir: string, input: ReportInput): Promise<void> {
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(workPaths(workDir).report, renderReport(input), UTF8);
}
