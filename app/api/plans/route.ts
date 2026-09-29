import { GeneratePlanRequestSchema } from '@/lib/domain/types';
import { invalidRequestResponse, readJsonBody } from '@/lib/http/responses';
import { handlePlanRouteError } from '@/lib/plans/http';
import { generatePlan } from '@/lib/plans/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Caso peggiore: maxGenerationRoundsPlan x 2 x LLM_TIMEOUT_MS (v. ARCHITECTURE §6).
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, { allowEmpty: true });
  if (!body.ok) return invalidRequestResponse();

  const parsed = GeneratePlanRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalidRequestResponse(parsed.error.issues);

  try {
    return Response.json(await generatePlan(), { status: 200 });
  } catch (err) {
    return handlePlanRouteError(err, '[api/plans]');
  }
}
