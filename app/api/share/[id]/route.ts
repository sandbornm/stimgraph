import { NextResponse } from 'next/server';
import { loadShare } from '@/db/storage';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id || id.length < 6 || id.length > 16) {
    return NextResponse.json({ error: 'Unknown share.' }, { status: 404 });
  }
  const share = await loadShare(id);
  if (!share) return NextResponse.json({ error: 'This link is expired or was never published.' }, { status: 404 });
  return NextResponse.json({
    id: share.id,
    name: share.capsule.name,
    capsule: share.capsule,
    createdAt: share.createdAt,
  });
}
