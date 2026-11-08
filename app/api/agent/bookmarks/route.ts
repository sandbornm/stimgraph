import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadBookmarkLibrary } from '@/db/bookmark-library';
import { agentDenied, agentHeaders, resolveAgentOwner } from '@/lib/agent-access';
import { parseLibraryQuery } from '@/lib/bookmark-library';
import { keywordTopics } from '@/lib/bookmark-table';

export const dynamic = 'force-dynamic';

// GET /api/agent/bookmarks?q=&topic=a,b&author=&sort=&limit=&offset=
export async function GET(request: NextRequest) {
  const owner = await resolveAgentOwner(request);
  if (!owner) return agentDenied();
  const query = parseLibraryQuery(request.nextUrl.searchParams);
  const page = await loadBookmarkLibrary(owner.ownerId, query);
  return NextResponse.json({
    total: page.total,
    matched: page.matched,
    offset: page.offset,
    limit: page.limit,
    nextOffset: page.nextOffset,
    sort: page.sort,
    topics: page.topics,
    bookmarks: keywordTopics(page.bookmarks),
  }, { headers: agentHeaders });
}
