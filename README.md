# Stimgraph

Stimgraph helps you explore saved material, connect ideas, and develop research questions grounded in your sources. It starts with a private graph of your X bookmarks. **STIM** means **Stuff That Interests Me**.

The map shows each saved post as a small particle near its author and topics. Solid lines trace direct bookmark evidence. Dotted lines show authors or topics that overlap across saved posts; those lines do not change the source ranking. Cyan diamonds are Grok scout finds: posts on X that fit the map but are not bookmarks yet.

**Bookmarks** is the default view and opens the full imported library, beyond the map's smaller working set. Search saved text, authors, or topic names; open **Filter & sort** to narrow by a topic or **Without topics**, or sort by import time or post publication date. Read the saved text in place, open the original, or choose **Explore connections** to bring that source and its recorded author/topic links onto the map. Search and filters remain in place when you return from Explore.

Library searches default to **Best match**. Every word must occur somewhere in the saved text, author, or topics, in any order; use quotes to keep a phrase together. Original phrase matches receive a boost, and exact author/topic lookups rank above incidental metadata substrings. Results are ranked across the whole matching collection before pagination, with import and publication dates breaking ties. Explicit date sorts remain available. This is local text matching with no provider calls, embeddings, or QMD dependency.

Results stay visible while you type, with an updating message until the next search finishes. Cards show and highlight a matching passage, including matches later in a long post. Loading another page and changing filters do not wait for the typing debounce. Returning from Explore reuses the loaded library; a sync refreshes it. Research panels load their saved records when opened.

The main navigation has just **Bookmarks**, **Explore**, and **Tools**. Tools holds the other views, research workspace, X connection and data settings, map appearance, and keyboard help. Research controls stay closed until requested, and successful sync notices clear automatically.

**Sync** checks up to 600 bookmarks at a time. When X provides another page, **Continue import** resumes from that page during the current tab session. A failed import keeps completed pages and reports partial progress; a reload starts a fresh check. **Review new bookmarks** shows items added during this session's manual imports. Resyncing existing posts preserves their import timestamps, so newly imported old posts can surface first. Historical timestamps from before this change reflect their last earlier sync; X does not provide the time you originally bookmarked a post. The map prioritizes recently imported sources too.

Explore opens with a flat branching view. Start with a topic or bookmark, then follow its connections and preview one step beyond. Expand **Layout & keyboard controls** to choose LR (left to right) or TB (top to bottom). In LR, ↑/↓ chooses a branch, → follows it, and ← goes back. In TB, ←/→ chooses, ↓ follows, and ↑ goes back. The arrow pad uses the same controls. Open the reader for full saved text, supporting posts, and related ideas; sharing and graph tools are under More actions. Open **Tools → Research workspace** for trajectories, bridges, and the research bench.

Forward branches exclude items already on the current trail. A branch ends when all its connections lead back; the trail and Back controls still let you revisit earlier items. The trail, orientation, and visited markers last for the current session. New connections append to the current branch list when the graph updates. Globe keeps the original rotating view.

The explorer builds each branch from existing graph edges. A saved post can belong to several topics; branches are routes through that graph, not a fixed topic hierarchy. Each link explains whether it comes from a saved post, overlapping bookmark patterns, or following an account. Scout suggestions are optional and labeled separately. Exploring does not make additional AI requests.

**Concept trajectories** turn a route into something you can return to. Follow a few steps, choose **Shape this path**, and add a name and a question or notes. The outline shows the concepts along the path and the relationship behind each step. **Still worth a look** surfaces nearby saved posts you have not visited this session. Choosing one branches from its actual connection on the path.

Connected accounts save trajectories privately in the app database; there is no public trajectory URL. Each save creates a separate version, so resuming or branching never overwrites an earlier path. Missing nodes and connections remain visible in saved outlines, and resuming uses only the connected portion of the current map. Demo/shared collections keep trajectories for the current page session. **Export outline .md** downloads route labels and your notes, without full saved-post text. Deleting the local map also deletes its saved trajectories.

**Bridge A → B** connects two concepts in the loaded map. Up to three routes are shown, with a shared saved post behind every concept hop. Routes are limited to six hops and can be opened as trajectories. The finder excludes author/following shortcuts and affinity-only links; a topic assignment is evidence of how the collection is organized, not proof that one idea follows from another.

**Ask Grok** is an explicit, optional bridge action. It sends concept labels and at most 24 excerpts of 400 characters each to xAI, using opaque references in place of source IDs and excluding account profiles and X credentials. Grok chooses a supplied route and explains its steps. The server checks route and hop references. If the loaded collection has no supported route, Grok may suggest an unverified research direction; those suggestions never become graph edges automatically. The request uses no search tools and `store: false`, with a 60-second timeout. Each account gets at most one request per 20 seconds and 12 per rolling 24 hours; failed provider attempts also count. Only request IDs and timestamps are retained for this limit, and stale records are removed when that account next requests a bridge. Optional xAI retention policies still apply.

**Research bench** turns selected bookmarks into a research candidate. Choose 2–8 sources and a lens: transfer a method, find a tension, find a shared problem, change a constraint, or find missing evidence. Stay close suggests posts with overlapping topics; Reach further suggests less overlap. These are starting sets, not novelty scores. Open each source to record why you saved it, including disagreement.

Write a card yourself, or explicitly choose **Draft with Grok**. The card separates a question, method, problem, proposed connection, assumptions, counterexamples, and a smallest investigation from source quotations. Generated quotations are checked against the supplied excerpts; the interpretation still needs review. Grok receives only the selected redacted excerpts (at most eight × 800 characters) and save-intent annotations, using opaque references. Links and handles are redacted, but identifying details can remain in prose. It receives no X credentials and has no search tools. Requests use `store: false`, a 60-second timeout, and a separate limit of one every 20 seconds and 12 per rolling day.

**Search nearby work · Crossref** sends only the editable, user-reviewed query to Crossref's public metadata API. The card keeps up to five titles, authors, publication years, DOI links, the actual query, and its completion time. This is a limited bibliographic search, not a full literature review or proof of novelty. Empty results say so explicitly. Failed searches preserve the previous record. Searches are limited to one every two seconds and 30 per rolling day; external attempts count even when a provider fails. No account identity, source text, or X credentials accompany the query. [Crossref public access](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/).

Research cards save privately as separate versions (up to 100 per account). Demo/shared mode keeps cards only for the current page session and uses manual drafting. Export includes your notes and selected quotations; cards are excluded from map shares. Deleting local data deletes the cards and research request counters. Missing source material stays visible in saved cards; a new save checks source ownership and quotations against current bookmarks. The app does not turn generated hypotheses into graph edges or start a research agent automatically.

Email-based app identity is a separate launch step. The current prototype still uses the connected X account as the data owner. See [LAUNCH.md](LAUNCH.md) for the proposed email-login and X-connection model; it has not been enabled or deployed.

Connect X once. The handshake and tokens live in the local database; the browser only keeps a small httpOnly cookie (`stim_x_session`) for 180 days. You should not need to reconnect on every refresh or dev-server restart. Disconnect, deleting local data, or revoking the app in X will clear it.

The map is a graph: you at the pole, people and topics around you, saved posts near authors. Solid lines are bookmark evidence. Short dashes are topic/author overlap. Longer dotted hairlines are accounts you follow. Search with `/` or ⌘K; `@` people, `#` topics, `~` following, `:` commands.

Optional live watch checks the newest 15 bookmarks while the tab is visible, starting at 90-second intervals and backing off when nothing changes. New saves flash on the field. Use Sync after time away to check beyond that small window. **Sync bookmarks and following** in Permissions also refreshes the accounts you follow; the toolbar's Sync only imports bookmarks. Followed accounts appear as quieter people on the globe, and bookmark authors you already follow are marked. Grok scout is a separate action: it searches X with `x_search` against your top topics, frequent authors, and followed accounts. Optionally keep scouting every 12 minutes while the tab stays open.

You can drag, zoom, select, search, filter by signal type, or jump to a random node. The interaction direction credits [Kat ⊷ the Poet Engineer’s gestural latent-space work](https://x.com/poetengineer__/status/1821654144958202077); the visual design and implementation here are original.

Select any node to grow a two-step neighborhood around it. Neighborhoods export as `.stimgraph` files that contain people, topics, and connection weights. They exclude saved-post nodes and bookmark text. Importing someone else’s neighborhood places both graphs in one field; matching people and topics become shared bridge nodes.

The Tune panel changes particle density, the minimum visible connection strength, motion, labels, and color. It can hide dotted affinity links or the on-screen guide. Quiet, Balanced, and Charged presets provide useful starting points. These preferences stay in the browser on the current device.

## Local setup

Use Node 24 and pnpm 10.33.0 to match CI. `.nvmrc` and `.node-version` pin the Node major version; Node 22.13 or newer remains supported by the app.

To try the app without credentials:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm demo
```

Open `http://127.0.0.1:3001`. The demo runs a temporary source copy with a fresh local database and excludes local credential files. It is removed when you stop the process. Use `pnpm demo 3013` if port 3001 is occupied. Restart the demo to pick up source edits; use `pnpm dev` below to work with your real collection.

To connect your own X account:

1. In the [X Developer Console](https://console.x.com/), configure the app as a confidential **Web App, Automated App or Bot**.
2. Leave app permissions on **Read**.
3. Set the callback URL to `http://127.0.0.1:3001/api/auth/x/callback`.
4. Set the website URL to `http://127.0.0.1:3001`.
5. Put the credentials in `.env.local`, following `.env.example`. Never commit or paste that file into chat.
   Restrict its permissions with `chmod 600 .env.local`. Git ignores local environment files. The Vite configuration declares the server secret names so the local Cloudflare Worker receives credentials loaded by Vinext; none are client-side defines. Restart the dev server after editing credentials. If login is not configured, the app reports missing variable names without their values.
6. Install and run:

   ```bash
   pnpm install --frozen-lockfile --ignore-scripts
   pnpm dev
   ```

Then open `http://127.0.0.1:3001`.

Required server credentials:

- `X_CLIENT_ID`: the OAuth 2.0 client ID for the X app.
- `X_CLIENT_SECRET`: the OAuth 2.0 client secret for the X app.
- `X_REDIRECT_URI`: exactly `http://127.0.0.1:3001/api/auth/x/callback` for local development.

Optional: `XAI_API_KEY`, a dedicated xAI API key for topic enrichment, Grok scout, bridges, and research drafts. Bookmark sync works without it.

On a second laptop, you can manually transfer the same `.env.local` through a private channel. Keep the same local URL and callback port, restrict file permissions, install dependencies, and run `pnpm dev`. The file does not contain your local database, login session, trajectories, or research cards. Connect X and sync again for bookmarks; research records stay on the original machine unless separately exported.

For Grok-assisted curation, create a key in the xAI Console using the [official API quickstart](https://docs.x.ai/developers/quickstart), add `XAI_API_KEY` yourself, and restart `pnpm dev`. Start with **Tools → Organize with Grok** to name topics for the next 40 saves. Filter the library by those topics, then use **Tools → Research workspace → Research bench** to choose 2–8 sources and ask for a draft. **Tools → Scout** finds additional posts when you want new material. Each provider action requires its own click; opening these tools makes no Grok request.

`NEXT_PUBLIC_SITE_URL` is non-secret and defaults to `http://127.0.0.1:3001` for social metadata.

## Continuous integration

GitHub Actions runs the model/provider tests, ESLint, TypeScript, the production build, and API checks against isolated D1 on pull requests and pushes to `main`. It uses Node 24, pnpm 10.33.0, the frozen lockfile, disabled dependency lifecycle scripts, and inert credentials. No X, xAI, or Cloudflare secrets are needed for CI; it does not sync bookmarks or deploy the app. A filename-only check rejects tracked local credential files before dependencies are installed.

Each CI run also adds a synthetic search benchmark to its job summary. It uses the same SQL statement builder as the API and reports warm p50/p95 timings over 5,000 bookmarks, including search, author lookup, empty results, and later pages. These are SQLite comparison measurements, not production D1 latency or pass/fail time budgets on shared runners. A test checks that recent-import browsing uses its index without a temporary sort.

Local verification must use a clean source copy without local environment files, with inert values supplied directly to the process. Do not run builds against the configured workspace's secret files.

## Permission boundary

Stimgraph requests these OAuth scopes:

- `bookmark.read` to read bookmarks when Sync is pressed.
- `follows.read` to read accounts you follow when Sync is pressed.
- `tweet.read` to read the saved post text.
- `users.read` to identify authors.
- `offline.access` to refresh the connection when the user requests a later sync.

It does not request write scopes and cannot post, like, follow, or change bookmarks. Import never starts automatically. If you connected before following import existed, reconnect so X can grant `follows.read`. In the [X Developer Console](https://console.x.com/), add `follows.read` to the app’s user-authentication scopes.

Grok enrichment is a separate action. Pressing it sends the next 40 bookmark texts and author handles to xAI; it never sends the X access token. Grok scout sends only topic labels and frequent author handles, then searches X. Requests use `store: false`. xAI documents a default 30-day abuse-monitoring retention period unless the API team has Zero Data Retention enabled, and says API inputs and outputs are not used for training without explicit permission. See [xAI API security](https://docs.x.ai/developers/faq/security) and [current pricing](https://docs.x.ai/developers/pricing).

The app exposes separate controls to disconnect the browser session or delete the locally stored graph. Withdrawing the X app’s account-level authorization is done in X account settings.

## Verification

```bash
pnpm verify
pnpm profile:search
```

`pnpm verify` copies the working source into a temporary directory, excludes credential files and local data before reading any file contents, reuses installed dependencies, and runs tests, lint, types, and the production build with inert process values. It then starts a disposable preview on port 3012 to check library search, trajectories, research cards, account isolation, and local-data deletion. The preview and temporary files are cleaned up afterward. Keep port 3012 free; the check refuses an occupied port. Run `pnpm test:api` for just these API checks.

`pnpm profile:search` uses only generated in-memory data and pure search modules; it does not load app configuration or local data. The library endpoint also reports `auth` and `library` durations in its `Server-Timing` header for browser profiling, without query text or source content.

Agent tests and builds must use `pnpm verify` or an equivalent isolated source copy without local environment files. See [HANDOFF.md](HANDOFF.md) for the current state and remaining launch work.
