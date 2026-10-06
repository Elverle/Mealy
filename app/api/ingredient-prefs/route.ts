import { internalErrorResponse } from '@/lib/http/responses';
import { listIngredientPrefs } from '@/lib/prefs/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAG = '[api/ingredient-prefs]';

export async function GET(): Promise<Response> {
  try {
    return Response.json(await listIngredientPrefs(), { status: 200 });
  } catch (err) {
    console.error(TAG, err);
    return internalErrorResponse();
  }
}
