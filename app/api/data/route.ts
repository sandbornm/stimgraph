import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { deleteOwnerData, loadOwnerXSessionPayloads } from '@/db/storage';
import { deleteAccountRequestAllowed } from '@/lib/delete-account';
import { requestOrigin } from '@/lib/request-origin';
import { revokeXSession } from '@/lib/x-api';
import { clearSessionCookie, getActiveXSession } from '@/lib/x-auth-server';
import { openXSession, type XSession } from '@/lib/x-session';

const noStore = { 'Cache-Control': 'private, no-store' };

async function revokeOwnerSessions(ownerId: string, current: XSession) {
  const payloads = await loadOwnerXSessionPayloads(ownerId);
  const sessions = [current];
  for (const payload of payloads) {
    const opened = await openXSession(payload);
    if (opened) sessions.push(opened.session);
  }
  const seen = new Set<string>();
  for (const session of sessions) {
    const mark = `${session.refreshToken ?? ''}\n${session.accessToken}`;
    if (seen.has(mark)) continue;
    seen.add(mark);
    await revokeXSession(session);
  }
}

export async function DELETE(request: NextRequest) {
  let confirm: unknown;
  try {
    confirm = ((await request.json()) as { confirm?: unknown }).confirm;
  } catch {
    confirm = undefined;
  }
  if (!deleteAccountRequestAllowed({
    origin: request.headers.get('origin'),
    requestOrigin: requestOrigin(request),
    secFetchSite: request.headers.get('sec-fetch-site'),
    confirm,
  })) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: noStore });
  }
  const active = await getActiveXSession(request);
  if (!active) return NextResponse.json({ error: 'Connect X first.' }, { status: 401, headers: noStore });
  await revokeOwnerSessions(active.session.profile.id, active.session);
  await deleteOwnerData(active.session.profile.id);
  return clearSessionCookie(NextResponse.json({ deleted: true }, { headers: noStore }), request);
}
