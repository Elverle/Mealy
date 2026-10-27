import { z } from 'zod';
import { AssignSlotRecipeRequestSchema } from '@/lib/domain/types';
import { invalidRequestResponse, readJsonBody } from '@/lib/http/responses';
import { PlanError } from '@/lib/plans/errors';
import { handlePlanRouteError } from '@/lib/plans/http';
import { assignSlotRecipe } from '@/lib/plans/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAG = '[api/plans/slot-recipe]';
const UuidSchema = z.guid();

export async function PUT(
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

  const parsed = AssignSlotRecipeRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequestResponse(parsed.error.issues);

  try {
    return Response.json(await assignSlotRecipe(id, slotId, parsed.data.recipe_id), {
      status: 200,
    });
  } catch (err) {
    return handlePlanRouteError(err, TAG);
  }
}
