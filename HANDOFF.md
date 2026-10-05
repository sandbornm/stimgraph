# Stimgraph handoff

Updated October 5, 2026.

The mission is to help people explore saved material, connect ideas, and develop research questions grounded in their sources. [PRODUCT.md](PRODUCT.md) describes the product direction; [LAUNCH.md](LAUNCH.md) separates what exists from the proposed closed launch.

## Where to resume

Bookmarks is now the default view. The main navigation is **Bookmarks / Explore / Tools**; the sidebar and persistent metrics bar are gone. Tools holds research, secondary views, and settings. Library filters and Explore layout controls expand on demand, the research workspace starts closed, and successful sync notices clear automatically.

The full Bookmarks library searches all imported sources with topic filters, pagination, inline reading, and import/publication sorting. **Explore connections** adds a library source and its recorded links to the working graph. Sync reports new versus checked posts and offers continuation when X has another page; completed pages survive errors. Continuation and **New this session** remain in memory for the current tab. Import timestamps are no longer overwritten by resyncs. Earlier historical timestamps retain their old last-sync meaning.

Library search now defaults to **Best match** when a query is present and recent imports otherwise. It requires all words across text, authors, or topics, accepts quoted phrases, boosts the original phrase, and ranks in SQL before pagination. Explicit date sorts still override relevance. Demo and live search share scoring rules, including literal punctuation matching. QMD (Query My Data) was a discussion idea, not an existing integration; the user confirmed it is optional. This pass uses the existing database and makes no search-provider calls. Future ranking work should start with representative saved queries and judged results before adding semantic retrieval.

The performance review removes redundant topic scoring, adds an import-order index, and exposes API `Server-Timing` durations. In a local 5,000-bookmark synthetic benchmark, ranked-search median decreased from about 112 ms to 74 ms; those are warm SQLite batch timings, not production D1 latency. The benchmark imports the same statement builder as the API, and CI publishes its p50/p95 table. There is no hard wall-clock gate on shared runners.

Search retains previous cards with an explicit updating message, debounces only text edits, highlights a matching passage, and avoids refetching unchanged results on return from Explore. Cards reuse their date formatter and memoize rendering. Demo pagination ranks once per request instead of once per accumulated page. Research tools mount on first use and fetch records only when opened, while preserving drafts when hidden. **Tools → Organize with Grok** exposes existing topic enrichment; no new generation or automatic curation is enabled.

Setup now includes `pnpm demo` (an isolated, temporary demo without local credentials), `pnpm verify` (isolated tests/lint/types/build/API checks), `pnpm test:api` (just the isolated API suite), and `pnpm profile:search` (synthetic data only). Node 24 is pinned to match CI. Normal `pnpm dev` still uses the owner's local configuration. Copying credentials to another laptop does not transfer its database or saved research records. See README for the short startup and Grok curation paths.

The October 5 recheck found a missing `/api/data` endpoint behind **Delete local map + disconnect** and two outdated assertions expecting research tools in the initial HTML. The endpoint now deletes only the authenticated owner's records, clears the session cookie, rejects cross-site requests, and uses private cache headers. Root local data remains excluded while the `app/api/data` source directory is included in Git and isolated copies. API integration checks now run in `pnpm verify` and CI, covering deletion, session invalidation, and preservation of another owner's records. All deletion tests use a disposable database.

Local X login now declares the secret names explicitly for the Cloudflare dev Worker and reports missing names. Credentials belong in the ignored `.env.local`, with owner-only permissions; changing them requires a dev-server restart. `XAI_API_KEY` remains optional. Never inspect or copy local credentials during verification.

A direct X API check found that `max_results=100` returned 99 bookmarks with no continuation, both with and without author expansions. Six 20-item pages returned 120 distinct bookmarks with continuation still available. The importer now uses 20-item pages; its per-run limit remains 600. The library labels its count as imported bookmarks, and a finished sync says X returned no more pages instead of claiming the full account history is complete.

1. Open **Explore**, choose a topic or bookmark, and follow a branch. Expand **Layout & keyboard controls** to change LR/TB direction or use the arrow pad. Repeated nodes collapse the trail instead of creating a loop.
2. Open **Tools → Research workspace** and use **Bridge A → B** to find routes supported by shared bookmarks. Open a route and **Shape this path** to keep its question, notes, and steps as a trajectory.
3. Open **Research bench**, choose 2–8 sources, and expand them to note why you saved each. Pick a lens and either write a card or explicitly request a Grok draft.
4. Review the question, proposed connection, quotations, assumptions, and smallest investigation. Edit the nearby-work query before sending it to Crossref. Save a private version or export Markdown.

Research roles and connections are interpretations. Quotation checks establish that words occur in a supplied excerpt, not that the proposed hypothesis follows. Topic distance and empty bibliographic searches do not establish novelty. Nothing generated becomes a graph edge automatically.

## Current boundaries

- Connected X accounts own private trajectories and research cards. Email sign-in and permanent app-user IDs are still a launch task.
- Demo/shared research cards last only for the current page session. Shared map files exclude bookmark sources. Markdown research exports include notes and selected quotations.
- Grok and Crossref actions are explicit and capped per connected account. Grok research drafts use no tools. Crossref receives only the reviewed query and returns limited bibliographic metadata.
- The existing public map-sharing feature remains available. An invite-only release needs its API and UI disabled, plus access control on every hostname and API; see the launch plan.
- No domain was purchased and no deployment was performed for this change.

## Verification

- 70 model/provider tests cover bookmark search and pagination, the X 99-item truncation regression, sync continuation and partial failures, graph exploration, trails, bridges, trajectories, research validation, citation matching, and provider request boundaries. Search tests cover phrase priority (including repeated words), words spread across fields, exact metadata lookup, owner isolation, literal punctuation, bounded bind counts, ranking before pagination, SQL/demo parity across filters and sorts, accumulated demo pages, matching excerpts, and the import-order query plan. Grok and Crossref are mocked; live generation and search quality remain to be assessed with explicitly chosen examples.
- The search ranking pass also verified the library API against isolated D1 with 67 synthetic bookmarks, including three ranked pages, exact phrases, explicit date sorts, topic/new-item filters, and private responses. Browser checks covered demo and authenticated search, loading more, sort changes resetting pagination, and quoted phrases. Port 3001 did not respond during this session; these checks used an isolated preview on port 3012 with inert credentials and no local environment files.
- Performance browser checks used the same 67-record fixture: typing retained all 30 visible cards under a delayed response; a rapid typing burst made one search request; failure retained cards and Retry recovered; navigating away and back made no redundant library request. A measured Load more click-to-fetch delay decreased from 319 ms to 3 ms. Research startup requests decreased from two to zero, with each endpoint fetched when its panel opened. The library fit a 390-pixel viewport without horizontal overflow. Browser development timings are illustrative, not production Web Vitals.
- An isolated D1 fixture verified library pagination, literal search, topic filters, owner isolation, stable import timestamps, and newly imported older posts. The unauthenticated library endpoint returns 401 with private cache headers.
- TypeScript, ESLint, and the Vinext production build passed in an isolated source copy without local environment files.
- All SQL migrations apply to an empty database. Additive migrations `0001`–`0004` can also be reapplied alongside runtime schema initialization. `0004` adds the import-order index; no data backfill is required.
- Isolated API tests passed for trajectory and research persistence, ownership, versioning, private cache headers, quotation validation, concurrency limits, record caps, and deletion. No live provider requests ran.
- Earlier checks covered OAuth browser-state binding and bridge source isolation. A browser extension may still block localhost independently of the app.

Use `pnpm verify` or `pnpm test:api` with port 3012 free. The API runner creates a credential-free source copy and disposable D1 database, installs guarded search/research fixtures only in that preview, and stops and removes the preview afterward. Fixtures require the exact inert client ID `stimgraph-inert-test`, secret `stimgraph-inert-test-secret`, and an empty XAI key. They must never become production routes. Never copy or load local environment files for verification. The user's newly added xAI key has not been validated with a live provider request; port 3001 was not listening during this recheck.

The next product experiment is to return to a saved card after more bookmarks arrive: did the new material strengthen it, contradict it, or make the first investigation easier? Record those outcomes before adding more generators. Separately, complete the email/X identity split and launch access controls before inviting outside users.
