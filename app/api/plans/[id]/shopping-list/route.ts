import { z } from 'zod';
import { ShoppingError } from '@/lib/shopping/errors';
import { handleShoppingRouteError } from '@/lib/shopping/http';
import { buildPlanShoppingList, getPlanShoppingList } from '@/lib/shopping/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAG = '[api/plans/shopping-list]';
const UuidSchema = z.guid();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) {
    return handleShoppingRouteError(new ShoppingError('plan_not_found'), TAG);
  }

  try {
    return Response.json(await getPlanShoppingList(id), { status: 200 });
  } catch (err) {
    return handleShoppingRouteError(err, TAG);
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) {
    return handleShoppingRouteError(new ShoppingError('plan_not_found'), TAG);
  }

  try {
    return Response.json(await buildPlanShoppingList(id), { status: 200 });
  } catch (err) {
    return handleShoppingRouteError(err, TAG);
  }
}
