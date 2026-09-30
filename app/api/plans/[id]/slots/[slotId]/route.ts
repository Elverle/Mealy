import { z } from 'zod';
import { UpdateSlotRequestSchema } from '@/lib/domain/types';
import { invalidRequestResponse, readJsonBody } from '@/lib/http/responses';
import { PlanError } from '@/lib/plans/errors';
import { handlePlanRouteError } from '@/lib/plans/http';
import { setSlotLock } from '@/lib/plans/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAG = '[api/plans/slots]';
const UuidSchema = z.string().uuid();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; slotId: string }> }
): Promise<Response> {
  const { id, slotId } = await params;
  if (!UuidSchema.safeParse(id).success) {
    return handlePlanRouteError(new PlanError('plan_not_found'), TAG);
  }
  if (!UuidSchema.safeParse(slotId).success) {
    return handlePlanRouteError(new PlanError('slot_not_found'), TAG);
  }

  const body = await readJsonBody(request, { allowEmpty: false });
  if (!body.ok) return invalidRequestResponse();

  const parsed = UpdateSlotRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequestResponse(parsed.error.issues);

  try {
    return Response.json(await setSlotLock(id, slotId, parsed.data.locked), { status: 200 });
  } catch (err) {
    return handlePlanRouteError(err, TAG);
  }
}
