// Optional topic labeling with Jev (TypeSafe AI). Pure module: no app imports,
// so it can be unit-tested with a mocked fetch. Enabled only when TYPESAFE_API_KEY is set.
// API: https://docs.typesafe.ai/api.md

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-latest';
export const JEV_MIN_CONFIDENCE = 0.5;
export const JEV_CONCURRENCY = 4;
export const JEV_OTHER = 'other';
const MAX_OPTIONS = 255;
const MAX_STATE_CHARS = 4000; // well under the 32k state+question budget

/** Editable topic list: label -> short rubric description. `other` is always present. */
export type JevTopics = Record<string, string>;

export const DEFAULT_JEV_TOPICS: JevTopics = {
  agents: 'AI agents, autonomous tools, agent frameworks and workflows',
  openai: 'OpenAI, ChatGPT, GPT models and OpenAI products or news',
  claude: 'Anthropic, Claude models and Claude products or news',
  models: 'Other AI/ML models, research, benchmarks, training or evaluation',
  code: 'Programming, developer tools, software engineering, open source',
  security: 'Cybersecurity, vulnerabilities, privacy, attacks and defense',
  'crypto-payments': 'Crypto, blockchains, stablecoins, payments and fintech',
  design: 'Design, UI/UX, visual craft, creative tools and interfaces',
  startups: 'Startups, founders, fundraising, business strategy and markets',
  [JEV_OTHER]: 'None of the above fits well',
};

export function normalizeTopics(input: unknown): JevTopics {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Topics must be an object of label -> description.');
  const out: JevTopics = {};
  for (const [rawLabel, rawDescription] of Object.entries(input as Record<string, unknown>)) {
    const label = rawLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    if (!label) continue;
    out[label] = typeof rawDescription === 'string' ? rawDescription.trim().slice(0, 300) : '';
  }
  if (!out[JEV_OTHER]) out[JEV_OTHER] = DEFAULT_JEV_TOPICS[JEV_OTHER];
  if (Object.keys(out).length < 2) throw new Error('Provide at least one topic besides "other".');
  if (Object.keys(out).length > MAX_OPTIONS) throw new Error(`At most ${MAX_OPTIONS} topics.`);
  return out;
}

/** Stable fingerprint so posts are relabeled only when their text or the topic list changes. */
export async function fingerprint(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function topicsKey(topics: JevTopics) {
  return JSON.stringify(Object.keys(topics).sort().map((k) => [k, topics[k]]));
}

/** Why the owner saved a post. Fixed set so chips and the agent API stay stable. */
export const JEV_INTENTS = {
  try: 'A tool, library, product, technique or recipe to try out or use hands-on',
  read: 'An article, paper, thread or long-form piece to read or watch later',
  reference: 'Reference material to look up again: docs, data, cheat sheets, lists, how-tos',
  inspiration: 'Inspiration: ideas, design, craft, writing or vision worth remembering',
} as const;
export type JevIntent = keyof typeof JEV_INTENTS;
export const isJevIntent = (value: unknown): value is JevIntent => typeof value === 'string' && Object.hasOwn(JEV_INTENTS, value);

export const JEV_FRESHNESS = {
  actionable: 'Still useful to act on or come back to: evergreen tools, ideas, references or open opportunities',
  stale: 'Time-bound news, announcements, events, deadlines or hot takes that are likely outdated now',
} as const;

/** A secondary label, already thresholded: null when Jev was unsure or did not answer. */
export type JevSignal<T> = { value: T; confidence: number } | null;

export type JevAnswer = {
  label: string; confidence: number; probabilities: Record<string, number>; model: string;
  intent?: JevSignal<JevIntent>; stale?: JevSignal<boolean>;
};

export function buildRequest(text: string, author: string, topics: JevTopics) {
  return {
    model: JEV_MODEL,
    state: { author: `@${author}`, post: text.slice(0, MAX_STATE_CHARS) },
    questions: {
      topic: {
        type: 'choice',
        instructions: 'Which topic best describes this saved X post?',
        criteria: Object.fromEntries(Object.entries(topics).map(([k, v]) => [k, v || null])),
      },
      intent: {
        type: 'choice',
        instructions: 'Why did the owner most likely save this X post?',
        criteria: { ...JEV_INTENTS },
      },
      freshness: {
        type: 'choice',
        instructions: 'Is this saved X post still actionable, or is it time-bound news that has likely gone stale?',
        criteria: { ...JEV_FRESHNESS },
      },
    },
  };
}

type ChoiceAnswer = { choice?: string; confidence?: number; probabilities?: Record<string, number> };

/** Threshold a secondary Choice answer; below `threshold` (or invalid) it is stored as null. */
export function parseSignals(answers: { intent?: ChoiceAnswer; freshness?: ChoiceAnswer } | undefined, threshold = JEV_MIN_CONFIDENCE) {
  const conf = (a?: ChoiceAnswer) => Number(a?.confidence ?? 0);
  const intentAnswer = answers?.intent;
  const intent: JevSignal<JevIntent> = isJevIntent(intentAnswer?.choice) && conf(intentAnswer) >= threshold
    ? { value: intentAnswer.choice, confidence: conf(intentAnswer) } : null;
  const fresh = answers?.freshness;
  const stale: JevSignal<boolean> = (fresh?.choice === 'stale' || fresh?.choice === 'actionable') && conf(fresh) >= threshold
    ? { value: fresh.choice === 'stale', confidence: conf(fresh) } : null;
  return { intent, stale };
}

export class JevError extends Error {
  status: number;
  constructor(status: number, message = `Jev request failed (${status}).`) { super(message); this.status = status; }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** One Choice call. Retries 429/5xx with Retry-After or exponential backoff. Never logs the key. */
export async function labelPost({ apiKey, text, author, topics, fetchImpl = fetch, retries = 3, baseDelayMs = 1000 }: {
  apiKey: string; text: string; author: string; topics: JevTopics; fetchImpl?: FetchLike; retries?: number; baseDelayMs?: number;
}): Promise<JevAnswer> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(JEV_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequest(text, author, topics)),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) {
      const payload = await response.json() as { model?: string; answers?: { topic?: ChoiceAnswer; intent?: ChoiceAnswer; freshness?: ChoiceAnswer } };
      const answer = payload.answers?.topic;
      if (!answer?.choice || !(answer.choice in topics)) throw new JevError(502, 'Jev returned no valid topic.');
      return { label: answer.choice, confidence: Number(answer.confidence ?? 0), probabilities: answer.probabilities ?? {},
        model: payload.model ?? JEV_MODEL, ...parseSignals(payload.answers) };
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= retries) throw new JevError(response.status);
    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : baseDelayMs * 2 ** attempt);
  }
}

/** Low-confidence or "other" answers produce no Jev topic, so the keyword fallback applies. */
export function acceptedLabel(answer: Pick<JevAnswer, 'label' | 'confidence'>, threshold = JEV_MIN_CONFIDENCE) {
  return answer.label !== JEV_OTHER && answer.confidence >= threshold ? answer.label : null;
}

/** Run tasks with bounded concurrency; failures are collected, not thrown. */
export async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>) {
  const results: Array<{ item: T; value?: R; error?: unknown }> = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      try { results.push({ item, value: await run(item) }); } catch (error) { results.push({ item, error }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
