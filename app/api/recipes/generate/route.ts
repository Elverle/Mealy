import { GenerateRecipesRequestSchema } from '@/lib/domain/types';
import {
  internalErrorResponse,
  invalidRequestResponse,
  llmErrorResponse,
} from '@/lib/http/responses';
import { generateAndStoreRecipes } from '@/lib/recipes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Un lotto con chiamata di riparazione può durare fino a 2 x LLM_TIMEOUT_MS.
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequestResponse();
  }

  const parsed = GenerateRecipesRequestSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequestResponse(parsed.error.issues);
  }

  const { count, meal_type, overrides } = parsed.data;

  try {
    const result = await generateAndStoreRecipes({
      count,
      mealType: meal_type,
      overrides,
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    console.error('[api/recipes/generate]', err);
    return llmErrorResponse(err) ?? internalErrorResponse();
  }
}
