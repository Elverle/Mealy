import { z } from 'zod';
import { UpdateShoppingItemRequestSchema } from '@/lib/domain/types';
import { invalidRequestResponse, readJsonBody } from '@/lib/http/responses';
import { ShoppingError } from '@/lib/shopping/errors';
import { handleShoppingRouteError } from '@/lib/shopping/http';
import { checkShoppingItem, removeManualShoppingItem } from '@/lib/shopping/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAG = '[api/shopping-items]';
const UuidSchema = z.guid();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) {
    return handleShoppingRouteError(new ShoppingError('item_not_found'), TAG);
  }

  const body = await readJsonBody(request, { allowEmpty: false });
  if (!body.ok) return invalidRequestResponse();

  const parsed = UpdateShoppingItemRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequestResponse(parsed.error.issues);

  try {
    return Response.json({ item: await checkShoppingItem(id, parsed.data.checked) }, { status: 200 });
  } catch (err) {
    return handleShoppingRouteError(err, TAG);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) {
    return handleShoppingRouteError(new ShoppingError('item_not_found'), TAG);
  }

  try {
    return Response.json({ id: await removeManualShoppingItem(id) }, { status: 200 });
  } catch (err) {
    return handleShoppingRouteError(err, TAG);
  }
}
