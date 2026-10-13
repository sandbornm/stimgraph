import type { NextRequest } from 'next/server';
import { requestOrigin } from '@/lib/request-origin';
import { NextResponse } from 'next/server';
import { deleteTrajectory, loadTrajectories, saveTrajectory } from '@/db/trajectories';
import { parseTrajectoryDraft } from '@/lib/trajectory-model';
import { getActiveXSession, withRenewedSession } from '@/lib/x-auth-server';

export const dynamic = 'force-dynamic';

async function handle(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
  if (request.method !== 'GET' && (request.headers.get('sec-fetch-site') === 'cross-site'
    || (request.headers.get('origin') && request.headers.get('origin') !== requestOrigin(request)))) {
    return reply({ error: 'Use the trajectory controls in Stimgraph.' }, 403);
  }
  const active = await getActiveXSession(request);
  if (!active) return reply({ error: 'Connect X to save and reopen your trajectories.' }, 401);
  const respond = (data: unknown, status = 200) => withRenewedSession(reply(data, status), request, active.renewedCookie);
  const ownerId = active.session.profile.id;
  try {
    if (request.method === 'GET') return respond({ trajectories: await loadTrajectories(ownerId) });
    if (request.method === 'DELETE') {
      const id = request.nextUrl.searchParams.get('id');
      if (!id || id.length > 100) return respond({ error: 'Choose a saved trajectory.' }, 400);
      const removed = await deleteTrajectory(ownerId, id);
      return respond(removed ? { deleted: true } : { error: 'This trajectory was not found.' }, removed ? 200 : 404);
    }
    let draft;
    try {
      const body = await request.text();
      if (body.length > 100_000) return respond({ error: 'This trajectory is too large.' }, 413);
      draft = parseTrajectoryDraft(JSON.parse(body));
    } catch { return respond({ error: 'The trajectory could not be read.' }, 400); }
    if (!draft) return respond({ error: 'Add a name and follow 2–80 different steps before saving.' }, 400);
    const trajectory = await saveTrajectory(ownerId, draft);
    return trajectory ? respond({ trajectory }, 201) : respond({ error: 'You have 100 saved trajectories. Remove one to save another.' }, 409);
  } catch {
    return respond({ error: 'Trajectories are unavailable right now. Your current path is still on the canvas.' }, 503);
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
