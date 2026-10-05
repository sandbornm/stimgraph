import type { LibraryBookmark } from './bookmark-library.ts';
import { parseSearchQuery } from './search-query.ts';

type SearchField = 'text' | 'authorUsername' | 'authorName' | 'topics';
type MatchKind = 'exact' | 'prefix' | 'contains';
type Signal = { exact: string; prefix: string; contains: string; weight: number };

// The same rules drive SQL ranking and the demo. Saved text carries more weight
// than incidental substrings in metadata; exact author/topic lookups stay useful.
const fields: Array<{ field: SearchField; sql: string; weights: Record<MatchKind, number> }> = [
  { field: 'text', sql: 'b.text', weights: { exact: 120, prefix: 100, contains: 80 } },
  { field: 'authorUsername', sql: 'b.author_username', weights: { exact: 120, prefix: 60, contains: 20 } },
  { field: 'authorName', sql: 'b.author_name', weights: { exact: 110, prefix: 60, contains: 20 } },
  { field: 'topics', sql: 't.label', weights: { exact: 100, prefix: 50, contains: 30 } },
];
const kinds: MatchKind[] = ['exact', 'prefix', 'contains'];

function pattern(value: string, weight = 1): Signal {
  const literal = value.replace(/[\\%_]/g, '\\$&');
  return { exact: literal, prefix: `${literal}%`, contains: `%${literal}%`, weight };
}

function fieldMatch(field: typeof fields[number], patternSql: string) {
  const match = `${field.sql} LIKE ${patternSql} ESCAPE '\\'`;
  return field.field === 'topics' ? `EXISTS (
    SELECT 1 FROM bookmark_topics bt JOIN topics t ON t.owner_id = bt.owner_id AND t.id = bt.topic_id
    WHERE bt.owner_id = b.owner_id AND bt.post_id = b.post_id AND ${match})` : match;
}

export function bookmarkSearchFilter(query: string) {
  const { terms } = parseSearchQuery(query);
  return {
    sql: `NOT EXISTS (SELECT 1 FROM json_each(?) term WHERE NOT (${fields.map((field) => fieldMatch(field, 'term.value')).join(' OR ')}))`,
    values: [JSON.stringify(terms.map((term) => pattern(term).contains))],
  };
}

export function bookmarkSearchRank(query: string) {
  const { terms, phrase } = parseSearchQuery(query);
  if (!terms.length) return { sql: '0', values: [] as string[] };
  const rankedSignals = terms.map((term) => pattern(term));
  // Keep repeated words in the phrase even though matching deduplicates terms.
  if (phrase !== terms[0]) rankedSignals.push(pattern(phrase, terms.length * 2));
  // JSON keeps the bind count fixed even for long, many-word queries. Rank the
  // whole matching collection in SQL before applying the page limit.
  // Highest score first lets SQLite stop as soon as a rule matches, avoiding
  // lower-value metadata lookups for a strong text match.
  const rules = fields.flatMap((field) => kinds.map((kind) => ({
    sql: fieldMatch(field, `json_extract(term.value, '$.${kind}')`), weight: field.weights[kind],
  }))).sort((a, b) => b.weight - a.weight);
  const score = `CASE ${rules.map((rule) => `WHEN ${rule.sql} THEN ${rule.weight}`).join(' ')} ELSE 0 END`;
  return {
    sql: `(SELECT COALESCE(SUM((${score}) * json_extract(term.value, '$.weight')), 0) FROM json_each(?) term)`,
    values: [JSON.stringify(rankedSignals)],
  };
}

// SQLite LIKE folds ASCII case. Match that behavior in the demo as well.
function fold(value: string) { return value.replace(/[A-Z]+/g, (letters) => letters.toLowerCase()); }

export function prepareBookmarkSearch(query: string): (item: LibraryBookmark) => number | null {
  const parsed = parseSearchQuery(query);
  const terms = parsed.terms.map(fold), phrase = fold(parsed.phrase);
  if (!terms.length) return () => 0;
  return (item) => {
    const values = fields.map(({ field, weights }) => ({
      weights, values: (field === 'topics' ? item.topics.map((topic) => topic.label) : [item[field]]).map(fold),
    }));
    const score = (needle: string) => {
      let best = 0;
      for (const field of values) for (const value of field.values) {
        const weight = value === needle ? field.weights.exact : value.startsWith(needle) ? field.weights.prefix : value.includes(needle) ? field.weights.contains : 0;
        if (weight > best) best = weight;
      }
      return best;
    };
    let total = 0;
    for (const term of terms) {
      const match = score(term);
      if (!match) return null;
      total += match;
    }
    return total + (phrase !== terms[0] ? score(phrase) * terms.length * 2 : 0);
  };
}
