import { parseIngredientPrefName } from '@/lib/domain/prefs';
import { SetIngredientPrefRequestSchema } from '@/lib/domain/types';
import { internalErrorResponse, invalidRequestResponse, readJsonBody } from '@/lib/http/responses';
import { setIngredientPref } from '@/lib/prefs/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAG = '[api/ingredient-prefs/name]';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ canonicalName: string }> }
): Promise<Response> {
  // Next consegna il parametro già decodificato: non va decodificato di nuovo.
  const name = parseIngredientPrefName((await params).canonicalName);
  if (name === null) return invalidRequestResponse();

  const body = await readJsonBody(request, { allowEmpty: false });
  if (!body.ok) return invalidRequestResponse();

  const parsed = SetIngredientPrefRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequestResponse(parsed.error.issues);

  try {
    return Response.json(await setIngredientPref(name, parsed.data.pref), { status: 200 });
  } catch (err) {
    console.error(TAG, err);
    return internalErrorResponse();
  }
}
