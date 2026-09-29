import { z } from 'zod';
import { SwapSlotRequestSchema } from '@/lib/domain/types';
import { invalidRequestResponse, readJsonBody } from '@/lib/http/responses';
import { PlanError } from '@/lib/plans/errors';
import { handlePlanRouteError } from '@/lib/plans/http';
import { swapSlot } from '@/lib/plans/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Un lotto di generazione con chiamata di riparazione (2 x LLM_TIMEOUT_MS) sta nei 200 s.
export const maxDuration = 200;

const TAG = '[api/plans/swap]';
const UuidSchema = z.string().uuid();

export async function POST(
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

  const body = await readJsonBody(request, { allowEmpty: true });
  if (!body.ok) return invalidRequestResponse();

  const parsed = SwapSlotRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequestResponse(parsed.error.issues);

  try {
    return Response.json(await swapSlot(id, slotId, parsed.data), { status: 200 });
  } catch (err) {
    return handlePlanRouteError(err, TAG);
  }
}
