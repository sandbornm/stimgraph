import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { countSharesSince, saveShare } from '@/db/storage';
import { newShareId, parseCapsule } from '@/lib/capsule';
import { getRuntimeValue } from '@/lib/runtime-env';
import { getActiveXSession, withRenewedSession } from '@/lib/x-auth-server';

export const dynamic = 'force-dynamic';

const SHARE_OWNER_DAILY = 20;
const SHARE_DEMO_DAILY = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

function clientIp(request: NextRequest) {
  return request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';
}

export async function POST(request: NextRequest) {
  const active = await getActiveXSession(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Send a neighborhood JSON body.' }, { status: 400 });
  }
  const capsule = parseCapsule((body as { capsule?: unknown }).capsule ?? body);
  if (!capsule) return NextResponse.json({ error: 'This is not a shareable Stimgraph neighborhood.' }, { status: 400 });

  const ownerId = active?.session.profile.id ?? `demo:${clientIp(request)}`;
  const cap = active ? SHARE_OWNER_DAILY : SHARE_DEMO_DAILY;
  const used = await countSharesSince(ownerId, Date.now() - DAY_MS);
  if (used >= cap) {
    return NextResponse.json(
      { error: `Share limit reached (${cap} links per day). Export a file instead.` },
      { status: 429 },
    );
  }

  const id = newShareId();
  await saveShare(id, ownerId, capsule);
  const site = getRuntimeValue('NEXT_PUBLIC_SITE_URL') ?? request.nextUrl.origin;
  const url = `${site.replace(/\/$/, '')}/s/${id}`;
  const response = NextResponse.json({ id, url, name: capsule.name, nodes: capsule.nodes.length });
  return active ? withRenewedSession(response, active.renewedCookie) : response;
}
