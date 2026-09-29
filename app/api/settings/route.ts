import { UpdateSettingsRequestSchema } from '@/lib/domain/types';
import { internalErrorResponse, invalidRequestResponse } from '@/lib/http/responses';
import { getSettings, saveSettings } from '@/lib/settings/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const settings = await getSettings();
    return Response.json(settings, { status: 200 });
  } catch (err) {
    console.error('[api/settings]', err);
    return internalErrorResponse();
  }
}

export async function PUT(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequestResponse();
  }

  const parsed = UpdateSettingsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequestResponse(parsed.error.issues);
  }

  try {
    const result = await saveSettings(parsed.data);
    return Response.json(result, { status: 200 });
  } catch (err) {
    console.error('[api/settings]', err);
    return internalErrorResponse();
  }
}
