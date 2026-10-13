# Stimgraph

**STIM = Stuff That Interests Me.** Stimgraph imports your X bookmarks into a private, local database and gives you a searchable table with topic chips, a graph/globe explorer, research tools, and a read-only link that AI agents can use to search and summarize your saves.

> **Disclaimer.** Not affiliated with, endorsed by, or sponsored by X Corp. X is a trademark of X Corp. Users must supply their own X API credentials and comply with the [X Developer Agreement and Policy](https://developer.x.com/en/developer-terms/agreement-and-policy).

> **License: TODO.** No license has been chosen yet. Until one is added, all rights are reserved and this repository is private.

Detailed feature behavior lives in [docs/FEATURES.md](docs/FEATURES.md). Operating the always-on Mac service: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Product direction and history: [docs/PRODUCT.md](docs/PRODUCT.md), [docs/LAUNCH.md](docs/LAUNCH.md), [docs/HANDOFF.md](docs/HANDOFF.md). Rules for coding agents: [AGENTS.md](AGENTS.md).

## Two ways to run it

| | Development mode | Always-on mode |
| --- | --- | --- |
| What it is | `pnpm dev` (Vite + Cloudflare Workers runtime via Miniflare) on `http://127.0.0.1:3001` | Production Next.js server on `127.0.0.1:3001`, published privately with Tailscale Serve, supervised by launchd |
| OS | macOS, Linux, Windows (anything Node and workerd support) | **macOS only** |
| Node | 22.13+ (`.nvmrc` pins 22) | **24.15+** (uses `node:sqlite`; tested on 24.17) |
| Storage | Local D1/SQLite under `.wrangler/` | `.tailnet/state/stimgraph.sqlite` |
| Credentials | `.env.local` | Keychain items (preferred) — see DEPLOYMENT.md |
| Bookmark import | When you press Sync, plus a visible tab checks the newest 15 every 90 s | Background poll every 6 h, plus a one-time backfill |
| Agent link | Requires your browser session | `https://<host>.<tailnet>.ts.net/agents` from your tailnet |

## Quick start (development mode)

Prerequisites:

1. **Node 22.13+** (`nvm use` reads `.nvmrc`) and **pnpm 10** (`corepack enable`; the version is pinned in `package.json`).
2. **Your own X developer app.** Create one in the [X Developer Console](https://console.x.com/). X API access is paid and its plans/pricing change; check the console before relying on it. Every bookmark sync, follow import, and background poll consumes X reads billed to *your* app.
   - Type: confidential **Web App, Automated App or Bot**. Permissions: **Read**.
   - OAuth 2.0 scopes requested by Stimgraph (exactly): `tweet.read users.read bookmark.read follows.read offline.access`. No write scopes.
   - Callback URL (must match `X_REDIRECT_URI` exactly):
     - Development: `http://127.0.0.1:3001/api/auth/x/callback`
     - Always-on: `https://<host>.<tailnet>.ts.net/api/auth/x/callback`
   - Website URL: any public page you own (it is only a label).
3. **Optional: an xAI API key** for Grok topic enrichment, scouting, bridges, and research drafts. Everything else works without it.

Then:

```bash
cp .env.example .env.local   # fill in values yourself; never commit or paste this file
pnpm install --ignore-scripts
pnpm dev                      # http://127.0.0.1:3001
```

Open the app and press **Connect X**. Before you connect, the app shows a built-in **demo collection** (labeled DEMO, fake accounts and posts) so you can try the interface; your data replaces it once connected in that browser.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `X_CLIENT_ID` | yes | — | OAuth 2.0 client ID of your X app |
| `X_CLIENT_SECRET` | yes | — | OAuth 2.0 client secret; also encrypts stored X tokens (changing it forces reconnect) |
| `X_REDIRECT_URI` | yes | — | Exact callback URL registered in the X app |
| `XAI_API_KEY` | no | empty (Grok features off) | xAI key for optional Grok features |
| `NEXT_PUBLIC_SITE_URL` | no | `http://127.0.0.1:3001` | Public URL for social metadata |
| `STIMGRAPH_TAILNET` | always-on | `false` | Enables Tailscale identity checks and HTTPS origin handling |
| `STIMGRAPH_TAILNET_LOGIN` | always-on | — | The one Tailscale login allowed to use the app remotely |
| `STIMGRAPH_PUBLIC_ORIGIN` | always-on | — | `https://<host>.<tailnet>.ts.net` |
| `STIMGRAPH_DATABASE` | always-on | — | Absolute path of the SQLite database |
| `STIMGRAPH_BACKGROUND_POLL` | no | `false` | `true` polls connected accounts every 6 h |
| `STIMGRAPH_CREDENTIAL_SOURCE` | no | `none` | `keychain` loads X/xAI credentials from macOS Keychain at startup |
| `STIMGRAPH_AGENT_API` | no | on | `off` disables tailnet (cookie-less) agent access |
| `STIMGRAPH_AGENT_LOGINS` | no | empty | Optional allowlist of Tailscale logins for the agent API. Empty means any login that passes the tailnet gate, which in always-on mode is only `STIMGRAPH_TAILNET_LOGIN` |

The always-on variables are written into the LaunchAgent by `scripts/install-tailnet-service.mjs` from `.tailnet/service.json`; you do not set them by hand. Secrets never go in the plist.

## Limits and expectations

- **X returns only your newest ~800 bookmarks.** Older saves cannot be imported through the API. If you have fewer, you get all of them (e.g. one account had 199).
- Always-on polling runs every **6 hours** (reads 20 per page, up to 5 pages, stops at the first already-stored post). The first poll after setup does a one-time **backfill** of up to 800 without stopping early.
- Polling cannot detect un-bookmarking, and post creation time is not bookmark time.
- Topic chips come from hashtags and Grok topics; posts without either get simple keyword chips (`kw-…`). There are no embeddings yet.
- Single owner: the app assumes one connected X account per database.

## Where data lives

- Bookmarks, topics, OAuth sessions (tokens encrypted with `X_CLIENT_SECRET`), trajectories, and research cards: the local database (see table above). Protect it and its backups; enable FileVault on the always-on Mac.
- The browser holds only an httpOnly session cookie (`stim_x_session`, 180 days) and UI preferences.
- Nothing is sent to xAI or Crossref unless you press the corresponding action; see the permission boundary below.

## Security model

- The server binds to **127.0.0.1** only, never a LAN interface.
- Always-on mode is reached through **Tailscale Serve** (private HTTPS; Funnel is not enabled). Serve sets and sanitizes the `Tailscale-User-Login` header, and the app trusts that header **only** because the listener is loopback-only; any local process on the Mac can impersonate it. Requests must carry the configured login; tagged devices are denied.
- The agent API is **read-only** and never returns tokens. It answers to the browser session, or (always-on mode only) to the configured Tailscale login on a `*.ts.net` host. Disable it with `STIMGRAPH_AGENT_API=off`.
- Keychain under the same macOS login is **not** isolation from local coding agents; see DEPLOYMENT.md for a stronger setup.
- Dependency install scripts are disabled (`--ignore-scripts`). Secret files are never read by tooling; see AGENTS.md.

## Permission boundary

Stimgraph requests these OAuth scopes:

- `bookmark.read` to read bookmarks when Sync is pressed.
- `follows.read` to read accounts you follow when Sync is pressed.
- `tweet.read` to read the saved post text.
- `users.read` to identify authors.
- `offline.access` to refresh the connection when the user requests a later sync.

It does not request write scopes and cannot post, like, follow, or change bookmarks. Development import starts on request; the opt-in private deployment in [DEPLOYMENT.md](docs/DEPLOYMENT.md) polls connected accounts in the background. If you connected before following import existed, reconnect so X can grant `follows.read`. In the [X Developer Console](https://console.x.com/), add `follows.read` to the app’s user-authentication scopes.

Grok enrichment is a separate action. Pressing it sends the next 40 bookmark texts and author handles to xAI; it never sends the X access token. Grok scout sends only topic labels and frequent author handles, then searches X. Requests use `store: false`. xAI documents a default 30-day abuse-monitoring retention period unless the API team has Zero Data Retention enabled, and says API inputs and outputs are not used for training without explicit permission. See [xAI API security](https://docs.x.ai/developers/faq/security) and [current pricing](https://docs.x.ai/developers/pricing).

The app exposes separate controls to disconnect the browser session or delete the locally stored graph. Withdrawing the X app’s account-level authorization is done in X account settings.

## Agent access (read-only)

Give an agent `https://<host>.<tailnet>.ts.net/agents` (or `/llms.txt`). JSON endpoints: `/api/agent/bookmarks?q=&topic=&author=&limit=`, `/api/agent/topics`, `/api/agent/export?format=md|json`. No MCP server or install is needed.

## Checks

```bash
pnpm run check        # typecheck + lint + unit tests
pnpm run build:local  # Next.js production build
```

CI (`.github/workflows/ci.yml`) runs `check` + build on Node 22, the local SQLite integration test on Node 24, and a gitleaks history scan. Builds and tests use inert credentials passed directly to the process, never `.env.local`. Integration tests (`scripts/test-local.mjs`, `scripts/test-background.mjs`) are described in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
