import { UpdateSettingsRequestSchema } from '@/lib/domain/types';
import { getSettings, saveSettings } from '@/lib/settings/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const settings = await getSettings();
    return Response.json(settings, { status: 200 });
  } catch (err) {
    console.error('[api/settings]', err);
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

export async function PUT(request: Request): Promise<Response> {
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

  const parsed = UpdateSettingsRequestSchema.safeParse(body);
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

  try {
    const result = await saveSettings(parsed.data);
    return Response.json(result, { status: 200 });
  } catch (err) {
    console.error('[api/settings]', err);
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
