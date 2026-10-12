// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { register } from '@/instrumentation';
import { runDbBootstrap } from '@/lib/db/bootstrap';

vi.mock('@/lib/db/bootstrap', () => ({
  runDbBootstrap: vi.fn(),
}));

describe('instrumentation register()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
