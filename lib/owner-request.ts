import type { NextRequest } from 'next/server';
import { getD1 } from '@/db/index';
import { ensureSchema, loadXSessionRecord } from '@/db/storage';
import { X_SESSION_COOKIE } from './x-session';
import { getRuntimeValue } from './runtime-env';
import { trustedTailnetLogin } from './background-policy';

/** Owner from the browser session, or (tailnet mode) the configured Tailscale login on a single-owner DB. */
export async function resolveOwnerId(request: NextRequest): Promise<string | undefined> {
  await ensureSchema();
  const cookie = request.cookies.get(X_SESSION_COOKIE)?.value;
  if (cookie && !cookie.includes('.')) {
    const ownerId = (await loadXSessionRecord(cookie))?.ownerId;
    if (ownerId) return ownerId;
  }
  if (getRuntimeValue('STIMGRAPH_TAILNET') === 'true'
    && trustedTailnetLogin(request.headers, getRuntimeValue('STIMGRAPH_TAILNET_LOGIN'))) {
    // The personal service is deliberately single-owner. Ambiguity fails closed.
    const owners = await getD1().prepare(`SELECT id FROM accounts UNION SELECT owner_id AS id
      FROM x_sessions WHERE expires_at > ? LIMIT 2`).bind(Date.now()).all<{ id: string }>();
    if (owners.results.length === 1) return owners.results[0].id;
  }
  return undefined;
}
