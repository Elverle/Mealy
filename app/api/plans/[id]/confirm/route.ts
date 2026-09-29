import { z } from 'zod';
import { PlanError } from '@/lib/plans/errors';
import { handlePlanRouteError } from '@/lib/plans/http';
import { confirmPlan } from '@/lib/plans/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return handlePlanRouteError(new PlanError('plan_not_found'), '[api/plans/confirm]');
  }

  try {
    return Response.json(await confirmPlan(id), { status: 200 });
  } catch (err) {
    return handlePlanRouteError(err, '[api/plans/confirm]');
  }
}
