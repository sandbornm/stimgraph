import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadBookmarkTable, loadSoleAccountId } from '@/db/storage';
import { getActiveXSession } from './x-auth-server';
import { getRuntimeValue } from './runtime-env';
import { tailnetAgentAllowed } from './agent-gate';
import { keywordTopics, type TableRow } from './bookmark-table';

/**
 * Who may read through /api/agent/*:
 *  1. A browser that already holds the X session cookie (the UI).
 *  2. A tailnet caller: Tailscale Serve sets `Tailscale-User-Login` on proxied
 *     requests and the Host is the *.ts.net name. If STIMGRAPH_AGENT_LOGINS is set
 *     (comma-separated logins), the caller must be on that list.
 *     Path 2 applies only when STIMGRAPH_TAILNET=true; set STIMGRAPH_AGENT_API=off to disable it.
 * Responses are read-only and never contain tokens, cookies or secrets.
 */
export async function resolveAgentOwner(request: NextRequest): Promise<{ ownerId: string; via: 'session' | 'tailnet' } | null> {
  const active = await getActiveXSession(request);
  if (active) return { ownerId: active.session.profile.id, via: 'session' };
  if (!tailnetAgentAllowed(request.headers, { tailnet: getRuntimeValue('STIMGRAPH_TAILNET'),
    agentApi: getRuntimeValue('STIMGRAPH_AGENT_API'), logins: getRuntimeValue('STIMGRAPH_AGENT_LOGINS') })) return null;
  const ownerId = await loadSoleAccountId();
  return ownerId ? { ownerId, via: 'tailnet' } : null;
}

export function agentDenied() {
  return NextResponse.json(
    { error: 'Not authorized. Open Stimgraph through its Tailscale URL (tailnet identity) or connect X in the browser.', docs: '/agents' },
    { status: 401, headers: { 'cache-control': 'no-store' } },
  );
}

export async function loadAgentRows(ownerId: string): Promise<{ rows: TableRow[]; total: number }> {
  const data = await loadBookmarkTable(ownerId);
  const topicsByPost = new Map<string, TableRow['topics']>();
  for (const t of data.topics) {
    const list = topicsByPost.get(t.post_id) ?? [];
    if (list.length < 4 && !list.some((x) => x.id === t.topic_id)) list.push({ id: t.topic_id, label: t.label });
    topicsByPost.set(t.post_id, list);
  }
  const rows = data.bookmarks.map((b) => ({
    id: b.post_id,
    author: b.author_name,
    handle: b.author_username,
    text: b.text,
    createdAt: b.created_at ?? null,
    url: `https://x.com/${b.author_username}/status/${b.post_id}`,
    topics: topicsByPost.get(b.post_id) ?? [],
  }));
  return { rows: keywordTopics(rows), total: data.total };
}

export const agentHeaders = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
