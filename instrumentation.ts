// Hook di avvio di Next.js: gira una volta, prima che il server accetti richieste.
// In produzione (DB_BOOTSTRAP_ON_START=true, v. docker-compose.prod.yml) applica le migrazioni,
// carica gli alias degli ingredienti e il pacchetto iniziale di ricette, e avvia in background la classificazione delle ricette senza portata.
// In sviluppo e nei test non fa nulla: lì restano `pnpm db:migrate` e `pnpm db:seed`.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DB_BOOTSTRAP_ON_START === 'true') {
    const { runDbBootstrap } = await import('./lib/db/bootstrap');
    try {
      const report = await runDbBootstrap();
      console.log(
        `[bootstrap] migrazioni applicate; alias inseriti o aggiornati: ${report.aliasesWritten}`
      );
      // Pacchetto iniziale di ricette (Feature 10): atteso, così il primo piano lo vede; un errore non ferma l'avvio.
      try {
        const { loadRecipePack } = await import('./lib/recipes/pack/load');
        await loadRecipePack();
      } catch (err) {
        console.error('[pack] caricamento interrotto', err);
      }
      // Classificazione delle ricette senza portata (Feature 8): in background, la partenza non la aspetta.
      try {
        const { classifyPendingRecipes } = await import('./lib/recipes/classify');
        void classifyPendingRecipes().catch((err) => {
          console.error('[classify] classificazione interrotta', err);
        });
      } catch (err) {
        console.error('[classify] classificazione interrotta', err);
      }
    } catch (err) {
      console.error('[bootstrap] avvio interrotto: migrazioni o alias non applicati', err);
      process.exit(1);
    }
  }
}
