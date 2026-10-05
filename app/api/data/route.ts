import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { deleteOwnerData } from '@/db/storage';
import { clearSessionCookie, getActiveXSession } from '@/lib/x-auth-server';

export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest) {
  const reply = (data: unknown, status = 200) => NextResponse.json(data, {
    status, headers: { 'Cache-Control': 'private, no-store' },
  });
  if (request.headers.get('sec-fetch-site') === 'cross-site'
    || (request.headers.get('origin') && request.headers.get('origin') !== request.nextUrl.origin)) {
    return reply({ error: 'Use the local-data controls in Stimgraph.' }, 403);
  }
  try {
    const active = await getActiveXSession(request);
    if (!active) return reply({ error: 'Connect X before deleting your local data.' }, 401);
    await deleteOwnerData(active.session.profile.id);
    return clearSessionCookie(reply({ deleted: true }), request);
  } catch {
    return reply({ error: 'Your local data could not be deleted. Try again.' }, 503);
  }
}
