import { AGENT_GUIDE } from '@/lib/agent-guide';

export const dynamic = 'force-static';

export function GET() {
  return new Response(AGENT_GUIDE, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
