// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkDatabase } from '@/lib/health/service';

// `client` di postgres-js è una funzione usata come tagged template: qui basta un vi.fn().
const { clientMock } = vi.hoisted(() => ({ clientMock: vi.fn() }));

vi.mock('@/lib/db', () => ({
  client: clientMock,
}));

describe('checkDatabase', () => {
  beforeEach(() => {
    clientMock.mockReset();
  });

  it('resolves when the database answers', async () => {
    clientMock.mockResolvedValueOnce([{ ok: 1 }]);

    await expect(checkDatabase()).resolves.toBeUndefined();
    expect(clientMock).toHaveBeenCalledTimes(1);
  });

  it('rejects with the database error', async () => {
    clientMock.mockRejectedValueOnce(new Error('connection refused'));

    await expect(checkDatabase()).rejects.toThrow('connection refused');
  });

  it('rejects when the database does not answer within the timeout', async () => {
    clientMock.mockReturnValueOnce(new Promise(() => {}));

    await expect(checkDatabase(20)).rejects.toThrow('database: nessuna risposta in 20 ms');
  });
});
