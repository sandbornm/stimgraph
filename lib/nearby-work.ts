import type { NearbyCheck, NearbyWork } from './research-model.ts';

export async function searchNearbyWork(query: string, fetcher: typeof fetch = fetch): Promise<NearbyCheck> {
  const url = new URL('https://api.crossref.org/works');
  url.search = new URLSearchParams({ 'query.bibliographic': query, rows: '5', select: 'DOI,title,author,published' }).toString();
  const response = await fetcher(url, { headers: { Accept: 'application/json', 'User-Agent': 'Stimgraph/0.1 (research metadata lookup)' }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('Crossref is unavailable right now. No literature check was completed.');
  const payload = await response.json() as { message?: { items?: unknown[] } };
  if (!Array.isArray(payload.message?.items)) throw new Error('Crossref returned unreadable results. No literature check was completed.');
  const works: NearbyWork[] = [];
  for (const raw of payload.message.items.slice(0, 5)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as { DOI?: unknown; title?: unknown; author?: Array<{ given?: string; family?: string }>; published?: { 'date-parts'?: number[][] } };
    if (typeof item.DOI !== 'string' || item.DOI.length > 250 || !/^10\.\d{4,9}\/\S+$/.test(item.DOI) || !Array.isArray(item.title) || typeof item.title[0] !== 'string') continue;
    const year = item.published?.['date-parts']?.[0]?.[0];
    const title = item.title[0].replace(/<[^>]*>/g, '').trim().slice(0, 1000);
    if (!title) continue;
    works.push({ doi: item.DOI, title, year: Number.isInteger(year) && year! >= 1000 && year! <= 3000 ? year! : null,
      authors: Array.isArray(item.author) ? item.author.slice(0, 3).filter((author) => author && typeof author === 'object').map((author) => [author.given, author.family].filter((part) => typeof part === 'string').join(' ')).filter(Boolean).join(', ').slice(0, 500) : '' });
  }
  return { provider: 'Crossref', query, works, checkedAt: Date.now() };
}
