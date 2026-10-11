for (const envFile of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // File absent: ignore
  }
}

async function main(): Promise<void> {
  let clientToEnd: { end: () => Promise<unknown> } | undefined;
  try {
    const { client } = await import('./index');
    clientToEnd = client;
    const { seedDatabase } = await import('./seed-core');
    const report = await seedDatabase();
    console.log(
      `Seed completato — household: ${report.household}, ricette inserite: ${report.recipesInserted}, già presenti: ${report.recipesSkipped}, alias inseriti o aggiornati: ${report.aliasesInserted}`
    );
  } catch (err) {
    console.error('Seed fallito:', err);
    process.exitCode = 1;
  } finally {
    if (clientToEnd) {
      await clientToEnd.end();
    }
  }
}

void main();
