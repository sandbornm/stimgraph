import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { deleteXSessionRecord } from '@/db/storage';
import { readSessionCookie } from '@/lib/session-cookie';
import { clearSessionCookie } from '@/lib/x-auth-server';

export async function POST(request: NextRequest) {
  const cookie = readSessionCookie(request.cookies).value;
  if (cookie && !cookie.includes('.')) await deleteXSessionRecord(cookie);
  const response = NextResponse.json({ disconnected: true });
  return clearSessionCookie(response, request);
}
