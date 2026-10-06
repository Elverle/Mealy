import { z } from 'zod';
import { errorResponse, internalErrorResponse } from '@/lib/http/responses';
import { getRecipeDetail } from '@/lib/library/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAG = '[api/recipes/id]';
const UuidSchema = z.string().uuid();
const RECIPE_NOT_FOUND = () => errorResponse(404, 'recipe_not_found', 'Ricetta non trovata.');

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) return RECIPE_NOT_FOUND();

  try {
    const detail = await getRecipeDetail(id);
    return detail ? Response.json(detail, { status: 200 }) : RECIPE_NOT_FOUND();
  } catch (err) {
    console.error(TAG, err);
    return internalErrorResponse();
  }
}
