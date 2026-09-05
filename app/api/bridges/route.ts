import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadBridgeIndex, reserveBridgeRequest } from '@/db/bridges';
import { findConceptBridges } from '@/lib/bridge-model';
import { getRuntimeValue } from '@/lib/runtime-env';
import { getActiveXSession, withRenewedSession } from '@/lib/x-auth-server';
import { interpretConceptBridge } from '@/lib/xai-bridge';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (request.headers.get('origin') && request.headers.get('origin') !== request.nextUrl.origin)) return reply({ error: 'Use Ask Grok from Stimgraph.' }, 403);
  const active = await getActiveXSession(request);
  if (!active) return reply({ error: 'Connect X to ask Grok about your collection.' }, 401);
  const respond = (data: unknown, status = 200) => withRenewedSession(reply(data, status), request, active.renewedCookie);
  let from: string, to: string, visibleIds: string[];
  try {
    const raw = await request.text();
    if (raw.length > 100_000) return respond({ error: 'This map is too large for one bridge request.' }, 413);
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (body.consent !== true || typeof body.from !== 'string' || typeof body.to !== 'string' || body.from === body.to
      || !body.from.startsWith('topic:') || !body.to.startsWith('topic:') || !Array.isArray(body.visibleIds) || body.visibleIds.length > 600
      || body.visibleIds.some((id) => typeof id !== 'string' || id.length > 250 || !/^(topic|bookmark):.+/.test(id))) return respond({ error: 'Choose two different concepts and confirm the Grok action.' }, 400);
    from = body.from; to = body.to; visibleIds = [...new Set(body.visibleIds as string[])];
    if (!visibleIds.includes(from) || !visibleIds.includes(to)) return respond({ error: 'Choose concepts in the current map.' }, 400);
  } catch { return respond({ error: 'The bridge request could not be read.' }, 400); }
  try {
    const index = await loadBridgeIndex(active.session.profile.id, visibleIds);
    if (!index.nodes.has(from) || !index.nodes.has(to)) return respond({ error: 'One of these concepts is no longer in your collection. Refresh the map.' }, 404);
    const apiKey = getRuntimeValue('XAI_API_KEY');
    if (!apiKey) return respond({ error: 'Grok is not configured on this server. You can still explore routes from your saved posts.' }, 503);
    if (!await reserveBridgeRequest(active.session.profile.id)) return respond({ error: 'Bridge requests are limited to one every 20 seconds and 12 per day per account. Try again later.' }, 429);
    const routes = findConceptBridges(index, from, to);
    const result = await interpretConceptBridge(index, from, to, routes, { apiKey });
    return respond({ ...result, routes });
  } catch {
    return respond({ error: 'Grok could not produce a checked bridge right now. Your saved routes are still available.' }, 502);
  }
}
