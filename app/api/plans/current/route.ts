import { handlePlanRouteError } from '@/lib/plans/http';
import { getPlanScreen } from '@/lib/plans/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WEEK_QUERY_PARAM = 'settimana';

export async function GET(request: Request): Promise<Response> {
  const week = new URL(request.url).searchParams.get(WEEK_QUERY_PARAM) ?? undefined;
  try {
    return Response.json(await getPlanScreen({ week }), { status: 200 });
  } catch (err) {
    return handlePlanRouteError(err, '[api/plans/current]');
  }
}
