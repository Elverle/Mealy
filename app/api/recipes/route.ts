import { internalErrorResponse, invalidRequestResponse, readJsonBody } from '@/lib/http/responses';
import { parseLibraryQuery } from '@/lib/domain/library';
import { SaveRecipeRequestSchema, SavedRecipeInputSchema } from '@/lib/domain/types';
import { normalizeGeneratedRecipe } from '@/lib/domain/recipe-text';
import { listLibrary } from '@/lib/library/service';
import { handleRecipeRouteError } from '@/lib/recipes/http';
import { saveProposedRecipe } from '@/lib/recipes/propose';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAG = '[api/recipes]';
const POST_TAG = '[api/recipes POST]';

export async function GET(request: Request): Promise<Response> {
  const query = parseLibraryQuery(new URL(request.url).searchParams);
  if (!query.ok) return invalidRequestResponse(query.issues);

  try {
    return Response.json(await listLibrary(query.filter), { status: 200 });
  } catch (err) {
    console.error(TAG, err);
    return internalErrorResponse();
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, { allowEmpty: false });
  if (!body.ok) return invalidRequestResponse();

  const parsed = SaveRecipeRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequestResponse(parsed.error.issues);

  // Il client non è una fonte fidata: la ricetta si ri-normalizza e si rivalida qui.
  const normalized = SavedRecipeInputSchema.safeParse(normalizeGeneratedRecipe(parsed.data.recipe));
  if (!normalized.success) return invalidRequestResponse(normalized.error.issues);

  try {
    const recipe = await saveProposedRecipe({ recipe: normalized.data });
    return Response.json({ recipe }, { status: 201 });
  } catch (err) {
    return handleRecipeRouteError(err, POST_TAG);
  }
}
