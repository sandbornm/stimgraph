import { X_DISCLAIMER } from './legal';
export const AGENT_GUIDE = `# Stimgraph — agent guide

Read-only access to one person's saved X bookmarks, with topics. Tailnet only.

## Endpoints (GET, JSON unless noted)
- /api/agent/bookmarks?q=&topic=&author=&limit=50&offset=0
  - q: space-separated words, all must match text/author/topics
  - topic: topic id or label; comma-separate to require several
  - author: X handle, with or without @
  - returns { total, matched, offset, limit, topics[], bookmarks[] }
  - bookmark: { id, author, handle, text, createdAt, url, topics[{id,label}] }
- /api/agent/topics -> { total, topics[{ id, label, count }] }
- /api/agent/export?format=md|json&q=&topic= -> Markdown table or JSON

## Access
Requests must arrive through the Tailscale Serve URL (tailnet identity) or a browser
with the Stimgraph session. No writes, no tokens, no secrets are exposed.

## When to use this vs. live X access
This is a local, persistent copy of the owner's bookmarks with topics. Querying it is free
and does not call the X API. Prefer it for "what have I saved about..." questions. Use your
own X access (public reads, or a signed-in X plugin if you have one) for live or public
lookups. Stimgraph imports with the owner's own X developer app and never posts.

## Tips
Start with /api/agent/topics, then filter bookmarks by topic. Topics prefixed "kw-"
are keyword clusters for posts that have no AI/hashtag topic yet.

## Disclaimer
${X_DISCLAIMER}
`;
