import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadScoutContext, storeScouts } from '@/db/storage';
import { getRuntimeValue } from '@/lib/runtime-env';
import { getActiveXSession, withRenewedSession } from '@/lib/x-auth-server';
import { scoutNewContent } from '@/lib/xai-scout';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const active = await getActiveXSession(request);
  if (!active) return NextResponse.json({ error: 'Connect X before scouting.' }, { status: 401 });
  if (!getRuntimeValue('XAI_API_KEY')) {
    return NextResponse.json({ error: 'Grok is not configured on this server.' }, { status: 503 });
  }

  const context = await loadScoutContext(active.session.profile.id);
  if (context.topics.length === 0) {
    return withRenewedSession(NextResponse.json({
      found: 0,
      message: 'Analyze bookmarks with Grok so topics exist, then scout.',
    }), active.renewedCookie);
  }

  try {
    const result = await scoutNewContent(context);
    const stored = await storeScouts(active.session.profile.id, result.finds);
    return withRenewedSession(NextResponse.json({
      found: stored,
      finds: result.finds,
      estimatedCostUsd: Number(result.estimatedCostUsd.toFixed(4)),
      zeroDataRetention: result.zeroDataRetention,
    }), active.renewedCookie);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Grok scout failed.';
    return withRenewedSession(NextResponse.json({ error: message }, { status: 502 }), active.renewedCookie);
  }
}
