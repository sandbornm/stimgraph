import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { agentDenied, agentHeaders, loadAgentRows, resolveAgentOwner } from '@/lib/agent-access';
import { filterRows, rowsToMarkdown } from '@/lib/bookmark-table';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const owner = await resolveAgentOwner(request);
  if (!owner) return agentDenied();
  const params = request.nextUrl.searchParams;
  const { rows } = await loadAgentRows(owner.ownerId);
  const filtered = filterRows(rows, {
    q: params.get('q') ?? '',
    topics: (params.get('topic') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    author: params.get('author') ?? '',
  });
  if (params.get('format') === 'json') return NextResponse.json({ bookmarks: filtered }, { headers: agentHeaders });
  return new NextResponse(rowsToMarkdown(filtered), { headers: { ...agentHeaders, 'content-type': 'text/markdown; charset=utf-8' } });
}
