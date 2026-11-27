import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { deleteXSessionRecord, loadXSessionPayload } from '@/db/storage';
import { disconnectPresentedSession } from '@/lib/disconnect-session';
import { withOwnerWork } from '@/lib/owner-work';
import { readSessionCookie } from '@/lib/session-cookie';
import { revokeXSession } from '@/lib/x-api';
import { clearSessionCookie } from '@/lib/x-auth-server';
import { openXSession } from '@/lib/x-session';

export async function POST(request: NextRequest) {
  const cookie = readSessionCookie(request.cookies).value;
  await disconnectPresentedSession({
    cookieValue: cookie,
    withLock: withOwnerWork,
    loadRow: loadXSessionPayload,
    openPayload: async (payload) => (await openXSession(payload))?.session ?? null,
    revoke: revokeXSession,
    deleteRow: deleteXSessionRecord,
  });
  const response = NextResponse.json({ disconnected: true });
  return clearSessionCookie(response, request);
}
