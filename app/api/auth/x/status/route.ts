import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requestOrigin } from '@/lib/request-origin';
import { readSessionCookie, sessionCookieSecure } from '@/lib/session-cookie';
import { getActiveXSession, withRenewedSession } from '@/lib/x-auth-server';
import { getRuntimeValue } from '@/lib/runtime-env';
import { xAuthConfigured } from '@/lib/x-auth-config';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const configured = xAuthConfigured(getRuntimeValue);
  const backgroundPolling = getRuntimeValue('STIMGRAPH_BACKGROUND_POLL') === 'true';
  const active = await getActiveXSession(request);
  const response = NextResponse.json(active ? {
    connected: true,
    configured,
    backgroundPolling,
    profile: active.session.profile,
    expiresAt: active.session.expiresAt,
  } : { connected: false, configured, backgroundPolling });
  const presented = readSessionCookie(request.cookies, sessionCookieSecure(requestOrigin(request)));
  if (active || presented?.includes('.')) return withRenewedSession(response, request, active?.renewedCookie);
  return response;
}
