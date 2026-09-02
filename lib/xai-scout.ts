import { requireRuntimeValue } from './runtime-env';

export type ScoutContext = {
  topics: Array<{ id: string; label: string }>;
  authors: string[];
  knownPostIds: string[];
};

export type ScoutFind = {
  postId: string;
  authorUsername: string;
  authorName: string;
  text: string;
  url: string;
  topicId: string;
  topicLabel: string;
  reason: string;
  confidence: number;
};

type XaiResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  output_text?: string;
  citations?: string[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

const scoutSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    finds: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          post_id: { type: 'string', maxLength: 40 },
          author_username: { type: 'string', maxLength: 40 },
          author_name: { type: 'string', maxLength: 80 },
          text: { type: 'string', maxLength: 400 },
          url: { type: 'string', maxLength: 200 },
          topic_label: { type: 'string', maxLength: 48 },
          reason: { type: 'string', maxLength: 180 },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
        },
        required: [
          'post_id',
          'author_username',
          'author_name',
          'text',
          'url',
          'topic_label',
          'reason',
          'confidence',
        ],
      },
    },
  },
  required: ['finds'],
} as const;

function extractJsonObject(text: string): { finds?: Array<Record<string, unknown>> } {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as { finds?: Array<Record<string, unknown>> };
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Grok returned no structured scout data.');
    return JSON.parse(trimmed.slice(start, end + 1)) as { finds?: Array<Record<string, unknown>> };
  }
}

function outputText(payload: XaiResponse) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  return payload.output
    ?.find((item) => item.type === 'message')
    ?.content?.find((content) => content.type === 'output_text')?.text ?? '';
}

function statusIdFromUrl(url: string) {
  const match = url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/i);
  return match?.[1] ?? '';
}

function topicId(label: string) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
}

export async function scoutNewContent(context: ScoutContext) {
  const allowedTopics = context.topics.slice(0, 10);
  const allowedLabels = allowedTopics.map((topic) => topic.label);
  const known = new Set(context.knownPostIds);
  const since = new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString().slice(0, 10);

  const response = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireRuntimeValue('XAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'grok-4.6',
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 16_000,
      tools: [{ type: 'x_search', from_date: since }],
      input: [
        {
          role: 'system',
          content: 'Scout X for posts that belong on an existing interest map. Search once, then return JSON. Stay grounded in the posts you find. Do not infer personal traits about the map owner. Skip ads, engagement bait, and known post_ids. topic_label must be copied from the supplied topic list. Return 6 to 8 finds.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            topics: allowedLabels,
            frequent_authors: context.authors.slice(0, 8),
            known_post_ids: context.knownPostIds.slice(0, 40),
            window: `since ${since}`,
          }),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'stimgraph_scout_finds',
          strict: true,
          schema: scoutSchema,
        },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    throw new Error(`Grok scout failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as XaiResponse;
  const parsed = extractJsonObject(outputText(payload));
  if (!Array.isArray(parsed.finds)) throw new Error('Grok returned invalid scout data.');

  const topicByLabel = new Map(allowedTopics.map((topic) => [topic.label.toLowerCase(), topic]));
  const finds: ScoutFind[] = [];
  for (const item of parsed.finds) {
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    const postId = (typeof item.post_id === 'string' ? item.post_id.trim() : '') || statusIdFromUrl(url);
    if (!postId || known.has(postId) || finds.some((find) => find.postId === postId)) continue;
    const rawLabel = typeof item.topic_label === 'string' ? item.topic_label.trim() : '';
    const matched = topicByLabel.get(rawLabel.toLowerCase()) ?? allowedTopics[0];
    if (!matched) continue;
    const authorUsername = (typeof item.author_username === 'string' ? item.author_username : 'unknown')
      .replace(/^@/, '')
      .slice(0, 40);
    finds.push({
      postId: postId.slice(0, 40),
      authorUsername: authorUsername || 'unknown',
      authorName: (typeof item.author_name === 'string' ? item.author_name : authorUsername).slice(0, 80),
      text: (typeof item.text === 'string' ? item.text : '').slice(0, 400),
      url: url || `https://x.com/${authorUsername}/status/${postId}`,
      topicId: matched.id || topicId(matched.label),
      topicLabel: matched.label,
      reason: (typeof item.reason === 'string' ? item.reason : 'Fits an existing thread.').slice(0, 180),
      confidence: Math.max(0, Math.min(100, Math.round(Number(item.confidence) || 70))),
    });
  }

  const inputTokens = payload.usage?.input_tokens ?? 0;
  const outputTokens = payload.usage?.output_tokens ?? 0;
  return {
    finds: finds.slice(0, 8),
    usage: { inputTokens, outputTokens },
    estimatedCostUsd: (inputTokens * 2 + outputTokens * 6) / 1_000_000,
    zeroDataRetention: response.headers.get('x-zero-data-retention') === 'true',
  };
}
