export type FeedLink = {
  url: string;
  type: 'rss' | 'atom' | 'json' | 'xml';
  title: string;
};

export type FeedProbe = {
  host: string;
  pageUrl: string;
  feeds: FeedLink[];
  status: 'found' | 'none' | 'error';
  error?: string;
  probedAt: number;
};

export const DEMO_RSS_ORIGINS = [
  'https://simonwillison.net',
  'https://overreacted.io',
  'https://css-tricks.com',
  'https://www.theverge.com',
  'https://www.w3.org',
  'https://news.ycombinator.com',
] as const;

const SKIP_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
  't.co',
  'mobile.twitter.com',
]);

const FEED_PATHS = ['/feed', '/rss.xml', '/atom.xml', '/index.xml', '/rss', '/feed.xml', '/atom'];

function classifyType(value: string): FeedLink['type'] {
  const lower = value.toLowerCase();
  if (lower.includes('atom')) return 'atom';
  if (lower.includes('json')) return 'json';
  if (lower.includes('rss')) return 'rss';
  return 'xml';
}

export function hostFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (SKIP_HOSTS.has(host) || host.endsWith('.t.co')) return null;
    return host;
  } catch {
    return null;
  }
}

export function originFromHost(host: string) {
  return `https://${host}`;
}

export function urlsFromBookmark(entities: unknown, text: string): string[] {
  const found: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== 'string' || !value.startsWith('http')) return;
    found.push(value);
  };
  if (entities && typeof entities === 'object') {
    const urls = (entities as { urls?: Array<{ expanded_url?: string; unwound_url?: string; url?: string }> }).urls;
    urls?.forEach((item) => {
      push(item.unwound_url);
      push(item.expanded_url);
      push(item.url);
    });
  }
  const matches = text.match(/https?:\/\/[^\s<>)"']+/g) ?? [];
  matches.forEach(push);
  return found;
}

function resolveUrl(href: string, base: string) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function extractLinkTags(html: string, base: string): FeedLink[] {
  const feeds: FeedLink[] = [];
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const rel = tag.match(/\brel=["']([^"']+)["']/i)?.[1] ?? '';
    const type = tag.match(/\btype=["']([^"']+)["']/i)?.[1] ?? '';
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const title = tag.match(/\btitle=["']([^"']+)["']/i)?.[1] ?? '';
    if (!href || !/\balternate\b/i.test(rel)) continue;
    if (!/rss|atom|xml|json/i.test(type) && !/rss|atom|xml|json/i.test(href)) continue;
    const url = resolveUrl(href, base);
    if (!url) continue;
    feeds.push({ url, type: classifyType(type || href), title: title.slice(0, 80) });
  }
  return feeds;
}

function looksLikeFeed(contentType: string, body: string) {
  const type = contentType.toLowerCase();
  if (/(rss|atom|xml)/.test(type) && !type.includes('html')) return true;
  const start = body.slice(0, 400).toLowerCase();
  return start.includes('<rss') || start.includes('<feed') || start.includes('<rdf:rdf');
}

async function fetchText(url: string, timeoutMs: number) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      Accept: 'text/html, application/xhtml+xml, application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
      'User-Agent': 'Stimgraph/0.1 (RSS probe)',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const buffer = await response.arrayBuffer();
  const slice = buffer.byteLength > 400_000 ? buffer.slice(0, 400_000) : buffer;
  const body = new TextDecoder('utf-8', { fatal: false }).decode(slice);
  return { ok: response.ok, status: response.status, url: response.url, contentType, body };
}

export async function probeOrigin(origin: string): Promise<FeedProbe> {
  const host = hostFromUrl(origin) ?? origin.replace(/^https?:\/\//, '').split('/')[0];
  const pageUrl = originFromHost(host);
  const probedAt = Date.now();
  try {
    const page = await fetchText(pageUrl, 7000);
    if (page.ok && looksLikeFeed(page.contentType, page.body)) {
      return {
        host,
        pageUrl: page.url || pageUrl,
        feeds: [{ url: page.url || pageUrl, type: classifyType(page.contentType), title: host }],
        status: 'found',
        probedAt,
      };
    }
    const fromHtml = page.ok ? extractLinkTags(page.body, page.url || pageUrl) : [];
    const unique = new Map<string, FeedLink>();
    fromHtml.forEach((feed) => unique.set(feed.url, feed));
    if (unique.size === 0) {
      for (const path of FEED_PATHS) {
        if (unique.size > 0) break;
        try {
          const candidate = await fetchText(`${pageUrl}${path}`, 5000);
          if (candidate.ok && looksLikeFeed(candidate.contentType, candidate.body)) {
            unique.set(candidate.url || `${pageUrl}${path}`, {
              url: candidate.url || `${pageUrl}${path}`,
              type: classifyType(candidate.contentType || path),
              title: host,
            });
          }
        } catch {
          // Common paths are guesses; a miss is not a probe failure.
        }
      }
    }
    const feeds = [...unique.values()].slice(0, 6);
    return {
      host,
      pageUrl: page.url || pageUrl,
      feeds,
      status: feeds.length > 0 ? 'found' : 'none',
      probedAt,
    };
  } catch (error) {
    return {
      host,
      pageUrl,
      feeds: [],
      status: 'error',
      error: error instanceof Error ? error.message : 'Probe failed.',
      probedAt,
    };
  }
}

export async function probeOrigins(origins: string[], onEach?: (probe: FeedProbe) => void) {
  const unique = [...new Set(
    origins
      .map((origin) => hostFromUrl(origin) ?? hostFromUrl(`https://${origin}`))
      .filter((host): host is string => Boolean(host)),
  )].map(originFromHost);
  const results: FeedProbe[] = [];
  const queue = unique.slice(0, 24);
  const workers = 4;
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      const probe = await probeOrigin(queue[index]);
      results.push(probe);
      onEach?.(probe);
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, () => worker()));
  return results;
}
