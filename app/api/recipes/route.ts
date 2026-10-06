import { internalErrorResponse, invalidRequestResponse } from '@/lib/http/responses';
import { parseLibraryQuery } from '@/lib/domain/library';
import { listLibrary } from '@/lib/library/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAG = '[api/recipes]';

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
