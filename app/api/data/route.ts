import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { deleteOwnerData } from '@/db/storage';
import { clearSessionCookie, getActiveXSession } from '@/lib/x-auth-server';
import { requestOrigin } from '@/lib/request-origin';

export async function DELETE(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== requestOrigin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const active = await getActiveXSession(request);
  if (!active) return NextResponse.json({ error: 'Connect X first.' }, { status: 401 });
  await deleteOwnerData(active.session.profile.id);
  return clearSessionCookie(NextResponse.json({ deleted: true }, { headers: { 'Cache-Control': 'private, no-store' } }), request);
}
