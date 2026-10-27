import { z } from 'zod';
import { UpdateRecipePrefRequestSchema } from '@/lib/domain/types';
import {
  errorResponse,
  internalErrorResponse,
  invalidRequestResponse,
  readJsonBody,
} from '@/lib/http/responses';
import { updateRecipePref } from '@/lib/prefs/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAG = '[api/recipes/pref]';
const UuidSchema = z.guid();
const RECIPE_NOT_FOUND = () => errorResponse(404, 'recipe_not_found', 'Ricetta non trovata.');

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) return RECIPE_NOT_FOUND();

  const body = await readJsonBody(request, { allowEmpty: false });
  if (!body.ok) return invalidRequestResponse();

  const parsed = UpdateRecipePrefRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequestResponse(parsed.error.issues);

  try {
    const prefs = await updateRecipePref(id, parsed.data);
    return prefs ? Response.json({ prefs }, { status: 200 }) : RECIPE_NOT_FOUND();
  } catch (err) {
    console.error(TAG, err);
    return internalErrorResponse();
  }
}
