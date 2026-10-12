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
    const { seedIngredientAliases } = await import('./seed-core');
    const inserted = await seedIngredientAliases();
    console.log(`Alias completati — inseriti o aggiornati: ${inserted}`);
  } catch (err) {
    console.error('Seed degli alias fallito:', err);
    process.exitCode = 1;
  } finally {
    if (clientToEnd) {
      await clientToEnd.end();
    }
  }
}

void main();

// Rende il file un modulo: senza, `main` collide con quello di seed.ts nello scope globale.
export {};
