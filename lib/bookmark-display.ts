import { parseSearchQuery } from './search-query.ts';

export function bookmarkSnippet(text: string, query: string, limit = 210) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const { terms, phrase } = parseSearchQuery(query);
  const fold = (value: string) => value.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
  const haystack = fold(normalized);
  const needles = [phrase, ...terms].filter(Boolean).map(fold);
  const firstMatch = needles.map((needle) => haystack.indexOf(needle)).find((index) => index >= 0) ?? 0;
  let start = Math.max(0, firstMatch - 50);
  if (start) {
    const boundary = normalized.indexOf(' ', start);
    if (boundary >= start && boundary < firstMatch) start = boundary + 1;
  }
  const end = Math.min(normalized.length, start + limit);
  const excerpt = `${start ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
  const lower = fold(excerpt);
  const ranges: Array<[number, number]> = [];
  for (const needle of needles) {
    let at = lower.indexOf(needle);
    while (at >= 0) { ranges.push([at, at + needle.length]); at = lower.indexOf(needle, at + needle.length); }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && previous[1] >= range[0]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  return { text: excerpt, matches: merged };
}
