import { z } from 'zod';
import { PlanError } from '@/lib/plans/errors';
import { handlePlanRouteError } from '@/lib/plans/http';
import { repeatPlan } from '@/lib/plans/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Come lo swap: al più un giro di generazione con chiamata di riparazione (v. ARCHITECTURE §6).
export const maxDuration = 250;

const TAG = '[api/plans/repeat]';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return handlePlanRouteError(new PlanError('plan_not_found'), TAG);
  }

  try {
    return Response.json(await repeatPlan(id), { status: 200 });
  } catch (err) {
    return handlePlanRouteError(err, TAG);
  }
}
