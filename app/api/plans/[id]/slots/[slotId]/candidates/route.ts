import { z } from 'zod';
import { PlanError } from '@/lib/plans/errors';
import { handlePlanRouteError } from '@/lib/plans/http';
import { listSlotCandidates } from '@/lib/plans/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAG = '[api/plans/candidates]';
const UuidSchema = z.guid();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; slotId: string }> }
): Promise<Response> {
  const { id, slotId } = await params;
  if (!UuidSchema.safeParse(id).success) {
    return handlePlanRouteError(new PlanError('plan_not_found'), TAG);
  }
  if (!UuidSchema.safeParse(slotId).success) {
    return handlePlanRouteError(new PlanError('slot_not_found'), TAG);
  }

  try {
    return Response.json(await listSlotCandidates(id, slotId), { status: 200 });
  } catch (err) {
    return handlePlanRouteError(err, TAG);
  }
}
