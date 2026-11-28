import type { NextRequest } from 'next/server';
import { getD1 } from '@/db/index';
import { ensureSchema, loadXSessionRecord } from '@/db/storage';
import { requestOrigin } from './request-origin';
import { readSessionCookie, sessionCookieSecure } from './session-cookie';
import { getRuntimeValue } from './runtime-env';
import { trustedTailnetLogin } from './background-policy';
import { uniqueOwnerId } from './unique-owner-id';

export async function resolveOwnerId(request: NextRequest): Promise<string | undefined> {
  await ensureSchema();
  const cookie = readSessionCookie(request.cookies, sessionCookieSecure(requestOrigin(request)));
  if (cookie && !cookie.includes('.')) {
    const ownerId = (await loadXSessionRecord(cookie))?.ownerId;
    if (ownerId) return ownerId;
  }
  if (getRuntimeValue('STIMGRAPH_TAILNET') === 'true'
    && trustedTailnetLogin(request.headers, getRuntimeValue('STIMGRAPH_TAILNET_LOGIN'))) {
    const owners = await getD1().prepare(`SELECT id FROM accounts UNION SELECT owner_id AS id
      FROM x_sessions WHERE expires_at > ? LIMIT 2`).bind(Date.now()).all<{ id: string }>();
    return uniqueOwnerId(owners.results);
  }
  return undefined;
}
