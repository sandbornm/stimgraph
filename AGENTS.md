# Repository instructions

## Secret handling

- Treat `.env.local`, `.env`, and every `.env.*` file except `.env.example` as secret.
- Never read, print, search, parse, source, interpolate, summarize, copy, upload, or pass those files to a tool.
- Never include secret values in commands, logs, patches, tests, screenshots, browser actions, or chat messages.
- Use `.env.example` to learn variable names. Ask the user to edit secret files themselves.
- Tests and builds must use inert test values supplied directly to the process when needed. They must not inspect local secret files.
- Keep dependency lifecycle scripts disabled. Review a package before allowing any install script.

## Code Review Rules

Report actionable regressions introduced by the change. For each finding, identify
the affected code, the triggering scenario, the consequence, and a safe correction.
Point to an existing test or suggest a focused regression check when useful. State
assumptions and checks you could not run. Avoid speculative redesigns and style-only
findings; the rules below supplement ordinary correctness and security review.

### Private access and read-only agents

The server's trust in Tailscale identity headers depends on a loopback-only
listener behind Tailscale Serve. Flag changes that expose it publicly, accept
untrusted forwarded identity, bypass the configured owner/agent allowlists, or
choose an arbitrary owner from an ambiguous database. Keep `/api/agent/*`
read-only, owner-scoped, uncached, and free of tokens and cookies. Preserve X's
read-only OAuth scopes. See `lib/agent-access.ts`, `lib/owner-request.ts`, and
`docs/DEPLOYMENT.md`.

### Optional external calls and bounded polling

Keep Grok enrichment, scouting, and research behind their explicit actions. Do not
make ordinary browsing or agent queries trigger X reads or model calls. Configured
background polling and configured Jev labeling after sync are intentional
exceptions. Preserve polling leases, backoff, page/backfill bounds, and Jev's
content/topic cache so retries or restarts do not repeatedly bill for the same
work. Never send OAuth credentials with bookmark text to a model provider.

### Bookmark history and demo separation

Preserve owner IDs and stored bookmark history across syncs and migrations. X's
limited newest-bookmark window is not a complete account snapshot: an absent post
does not prove it was unsaved, and post creation time is not bookmark time. Keep
DEMO records visibly separate from imported data; do not let demo fallbacks mask
an authentication or database failure as a successful private-data response.
