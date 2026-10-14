import { ProposeRecipeRequestSchema } from '@/lib/domain/types';
import { invalidRequestResponse, readJsonBody } from '@/lib/http/responses';
import { handleRecipeRouteError } from '@/lib/recipes/http';
import { proposeRecipe } from '@/lib/recipes/propose';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Una chiamata più l'eventuale riparazione: al più 2 x LLM_TIMEOUT_MS, come lo swap (ARCHITECTURE §6).
export const maxDuration = 250;

const TAG = '[api/recipes/propose]';
// Status non standard (nginx): il client ha chiuso la richiesta, quindi nessuno legge la risposta.
const HTTP_CLIENT_CLOSED_REQUEST = 499;

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, { allowEmpty: false });
  if (!body.ok) return invalidRequestResponse();

  const parsed = ProposeRecipeRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequestResponse(parsed.error.issues);

  try {
    const proposal = await proposeRecipe(
      {
        request: parsed.data.request,
        mealType: parsed.data.meal_type,
        excludeTitles: parsed.data.exclude_titles,
      },
      { abortSignal: request.signal }
    );
    return Response.json(proposal, { status: 200 });
  } catch (err) {
    // Annullata dal client: non è un guasto, quindi niente log né errore lato server.
    if (request.signal.aborted) {
      return new Response(null, { status: HTTP_CLIENT_CLOSED_REQUEST });
    }
    return handleRecipeRouteError(err, TAG);
  }
}
