import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { openXSession, X_SESSION_COOKIE } from '@/lib/x-session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const encrypted = request.cookies.get(X_SESSION_COOKIE)?.value;
  if (!encrypted) return NextResponse.json({ connected: false });
  const session = await openXSession(encrypted);
  if (!session) return NextResponse.json({ connected: false });

  return NextResponse.json({
    connected: true,
    profile: session.profile,
    expiresAt: session.expiresAt,
  });
}
