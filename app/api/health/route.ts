import { errorResponse } from '@/lib/http/responses';
import { checkDatabase } from '@/lib/health/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HTTP_SERVICE_UNAVAILABLE = 503;

export async function GET(): Promise<Response> {
  try {
    await checkDatabase();
    return Response.json({ status: 'ok' }, { status: 200 });
  } catch (err) {
    console.error('[api/health]', err);
    return errorResponse(HTTP_SERVICE_UNAVAILABLE, 'db_unavailable', 'Database non raggiungibile.');
  }
}
