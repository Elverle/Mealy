// Usage: pnpm recipes:classify
// Classifica (portate ed etichette) le ricette senza portata sul DB di DATABASE_URL, come fa l'app all'avvio.

for (const envFile of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // File absent: ignore
  }
}

async function runClassification(): Promise<void> {
  let clientToEnd: { end: () => Promise<unknown> } | undefined;
  try {
    // Import dinamici: DATABASE_URL va letto dopo il caricamento di .env.
    const { client } = await import('@/lib/db');
    clientToEnd = client;
    const { classifyPendingRecipes } = await import('@/lib/recipes/classify');
    const report = await classifyPendingRecipes();
    console.log(
      `Classificazione completata — trovate: ${report.pending}, classificate: ${report.classified}, rimaste: ${report.remaining}, lotti falliti: ${report.failedBatches}`
    );
    if (report.notConfigured && report.remaining > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Classificazione fallita:', err);
    process.exitCode = 1;
  } finally {
    if (clientToEnd) {
      await clientToEnd.end();
    }
  }
}

void runClassification();
