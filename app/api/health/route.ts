import { getD1 } from '@/db/index';
import { ensureSchema } from '@/db/storage';
import { getRuntimeValue } from '@/lib/runtime-env';
import { xAuthConfigured } from '@/lib/x-auth-config';
import { POLL_INTERVAL_MS } from '@/lib/background-policy';

export const dynamic = 'force-dynamic';
export async function GET() {
  await ensureSchema();
  const heartbeat = await getD1().prepare('SELECT heartbeat_at AS heartbeatAt FROM background_health WHERE id = 1').first();
  const sessions = await getD1().prepare('SELECT COUNT(*) AS count FROM x_sessions WHERE expires_at > ?').bind(Date.now()).first<{ count: number }>();
  return Response.json({ ok: true, backgroundPolling: getRuntimeValue('STIMGRAPH_BACKGROUND_POLL') === 'true',
    pollIntervalHours: POLL_INTERVAL_MS / 3_600_000,
    configured: xAuthConfigured(getRuntimeValue),
    connectedAccounts: sessions?.count ?? 0, ...heartbeat }, { headers: { 'Cache-Control': 'private, no-store' } });
}
