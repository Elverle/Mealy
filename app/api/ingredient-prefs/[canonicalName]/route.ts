import { normalizeCanonicalName } from '@/lib/domain/recipe-text';
import { INGREDIENT_NAME_MAX, SetIngredientPrefRequestSchema } from '@/lib/domain/types';
import { internalErrorResponse, invalidRequestResponse, readJsonBody } from '@/lib/http/responses';
import { setIngredientPref } from '@/lib/prefs/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAG = '[api/ingredient-prefs/name]';

/** Next può consegnare il parametro già decodificato oppure no: si decodifica una volta, senza fallire. */
function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // già decodificato e contiene un '%' (es. "cioccolato 70%")
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ canonicalName: string }> }
): Promise<Response> {
  const name = normalizeCanonicalName(decodeParam((await params).canonicalName));
  if (name.length === 0 || name.length > INGREDIENT_NAME_MAX) return invalidRequestResponse();

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
