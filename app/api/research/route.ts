import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { deleteResearchCard, loadResearchCards, loadResearchSources, reserveResearchRequest, saveResearchCard } from '@/db/research';
import { parseResearchDraft, researchLenses, saveIntents, type ResearchLens, type ResearchReach, type SaveIntent } from '@/lib/research-model';
import { generateResearchCard } from '@/lib/xai-research';
import { searchNearbyWork } from '@/lib/nearby-work';
import { getRuntimeValue } from '@/lib/runtime-env';
import { getActiveXSession, withRenewedSession } from '@/lib/x-auth-server';

export const dynamic = 'force-dynamic';

async function handle(request: NextRequest) {
  const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method !== 'GET' && (request.headers.get('sec-fetch-site') === 'cross-site'
    || (request.headers.get('origin') && request.headers.get('origin') !== request.nextUrl.origin))) return reply({ error: 'Use the Research bench in Stimgraph.' }, 403);
  const active = await getActiveXSession(request);
  if (!active) return reply({ error: 'Connect X to save research cards or use research services.' }, 401);
  const respond = (data: unknown, status = 200) => withRenewedSession(reply(data, status), request, active.renewedCookie);
  const ownerId = active.session.profile.id;
  try {
    if (request.method === 'GET') return respond({ cards: await loadResearchCards(ownerId) });
    if (request.method === 'DELETE') {
      const id = request.nextUrl.searchParams.get('id');
      if (!id || id.length > 100) return respond({ error: 'Choose a saved card.' }, 400);
      const removed = await deleteResearchCard(ownerId, id);
      return respond(removed ? { deleted: true } : { error: 'Card not found.' }, removed ? 200 : 404);
    }
    let body: Record<string, unknown>;
    try {
      const raw = await request.text();
      if (raw.length > 40_000) return respond({ error: 'This research card is too large.' }, 413);
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      body = parsed;
    } catch { return respond({ error: 'The research request could not be read.' }, 400); }
    if (body.action === 'save') {
      const draft = parseResearchDraft(body.card);
      if (!draft) return respond({ error: 'Add a question and 2–8 different bookmark sources. Keep each list to five short entries.' }, 400);
      const current = await loadResearchSources(ownerId, draft.sources.map((source) => source.id));
      if (current.length !== draft.sources.length) return respond({ error: 'Choose sources from your own current bookmarks.' }, 404);
      let card;
      try { card = await saveResearchCard(ownerId, draft); }
      catch { return respond({ error: 'A source quotation could not be verified against your current bookmarks. Review the excerpts before saving.' }, 400); }
      return card ? respond({ card }, 201) : respond({ error: 'You have 100 saved research cards. Remove one before saving another.' }, 409);
    }
    if (body.consent !== true) return respond({ error: 'Choose the explicit Grok or Crossref action to continue.' }, 400);
    if (body.action === 'nearby') {
      if (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 250) return respond({ error: 'Write a search query of up to 250 characters.' }, 400);
      if (!await reserveResearchRequest(ownerId, 'nearby')) return respond({ error: 'Nearby-work searches are limited to one every two seconds and 30 per rolling day.' }, 429);
      try { return respond({ nearby: await searchNearbyWork(body.query.trim()) }); }
      catch { return respond({ error: 'Crossref could not complete this search. Previous results, if any, remain on your card.' }, 502); }
    }
    if (body.action !== 'generate' || !Object.hasOwn(researchLenses, String(body.lens)) || !['close', 'far'].includes(String(body.reach))
      || !Array.isArray(body.sourceIds) || body.sourceIds.length < 2 || body.sourceIds.length > 8
      || body.sourceIds.some((id) => typeof id !== 'string' || id.length > 250 || !/^bookmark:.+/.test(id))
      || new Set(body.sourceIds).size !== body.sourceIds.length) return respond({ error: 'Choose a research lens and 2–8 different bookmarks.' }, 400);
    const sourceIds = body.sourceIds as string[];
    const suppliedIntents = body.intents && typeof body.intents === 'object' ? body.intents as Record<string, unknown> : {};
    const intents: Record<string, SaveIntent> = {};
    for (const id of sourceIds) {
      const intent = suppliedIntents[id] ?? 'curious';
      if (!Object.hasOwn(saveIntents, String(intent))) return respond({ error: 'Choose a valid reason for saving each source.' }, 400);
      intents[id] = intent as SaveIntent;
    }
    const sources = await loadResearchSources(ownerId, sourceIds);
    if (sources.length !== sourceIds.length) return respond({ error: 'Choose sources from your own current bookmarks.' }, 404);
    const apiKey = getRuntimeValue('XAI_API_KEY');
    if (!apiKey) return respond({ error: 'Grok is not configured on this server. You can still write and save a card yourself.' }, 503);
    if (!await reserveResearchRequest(ownerId, 'generate')) return respond({ error: 'Research drafts are limited to one every 20 seconds and 12 per rolling day.' }, 429);
    try { return respond(await generateResearchCard(sources, intents, body.lens as ResearchLens, body.reach as ResearchReach, { apiKey })); }
    catch { return respond({ error: 'Grok could not produce a card with verified source quotations. Try other sources or write the card yourself.' }, 502); }
  } catch { return respond({ error: 'Research storage is unavailable right now. Keep this page open or export your draft.' }, 503); }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
