import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadBookmarksForEnrichment, storeAiTopics } from '@/db/storage';
import { getRuntimeValue } from '@/lib/runtime-env';
import { getActiveXSession, withRenewedSession } from '@/lib/x-auth-server';
import { enrichBookmarks } from '@/lib/xai-enrich';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const active = await getActiveXSession(request);
  if (!active) return NextResponse.json({ error: 'Connect X before using Grok.' }, { status: 401 });
  if (!getRuntimeValue('XAI_API_KEY')) {
    return NextResponse.json({ error: 'Grok is not configured on this server.' }, { status: 503 });
  }

  let requestedLimit = 40;
  try {
    const body = (await request.json()) as { limit?: number };
    if (typeof body.limit === 'number') requestedLimit = body.limit;
  } catch {
    // The visible consent action uses the conservative default.
  }
  const limit = Math.max(1, Math.min(40, Math.floor(requestedLimit)));
  const bookmarks = await loadBookmarksForEnrichment(active.session.profile.id, limit);
  if (bookmarks.length === 0) {
    return withRenewedSession(
      NextResponse.json({ analyzed: 0, topics: 0, message: 'No new bookmarks need enrichment.' }),
      active.renewedCookie,
    );
  }

  try {
    const result = await enrichBookmarks(bookmarks);
    const allowedPostIds = new Set(bookmarks.map((bookmark) => bookmark.postId));
    const assignments = result.enrichment.items
      .filter((item) => allowedPostIds.has(item.post_id) && Array.isArray(item.topics))
      .map((item) => ({
        postId: item.post_id,
        topics: item.topics.slice(0, 4),
      }));
    const topics = await storeAiTopics(active.session.profile.id, assignments);
    return withRenewedSession(NextResponse.json({
      analyzed: assignments.length,
      topics,
      estimatedCostUsd: Number(result.estimatedCostUsd.toFixed(4)),
      zeroDataRetention: result.zeroDataRetention,
    }), active.renewedCookie);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Grok enrichment failed.';
    return withRenewedSession(NextResponse.json({ error: message }, { status: 502 }), active.renewedCookie);
  }
}
