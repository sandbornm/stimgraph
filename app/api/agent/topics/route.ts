import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { agentDenied, agentHeaders, loadAgentRows, resolveAgentOwner } from '@/lib/agent-access';
import { topicCounts } from '@/lib/bookmark-table';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const owner = await resolveAgentOwner(request);
  if (!owner) return agentDenied();
  const { rows, total } = await loadAgentRows(owner.ownerId);
  return NextResponse.json({ total, topics: topicCounts(rows) }, { headers: agentHeaders });
}
