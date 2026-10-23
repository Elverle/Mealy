// Usage: pnpm recipes:pack <passo> — prepara (sul PC) e carica il pacchetto iniziale di ricette (Feature 10).

import { PACK_GROUP_LABELS, PACK_GROUP_VALUES } from '@/lib/domain/types';
import { isLlmError } from '@/lib/llm/errors';
import { parsePackCommand, type PackCommand } from '@/lib/recipes/pack/command';
import { isPackError } from '@/lib/recipes/pack/errors';
import {
  DEFAULT_WORK_DIR,
  PACK_FILE_PATH,
  PACK_INGREDIENTS_FILE_PATH,
  workPaths,
} from '@/lib/recipes/pack/paths';

for (const envFile of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // File absent: ignore
  }
}

const paths = workPaths(DEFAULT_WORK_DIR);

async function runSelectStep(command: Extract<PackCommand, { step: 'select' }>): Promise<void> {
  const { runSelect } = await import('@/lib/recipes/pack/select');
  const report = await runSelect({
    csvPath: command.csvPath,
    workDir: DEFAULT_WORK_DIR,
    force: command.force,
  });
  for (const group of PACK_GROUP_VALUES) {
    const { checked, reserves, available } = report.groups[group];
    console.log(
      `${PACK_GROUP_LABELS[group]}: ${checked} spuntati, ${reserves} riserve (disponibili ${available})`
    );
  }
  for (const warning of report.warnings) {
    console.log(warning);
  }
  console.log(
    `Selezione scritta in ${paths.selection}: rivedila, poi lancia "pnpm recipes:pack convert".`
  );
}

async function runConvertStep(command: Extract<PackCommand, { step: 'convert' }>): Promise<void> {
  const { runConvert } = await import('@/lib/recipes/pack/convert');
  const report = await runConvert({
    workDir: DEFAULT_WORK_DIR,
    concurrency: command.concurrency,
    retryRejected: command.retryRejected,
  });
  for (const group of PACK_GROUP_VALUES) {
    const { accepted, quota, rejected, failed } = report.groups[group];
    console.log(
      `${PACK_GROUP_LABELS[group]}: ${accepted}/${quota} accettate, ${rejected} scartate, ${failed} errori del modello`
    );
  }
  console.log(`Report: ${paths.report}`);
  if (!report.complete) {
    for (const group of PACK_GROUP_VALUES) {
      const { accepted, quota } = report.groups[group];
      if (accepted < quota) {
        console.error(
          `${PACK_GROUP_LABELS[group]}: ${accepted}/${quota} — spunta altre ricette in ${paths.selection} e rilancia.`
        );
      }
    }
    process.exitCode = 1;
    return;
  }
  console.log('Conversione completa: lancia "pnpm recipes:pack ingredients".');
}

async function runIngredientsStep(command: Extract<PackCommand, { step: 'ingredients' }>): Promise<void> {
  const { runIngredients } = await import('@/lib/recipes/pack/ingredients');
  const report = await runIngredients({ workDir: DEFAULT_WORK_DIR, approve: command.approve });
  if (command.approve) {
    console.log(`Voci segnate come rivedute: ${report.approved}. Ora lancia "pnpm recipes:pack build".`);
  } else {
    console.log(
      `Ingredienti usati: ${report.used}, nuove bozze: ${report.added}, da rivedere: ${report.unreviewed}.`
    );
  }
  if (report.missing.length > 0) {
    console.error(
      `Nomi senza bozza: ${report.missing.join(', ')}. Rilancia "pnpm recipes:pack ingredients".`
    );
    process.exitCode = 1;
  } else if (report.unreviewed > 0) {
    console.log(
      `Rivedi ${paths.ingredientsReview} e ${PACK_INGREDIENTS_FILE_PATH}, poi lancia "pnpm recipes:pack ingredients --approve".`
    );
  }
}

async function runBuildStep(): Promise<void> {
  const { runBuild } = await import('@/lib/recipes/pack/build');
  const report = await runBuild({ workDir: DEFAULT_WORK_DIR });
  console.log(
    `Pacchetto scritto in ${PACK_FILE_PATH}: ${report.recipes} ricette. Report: ${paths.report}`
  );
}

async function runLoadStep(): Promise<void> {
  let clientToEnd: { end: () => Promise<unknown> } | undefined;
  try {
    // Import dinamici: DATABASE_URL va letto dopo il caricamento di .env.
    const { client } = await import('@/lib/db');
    clientToEnd = client;
    const { loadRecipePack } = await import('@/lib/recipes/pack/load');
    await loadRecipePack();
  } finally {
    if (clientToEnd) {
      await clientToEnd.end();
    }
  }
}

async function runStep(command: PackCommand): Promise<void> {
  switch (command.step) {
    case 'select':
      return runSelectStep(command);
    case 'convert':
      return runConvertStep(command);
    case 'ingredients':
      return runIngredientsStep(command);
    case 'build':
      return runBuildStep();
    case 'load':
      return runLoadStep();
  }
}

function reportError(err: unknown): void {
  if (isPackError(err)) {
    console.error(err.message);
  } else if (isLlmError(err) && err.code === 'config') {
    console.error(`Modello non configurato: ${err.message}`);
  } else {
    console.error('Errore inatteso:', err);
  }
}

async function main(): Promise<void> {
  try {
    const command = parsePackCommand(process.argv.slice(2));
    await runStep(command);
  } catch (err) {
    reportError(err);
    process.exitCode = 1;
  }
}

void main();
