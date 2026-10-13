# Private Mac deployment (always-on mode)

macOS only. Requires Tailscale, launchd, and (optionally) Keychain. The [README](../README.md) covers prerequisites, environment variables, and the security model; this file covers operating the service. Replace `<host>.<tailnet>.ts.net` with your machine's Tailscale HTTPS name. Create `.tailnet/service.json` (gitignored, non-secret) with `port`, `publicOrigin`, `tailnetLogin`, and optional `credentialSource: "keychain"`.

The local deployment uses a production Next.js Node server on `127.0.0.1:3001`, Tailscale Serve on private HTTPS port 443, and a per-user macOS LaunchAgent. Tailscale is installed separately. The project-authored `scripts/install-tailnet-service.mjs` writes one plist and loads it with `launchctl`; it does not install or configure Tailscale. The LaunchAgent executes `next start` directly. `.mjs` is Node's JavaScript module extension, not a separate installation system.

The Cloudflare/Vinext build remains available. Miniflare is used only for isolated tests. Local storage uses SQLite through an adapter for the application's existing D1 query interface, with WAL and transactional batches. Local mode requires Node 24.15+ (tested with 24.17). Node currently labels its `node:sqlite` API a release candidate. This is a personal, single-process deployment.

## Endpoint and behavior

- App: `https://<host>.<tailnet>.ts.net/`
- Health: `/api/health`; configuration state, connected-account count, and scheduler heartbeat, without credentials.
- Agent feed: `/api/activity?after=0&limit=100`.
- Local listener: `127.0.0.1:3001`, never a wildcard/LAN listener.
- Serve: private HTTPS reverse proxy to that listener; Funnel is not enabled.

Remote requests must have the configured Tailscale login. Serve supplies and sanitizes this identity header. Local processes on the host are trusted; loopback is not an isolation boundary between local users. Feed reads require either an owner session or the configured Tailscale identity on this single-owner deployment. Multiple stored owners cause identity-based access to fail closed. Tagged devices do not receive user-login headers and are denied; supporting them requires an explicit capability policy.

The scheduler wakes every minute to check whether work is due and polls X approximately every **six hours** (four scheduled polls per day). The first poll starts after connecting. It reads 20 bookmarks per page, at most five pages per account per poll, stops when it overlaps previously imported material, and persists continuation state for catch-up after restarts. On the first poll after upgrading, a **one-time backfill** instead pages 100 at a time through X's newest ~800 bookmarks without stopping at overlap, then records `bookmark_sync_state.backfill_completed_at` so it never reruns. Failures back off to 12 then 24 hours, respecting longer X retry/reset headers. A durable lease prevents overlapping polling. Browser and scheduler requests share token rotation; transient failures preserve the connection. Reading cached activity does not trigger a poll.

Connecting X enables background import in this deployment. Disconnect stops future polls; an already running request may finish. Deleting local data removes observations and sync state along with the existing graph, waiting for an active background import so it cannot recreate deleted bookmarks. Grok enrichment, scouting, and following import remain separate explicit actions. Polling incurs X API reads even without an open browser.

The connected browser checks local activity every 30 seconds and refreshes the graph when observations change, without starting a second X poller. Use the HTTPS URL so OAuth cookies and callbacks share an origin.

## Agent activity feed

From an allowed, untagged tailnet device:

```bash
curl --fail --silent --show-error \
  'https://<host>.<tailnet>.ts.net/api/activity?after=0&limit=100'
```

Process `events`, commit your processing result, then persist `nextCursor`. Fetch again with `after=<nextCursor>` until `hasMore` is false. Resume from that cursor on later runs. Use `sequence` as an idempotency key within this database. Replacing/deleting the database resets the feed; consumers must reset their cursor too.

Each `first_observed` event includes `sequence`, `postId`, `firstObservedAt` (Unix milliseconds), `postCreatedAt`, author, text, and URL. `sync` reports the last successful poll, next due poll, error category, and catch-up status. Reading the feed never calls X or returns X tokens.

This is an observation archive, not an exact bookmark event log. The first import is a baseline. Post creation time is not bookmark time. Saves removed before polling can be missed; removals and re-bookmarking an already observed post are not recorded. API availability/pagination limits also bound coverage. Do not infer “unbookmarked” from a missing item. Observed posts are retained until local data is deleted.

## Credentials and isolation

Preparation, tests, and the installed service do not read repository environment files. Credential loading is initially disabled. Do not grant a general exception to AGENTS.md merely to start the service.

For one Mac, Keychain is the simpler store. The optional `lib/local-credentials.ts` runtime loader resolves three fixed generic-password items. The operator creates these in Keychain Access under the account running the service:

| Item name / service | Account | Value |
| --- | --- | --- |
| `net.stimgraph.X_CLIENT_ID` | `stimgraph` | X OAuth client ID |
| `net.stimgraph.X_CLIENT_SECRET` | `stimgraph` | X OAuth client secret |
| `net.stimgraph.XAI_API_KEY` | `stimgraph` | Optional xAI key |

Provision these yourself; do not paste values into chat, commands, or plists. Missing/locked items leave the app unconfigured. A first access may need macOS approval. After provisioning, the operator sets `credentialSource` to `keychain` in the **non-secret** `.tailnet/service.json` and reloads the LaunchAgent. Values go directly into the application process environment, never command arguments or logs. The loader never opens `.env.local`.

The OAuth callback is derived from `publicOrigin`. Register exactly `https://<host>.<tailnet>.ts.net/api/auth/x/callback` in the X app, then open Stimgraph and connect X with the existing read scopes and `offline.access`. Live sync cannot be verified until credentials and OAuth are completed.

**Keychain under the same login is not strong isolation from local coding agents.** Allowing a generic program such as `/usr/bin/security` to retrieve an item does not restrict it to this app. An agent able to change service code can also change what that code does with credentials on restart.

For stronger protection, run under a dedicated macOS service account with a reviewed release outside the agent-writable checkout. Only that account should access credentials and database files. Agents should have no write access to deployed code/configuration or authority to restart/reconfigure the credential-bearing service; give them the read-only feed. A system LaunchDaemon with an explicit unprivileged `UserName` requires operator/admin setup when the service must run without a GUI login. The convenience installer creates a LaunchAgent for the current login; it does **not** create this stronger boundary or a new account.

SOPS with age is useful for encrypted Git configuration or deployment across hosts. A root `.sops.yaml` can contain non-secret creation rules and `secrets/stimgraph.enc.yaml` can contain ciphertext. Keep the private age identity outside the repository, readable only by the deployment identity, with a separate recovery copy. Do not keep it beside the ciphertext or automatically decrypt into an agent's shell/editor. An operator-controlled startup path can decrypt directly into the service environment. SOPS still requires runtime plaintext and does not protect against a process that can decrypt or modify the receiving code. SOPS has not been installed or configured here.

The SQLite database contains private bookmark text and browser session identifiers. X access/refresh tokens are encrypted using the X client secret. Protect the database and backups as well as that secret; losing/changing the secret requires reconnecting. Enable FileVault and maintain an operator-controlled state backup.

## Build and operate

Build the isolated source copy, which excludes secret paths before filesystem access:

```bash
node scripts/prepare-tailnet.mjs
cd .tailnet/source
corepack pnpm@10.17.1 install --frozen-lockfile --ignore-scripts
NEXT_TELEMETRY_DISABLED=1 STIMGRAPH_BACKGROUND_POLL=false \
  X_CLIENT_ID=stimgraph-inert-test X_CLIENT_SECRET=stimgraph-inert-test-secret \
  X_REDIRECT_URI=http://127.0.0.1:3012/api/auth/x/callback XAI_API_KEY= \
  NEXT_PUBLIC_SITE_URL=https://<host>.<tailnet>.ts.net \
  corepack pnpm@10.17.1 run build:local
```

The build needs neither a database nor real credentials. Inspect the source and generated plist before installation. From the repository root, `node scripts/install-tailnet-service.mjs` installs only `~/Library/LaunchAgents/net.stimgraph.tailnet.plist`. It reads `.tailnet/service.json` for non-secret `port`, `publicOrigin`, `tailnetLogin`, and optional `credentialSource`. Tailscale setup is separate:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:3001
tailscale serve status
```

On this Mac the service domain is `gui/501`:

```bash
# Stop before rebuilding the active source copy.
launchctl bootout gui/501/net.stimgraph.tailnet

# After review/build, reinstall/restart from the repository root.
node scripts/install-tailnet-service.mjs

# Stop only this HTTPS route if needed.
tailscale serve --https=443 off
```

The LaunchAgent starts at login and restarts after crashes. It stops at logout and cannot poll during sleep, shutdown, or network loss. No sleep setting was changed. Devices need a current Tailscale login and access to the host's TCP 443; expired device keys must be renewed. HTTPS was verified from the host, not every peer device.

The database is `.tailnet/state/stimgraph.sqlite`, with private permissions and WAL sidecars. Initial Miniflare/test state is separate and has no connected account. Back up after stopping the service, or use SQLite's online backup API; copying only the main file during WAL writes is unsafe. Logs are `.tailnet/service.log` and `.tailnet/service-error.log`; log rotation is not configured. The checkout and deployed source currently share a login. Separate the release before enabling credentials if local-agent isolation is required.

## Verification and official references

Tests use synthetic accounts, inert credentials, disposable databases, and mocked providers. Run in `.tailnet/source`:

```bash
corepack pnpm@10.17.1 test
corepack pnpm@10.17.1 run lint
corepack pnpm@10.17.1 exec tsc --noEmit
node scripts/test-local.mjs
```

The local integration test needs the Next.js production build and a free loopback port 3012. It tests startup polling without a browser, persistence/catch-up across restart, token refresh, access control, HTTPS cookies/origins, assets, and deletion. The separate `test-background.mjs` tests the Cloudflare build in Miniflare, including rate limits and concurrent refreshes.

- [Tailscale Serve and identity headers](https://tailscale.com/docs/features/tailscale-serve): loopback binding, private access, header sanitization, tagged devices.
- [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve): persistent `--bg` and stopping a port.
- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting) and [instrumentation](https://nextjs.org/docs/app/guides/instrumentation): production server, reverse proxy, startup hooks.
- [Apple launchd jobs](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html): plists and supervision.
- [Apple Keychain](https://developer.apple.com/documentation/security/using-the-keychain-to-manage-user-secrets) and [SOPS](https://github.com/getsops/sops): credential storage and access.
- [Node SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html): API and stability designation.
- [Cloudflare local development](https://developers.cloudflare.com/workers/local-development/): Miniflare's development/testing purpose.
