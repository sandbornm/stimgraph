import type { BookmarkForEnrichment } from '@/db/storage';
import { requireRuntimeValue } from './runtime-env';

type XaiResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export type XaiEnrichment = {
  items: Array<{
    post_id: string;
    topics: Array<{ label: string; reason: string; confidence: number }>;
  }>;
};

const enrichmentSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          post_id: { type: 'string', maxLength: 40 },
          topics: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                label: { type: 'string', maxLength: 48 },
                reason: { type: 'string', maxLength: 180 },
                confidence: { type: 'integer', minimum: 0, maximum: 100 },
              },
              required: ['label', 'reason', 'confidence'],
            },
          },
        },
        required: ['post_id', 'topics'],
      },
    },
  },
  required: ['items'],
} as const;

export async function enrichBookmarks(bookmarks: BookmarkForEnrichment[]) {
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
      max_output_tokens: 3_200,
      input: [
        {
          role: 'system',
          content: 'Classify saved X posts into concise, reusable topics. Stay grounded in the post text. Do not infer personal traits, identity, health, politics, religion, or other sensitive attributes about the bookmark owner. Prefer labels such as “Generative interfaces” over “Interesting”. Return every supplied post_id exactly once.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            posts: bookmarks.map((bookmark) => ({
              post_id: bookmark.postId,
              author: `@${bookmark.authorUsername}`,
              text: bookmark.text.length > 240 ? `${bookmark.text.slice(0, 239).trim()}…` : bookmark.text,
            })),
          }),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'stimgraph_bookmark_topics',
          strict: true,
          schema: enrichmentSchema,
        },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    throw new Error(`Grok enrichment failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as XaiResponse;
  const outputText = (typeof payload.output_text === 'string' && payload.output_text.trim()
    ? payload.output_text
    : payload.output
      ?.find((item) => item.type === 'message')
      ?.content?.find((content) => content.type === 'output_text')?.text) ?? '';
  if (!outputText) throw new Error('Grok returned no structured topic data.');

  let parsed: XaiEnrichment;
  try {
    parsed = JSON.parse(outputText) as XaiEnrichment;
  } catch {
    const start = outputText.indexOf('{');
    const end = outputText.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Grok returned no structured topic data.');
    parsed = JSON.parse(outputText.slice(start, end + 1)) as XaiEnrichment;
  }
  if (!Array.isArray(parsed.items)) throw new Error('Grok returned invalid topic data.');

  const inputTokens = payload.usage?.input_tokens ?? 0;
  const outputTokens = payload.usage?.output_tokens ?? 0;
  return {
    enrichment: parsed,
    usage: { inputTokens, outputTokens },
    estimatedCostUsd: (inputTokens * 2 + outputTokens * 6) / 1_000_000,
    zeroDataRetention: response.headers.get('x-zero-data-retention') === 'true',
  };
}
