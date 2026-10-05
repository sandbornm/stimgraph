export function parseSearchQuery(query: string): { terms: string[]; phrase: string } {
  // Quoted groups stay together; ordinary words may match in different fields.
  const words = Array.from(query.matchAll(/"([^"]+)"|(\S+)/g), (match) => match[1] ?? match[2]);
  return { terms: [...new Set(words)], phrase: words.join(' ') };
}
