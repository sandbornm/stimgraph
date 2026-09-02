import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadFeeds, loadLinkHosts, loadRecentFeedHosts, storeFeed } from '@/db/storage';
import { DEMO_RSS_ORIGINS, originFromHost, probeOrigin, type FeedProbe } from '@/lib/rss-probe';
import { getActiveXSession, withRenewedSession } from '@/lib/x-auth-server';

export const dynamic = 'force-dynamic';

type ProbeEvent = {
  type: 'host' | 'done' | 'error';
  host?: string;
  status?: string;
  feedCount?: number;
  feeds?: FeedProbe['feeds'];
  title?: string;
  pageUrl?: string;
  error?: string;
  probed?: number;
  found?: number;
  remaining?: number;
};

export async function GET(request: NextRequest) {
  const active = await getActiveXSession(request);
  if (!active) return NextResponse.json({ feeds: [], demo: true });
  const feeds = await loadFeeds(active.session.profile.id);
  return withRenewedSession(NextResponse.json({ feeds, demo: false }), active.renewedCookie);
}

const MAX_RSS_HOSTS = 12;
const RSS_REPROBE_MS = 30 * 60 * 1000;

export async function POST(request: NextRequest) {
  const active = await getActiveXSession(request);
  let hosts: string[] = [];
  if (active) {
    hosts = await loadLinkHosts(active.session.profile.id, MAX_RSS_HOSTS);
    const recent = await loadRecentFeedHosts(active.session.profile.id, Date.now() - RSS_REPROBE_MS);
    hosts = hosts.filter((host) => !recent.has(host));
  }
  if (hosts.length === 0 && !active) {
    hosts = [...DEMO_RSS_ORIGINS].map((origin) => origin.replace(/^https?:\/\//, ''));
  }
  hosts = hosts.slice(0, MAX_RSS_HOSTS);

  const encoder = new TextEncoder();
  const ownerId = active?.session.profile.id;
  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: ProbeEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        let found = 0;
        for (let index = 0; index < hosts.length; index += 1) {
          const origin = hosts[index].startsWith('http') ? hosts[index] : originFromHost(hosts[index]);
          const probe = await probeOrigin(origin);
          if (ownerId) await storeFeed(ownerId, probe);
          if (probe.status === 'found') found += 1;
          send({
            type: 'host',
            host: probe.host,
            status: probe.status,
            feedCount: probe.feeds.length,
            feeds: probe.feeds,
            title: probe.feeds[0]?.title || probe.host,
            pageUrl: probe.pageUrl,
            error: probe.error,
            probed: index + 1,
            remaining: hosts.length - index - 1,
          });
        }
        send({ type: 'done', probed: hosts.length, found });
      } catch (error) {
        send({ type: 'error', error: error instanceof Error ? error.message : 'RSS probe failed.' });
      } finally {
        controller.close();
      }
    },
  });

  const response = new NextResponse(readable, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
  return active ? withRenewedSession(response, active.renewedCookie) : response;
}
