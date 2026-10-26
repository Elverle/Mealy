// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { register } from '@/instrumentation';
import { runDbBootstrap } from '@/lib/db/bootstrap';
import { classifyPendingRecipes } from '@/lib/recipes/classify';
import { loadRecipePack } from '@/lib/recipes/pack/load';

vi.mock('@/lib/db/bootstrap', () => ({
  runDbBootstrap: vi.fn(),
}));

vi.mock('@/lib/recipes/classify', () => ({
  classifyPendingRecipes: vi.fn(),
}));

vi.mock('@/lib/recipes/pack/load', () => ({
  loadRecipePack: vi.fn(),
}));

const NOTHING_TO_CLASSIFY = {
  pending: 0,
  classified: 0,
  remaining: 0,
  failedBatches: 0,
  notConfigured: false,
};

describe('instrumentation register()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(classifyPendingRecipes).mockResolvedValue(NOTHING_TO_CLASSIFY);
    vi.mocked(loadRecipePack).mockResolvedValue({ inserted: 0, skipped: 0 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does nothing outside the nodejs runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('DB_BOOTSTRAP_ON_START', 'true');

    await register();

    expect(runDbBootstrap).not.toHaveBeenCalled();
  });

  it.each(['', 'false', '1', 'TRUE'])(
    'does nothing when DB_BOOTSTRAP_ON_START is "%s"',
    async (value) => {
      vi.stubEnv('NEXT_RUNTIME', 'nodejs');
      vi.stubEnv('DB_BOOTSTRAP_ON_START', value);

      await register();

      expect(runDbBootstrap).not.toHaveBeenCalled();
    }
  );

  it('runs the bootstrap once and logs the outcome when enabled', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DB_BOOTSTRAP_ON_START', 'true');
    vi.mocked(runDbBootstrap).mockResolvedValueOnce({ aliasesWritten: 3 });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await register();

    expect(runDbBootstrap).toHaveBeenCalledTimes(1);
    expect(runDbBootstrap).toHaveBeenCalledWith();
    expect(log).toHaveBeenCalledWith(
      '[bootstrap] migrazioni applicate; alias inseriti o aggiornati: 3'
    );
  });

  it('logs the error and exits with code 1 when the bootstrap fails', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DB_BOOTSTRAP_ON_START', 'true');
    const failure = new Error('boom');
    vi.mocked(runDbBootstrap).mockRejectedValueOnce(failure);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await register();

    expect(error).toHaveBeenCalledWith(
      '[bootstrap] avvio interrotto: migrazioni o alias non applicati',
      failure
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('starts the recipe classification once after a successful bootstrap', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DB_BOOTSTRAP_ON_START', 'true');
    vi.mocked(runDbBootstrap).mockResolvedValueOnce({ aliasesWritten: 0 });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await register();

    expect(classifyPendingRecipes).toHaveBeenCalledTimes(1);
    expect(classifyPendingRecipes).toHaveBeenCalledWith();
  });

  it('does not wait for the classification to finish', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DB_BOOTSTRAP_ON_START', 'true');
    vi.mocked(runDbBootstrap).mockResolvedValueOnce({ aliasesWritten: 0 });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(classifyPendingRecipes).mockReturnValueOnce(new Promise(() => {}));

    await register();

    expect(classifyPendingRecipes).toHaveBeenCalledTimes(1);
  });

  it('logs a failed classification without exiting the process', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DB_BOOTSTRAP_ON_START', 'true');
    vi.mocked(runDbBootstrap).mockResolvedValueOnce({ aliasesWritten: 0 });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const failure = new Error('classificazione giù');
    vi.mocked(classifyPendingRecipes).mockRejectedValueOnce(failure);

    await register();

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith('[classify] classificazione interrotta', failure);
    });
    expect(exit).not.toHaveBeenCalled();
  });

  it('does not start the classification when the bootstrap fails', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DB_BOOTSTRAP_ON_START', 'true');
    vi.mocked(runDbBootstrap).mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await register();

    expect(classifyPendingRecipes).not.toHaveBeenCalled();
  });

  it('does not start the classification outside the production bootstrap', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('DB_BOOTSTRAP_ON_START', 'true');

    await register();

    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DB_BOOTSTRAP_ON_START', 'false');

    await register();

    expect(classifyPendingRecipes).not.toHaveBeenCalled();
  });

  it('loads the recipe pack once, without arguments, after the bootstrap and before the classification', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DB_BOOTSTRAP_ON_START', 'true');
    vi.mocked(runDbBootstrap).mockResolvedValueOnce({ aliasesWritten: 0 });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await register();

    expect(loadRecipePack).toHaveBeenCalledTimes(1);
    expect(loadRecipePack).toHaveBeenCalledWith();
    expect(vi.mocked(loadRecipePack).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(runDbBootstrap).mock.invocationCallOrder[0]
    );
    expect(vi.mocked(loadRecipePack).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(classifyPendingRecipes).mock.invocationCallOrder[0]
    );
  });

  it('logs a failed recipe pack load without exiting, and still starts the classification', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DB_BOOTSTRAP_ON_START', 'true');
    vi.mocked(runDbBootstrap).mockResolvedValueOnce({ aliasesWritten: 0 });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const failure = new Error('pacchetto giù');
    vi.mocked(loadRecipePack).mockRejectedValueOnce(failure);

    await register();

    expect(error).toHaveBeenCalledWith('[pack] caricamento interrotto', failure);
    expect(exit).not.toHaveBeenCalled();
    expect(classifyPendingRecipes).toHaveBeenCalledTimes(1);
  });

  it('does not load the recipe pack when the bootstrap fails', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DB_BOOTSTRAP_ON_START', 'true');
    vi.mocked(runDbBootstrap).mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await register();

    expect(loadRecipePack).not.toHaveBeenCalled();
  });

  it.each(['', 'false', '1', 'TRUE'])(
    'does not load the recipe pack when DB_BOOTSTRAP_ON_START is "%s"',
    async (value) => {
      vi.stubEnv('NEXT_RUNTIME', 'nodejs');
      vi.stubEnv('DB_BOOTSTRAP_ON_START', value);

      await register();

      expect(loadRecipePack).not.toHaveBeenCalled();
    }
  );
});
