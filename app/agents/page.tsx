import Link from 'next/link';
import { AGENT_GUIDE } from '@/lib/agent-guide';

export const metadata = { title: 'Stimgraph · Agents', robots: { index: false } };

export default function AgentsPage() {
  return (
    <main className="agents-page">
      <pre>{AGENT_GUIDE}</pre>
      <p><a href="/llms.txt">llms.txt</a> · <a href="/api/agent/topics">topics</a> · <a href="/api/agent/bookmarks?limit=20">bookmarks</a> · <a href="/api/agent/export?format=md">export.md</a> · <Link href="/">back to Stimgraph</Link></p>
    </main>
  );
}
