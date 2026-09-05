import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { deleteXSessionRecord } from '@/db/storage';
import { clearSessionCookie } from '@/lib/x-auth-server';
import { X_SESSION_COOKIE } from '@/lib/x-session';

export async function POST(request: NextRequest) {
  const cookie = request.cookies.get(X_SESSION_COOKIE)?.value;
  if (cookie && !cookie.includes('.')) await deleteXSessionRecord(cookie);
  const response = NextResponse.json({ disconnected: true });
  return clearSessionCookie(response, request);
}
