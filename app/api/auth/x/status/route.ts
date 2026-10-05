import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getActiveXSession, withRenewedSession } from '@/lib/x-auth-server';
import { getRuntimeValue } from '@/lib/runtime-env';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const missingConfiguration = ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_REDIRECT_URI'].filter((name) => !getRuntimeValue(name));
  const configured = missingConfiguration.length === 0;
  const active = await getActiveXSession(request);
  if (!active) return NextResponse.json({ connected: false, configured, missingConfiguration }, { headers: { 'Cache-Control': 'private, no-store' } });

  return withRenewedSession(NextResponse.json({
    connected: true,
    configured,
    profile: active.session.profile,
    expiresAt: active.session.expiresAt,
  }, { headers: { 'Cache-Control': 'private, no-store' } }), request, active.renewedCookie);
}
