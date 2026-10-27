import { z } from 'zod';
import { AddShoppingItemRequestSchema } from '@/lib/domain/types';
import { invalidRequestResponse, readJsonBody } from '@/lib/http/responses';
import { ShoppingError } from '@/lib/shopping/errors';
import { handleShoppingRouteError } from '@/lib/shopping/http';
import { addManualShoppingItem } from '@/lib/shopping/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAG = '[api/plans/shopping-list/items]';
const UuidSchema = z.guid();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) {
    return handleShoppingRouteError(new ShoppingError('plan_not_found'), TAG);
  }

  const body = await readJsonBody(request, { allowEmpty: false });
  if (!body.ok) return invalidRequestResponse();

  const parsed = AddShoppingItemRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequestResponse(parsed.error.issues);

  try {
    const { item, created } = await addManualShoppingItem(id, parsed.data.name);
    return Response.json({ item }, { status: created ? 201 : 200 });
  } catch (err) {
    return handleShoppingRouteError(err, TAG);
  }
}
