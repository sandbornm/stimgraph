import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { agentDenied, agentHeaders, loadAgentRows, resolveAgentOwner } from '@/lib/agent-access';
import { clampLimit, filterRows, topicCounts } from '@/lib/bookmark-table';

export const dynamic = 'force-dynamic';

// GET /api/agent/bookmarks?q=&topic=a,b&author=&limit=&offset=
export async function GET(request: NextRequest) {
  const owner = await resolveAgentOwner(request);
  if (!owner) return agentDenied();
  const params = request.nextUrl.searchParams;
  const { rows, total } = await loadAgentRows(owner.ownerId);
  const filtered = filterRows(rows, {
    q: params.get('q') ?? '',
    topics: (params.get('topic') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    author: params.get('author') ?? '',
  });
  const limit = clampLimit(params.get('limit'), 50, 2000);
  const offset = Math.max(0, Math.floor(Number(params.get('offset')) || 0));
  return NextResponse.json({
    total, matched: filtered.length, offset, limit,
    topics: topicCounts(filtered).slice(0, 40),
    bookmarks: filtered.slice(offset, offset + limit),
  }, { headers: agentHeaders });
}
