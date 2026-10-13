import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getActiveXSession, withRenewedSession } from '@/lib/x-auth-server';
import { getRuntimeValue } from '@/lib/runtime-env';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const configured = ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_REDIRECT_URI'].every((name) => Boolean(getRuntimeValue(name)));
  const backgroundPolling = getRuntimeValue('STIMGRAPH_BACKGROUND_POLL') === 'true';
  const active = await getActiveXSession(request);
  if (!active) return NextResponse.json({ connected: false, configured, backgroundPolling });

  return withRenewedSession(NextResponse.json({
    connected: true,
    configured,
    backgroundPolling,
    profile: active.session.profile,
    expiresAt: active.session.expiresAt,
  }), request, active.renewedCookie);
}
