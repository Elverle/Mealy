import { GenerateRecipesRequestSchema } from '@/lib/domain/types';
import { isLlmError } from '@/lib/llm/errors';
import { generateAndStoreRecipes } from '@/lib/recipes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        error: {
          code: 'invalid_request',
          message: 'Richiesta non valida.',
        },
      },
      { status: 400 }
    );
  }

  const parsed = GenerateRecipesRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'invalid_request',
          message: 'Richiesta non valida.',
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      { status: 400 }
    );
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

    if (isLlmError(err)) {
      if (err.code === 'config') {
        return Response.json(
          {
            error: {
              code: 'llm_not_configured',
              message: 'Generazione non disponibile: il modello non è configurato.',
            },
          },
          { status: 500 }
        );
      }
      if (err.code === 'timeout') {
        return Response.json(
          {
            error: {
              code: 'llm_timeout',
              message: 'La generazione non è andata a buon fine. Riprova.',
            },
          },
          { status: 504 }
        );
      }
      if (err.code === 'provider') {
        return Response.json(
          {
            error: {
              code: 'llm_unavailable',
              message: 'La generazione non è andata a buon fine. Riprova.',
            },
          },
          { status: 502 }
        );
      }
      if (err.code === 'invalid_output') {
        return Response.json(
          {
            error: {
              code: 'llm_invalid_output',
              message: 'La generazione non è andata a buon fine. Riprova.',
            },
          },
          { status: 502 }
        );
      }
    }

    return Response.json(
      {
        error: {
          code: 'internal_error',
          message: 'Qualcosa è andato storto. Riprova.',
        },
      },
      { status: 500 }
    );
  }
}
