// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET, runtime, dynamic } from '@/app/api/health/route';
import { checkDatabase } from '@/lib/health/service';

vi.mock('@/lib/health/service', () => ({
  checkDatabase: vi.fn(),
}));

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports correct route segment configurations', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
  });

  it('returns 200 with status ok when the database answers', async () => {
    vi.mocked(checkDatabase).mockResolvedValueOnce(undefined);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('returns 503 db_unavailable without leaking the original error', async () => {
    vi.mocked(checkDatabase).mockRejectedValueOnce(new Error('secret connection string boom'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: { code: 'db_unavailable', message: 'Database non raggiungibile.' },
    });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(error).toHaveBeenCalled();
  });
});
