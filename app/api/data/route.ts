import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { deleteOwnerDataUnlocked, loadOwnerXSessionPayloads, loadXSessionOwnerId } from '@/db/storage';
import { deleteAccountRequestAllowed } from '@/lib/delete-account';
import { deleteUnconfiguredAccount, revokeAndDeleteOwner } from '@/lib/owner-revoke-delete';
import { withOwnerWork } from '@/lib/owner-work';
import { requestOrigin } from '@/lib/request-origin';
import { getRuntimeValue } from '@/lib/runtime-env';
import { readSessionCookie } from '@/lib/session-cookie';
import { revokeXSession } from '@/lib/x-api';
import { xAuthConfigured, xClientCredentialsConfigured } from '@/lib/x-auth-config';
import { clearSessionCookie, getActiveXSession } from '@/lib/x-auth-server';
import { openXSession } from '@/lib/x-session';

const noStore = { 'Cache-Control': 'private, no-store' };

export async function DELETE(request: NextRequest) {
  let confirm: unknown;
  let force = false;
  try {
    const body = await request.json() as { confirm?: unknown; force?: unknown };
    confirm = body.confirm;
    force = body.force === true;
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
  if (!xAuthConfigured(getRuntimeValue)) {
    const cookieValue = readSessionCookie(request.cookies).value;
    const ownerIdFromRow = cookieValue && !cookieValue.includes('.')
      ? await loadXSessionOwnerId(cookieValue)
      : null;
    const outcome = await deleteUnconfiguredAccount({
      clientCredentials: xClientCredentialsConfigured(getRuntimeValue),
      cookieValue,
      ownerIdFromRow,
      force,
      withLock: withOwnerWork,
      loadPayloads: loadOwnerXSessionPayloads,
      openPayload: async (payload) => (await openXSession(payload))?.session ?? null,
      revoke: revokeXSession,
      deleteData: deleteOwnerDataUnlocked,
    });
    if (!outcome.deleted) {
      if (outcome.status === 502) {
        return NextResponse.json({
          error: outcome.error,
          revoked: false,
          retryable: true,
        }, { status: 502, headers: noStore });
      }
      return NextResponse.json({ error: outcome.error }, { status: outcome.status, headers: noStore });
    }
    if (outcome.revokeSkipped) {
      return clearSessionCookie(NextResponse.json({
        deleted: true,
        revoked: false,
        revokeSkipped: 'not_configured',
      }, { headers: noStore }), request);
    }
    return clearSessionCookie(NextResponse.json({
      deleted: true,
      revoked: outcome.revoked,
    }, { headers: noStore }), request);
  }
  const active = await getActiveXSession(request);
  if (!active) return NextResponse.json({ error: 'Connect X first.' }, { status: 401, headers: noStore });
  const outcome = await revokeAndDeleteOwner({
    ownerId: active.session.profile.id,
    current: active.session,
    force,
    withLock: withOwnerWork,
    loadPayloads: loadOwnerXSessionPayloads,
    openPayload: async (payload) => (await openXSession(payload))?.session ?? null,
    revoke: revokeXSession,
    deleteData: deleteOwnerDataUnlocked,
  });
  if (!outcome.deleted) {
    return NextResponse.json({
      error: outcome.error,
      revoked: false,
      retryable: true,
    }, { status: 502, headers: noStore });
  }
  return clearSessionCookie(NextResponse.json({
    deleted: true,
    revoked: outcome.revoked,
  }, { headers: noStore }), request);
}
