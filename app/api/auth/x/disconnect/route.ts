import { NextResponse } from 'next/server';
import { X_SESSION_COOKIE } from '@/lib/x-session';

export async function POST() {
  const response = NextResponse.json({ disconnected: true });
  response.cookies.delete(X_SESSION_COOKIE);
  return response;
}
