# Stimgraph handoff

Updated October 2, 2026.

The mission is to help people explore saved material, connect ideas, and develop research questions grounded in their sources. [PRODUCT.md](PRODUCT.md) describes the product direction; [LAUNCH.md](LAUNCH.md) separates what exists from the proposed closed launch.

## Where to resume

Bookmarks is now the default view. The main navigation is **Bookmarks / Explore / Tools**; the sidebar and persistent metrics bar are gone. Tools holds research, secondary views, and settings. Library filters and Explore layout controls expand on demand, the research workspace starts closed, and successful sync notices clear automatically.

The full Bookmarks library searches all imported sources with topic filters, pagination, inline reading, and import/publication sorting. **Explore connections** adds a library source and its recorded links to the working graph. Sync reports new versus checked posts and offers continuation when X has another page; completed pages survive errors. Continuation and **New this session** remain in memory for the current tab. Import timestamps are no longer overwritten by resyncs. Earlier historical timestamps retain their old last-sync meaning.

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

- 59 model/provider tests cover bookmark search and pagination, the X 99-item truncation regression, sync continuation and partial failures, graph exploration, trails, bridges, trajectories, research validation, citation matching, and provider request boundaries. Grok and Crossref are mocked; live generation and search quality remain to be assessed with explicitly chosen examples.
- An isolated D1 fixture verified library pagination, literal search, topic filters, owner isolation, stable import timestamps, and newly imported older posts. The unauthenticated library endpoint returns 401 with private cache headers.
- TypeScript, ESLint, and the Vinext production build passed in an isolated source copy without local environment files.
- All SQL migrations apply to an empty database. Additive migrations `0001`–`0003` can also be reapplied alongside runtime schema initialization.
- Isolated API tests passed for trajectory and research persistence, ownership, versioning, private cache headers, quotation validation, concurrency limits, record caps, and deletion. No live provider requests ran.
- Earlier checks covered OAuth browser-state binding and bridge source isolation. A browser extension may still block localhost independently of the app.

Use inert values supplied directly to a test process. Never copy or load local environment files. `scripts/test-trajectories.mjs` expects an isolated preview on port 3012. `scripts/test-research.mjs` additionally expects `scripts/fixtures/research-route.ts` copied to `app/api/test-research/route.ts` **only in that preview**. The fixture requires the exact inert client ID `stimgraph-research-test`, secret `stimgraph-inert-test-secret`, an empty XAI key, and synthetic owner IDs. It must never become a production route. Cloudflare's preview worker needs those process values passed through the temporary Vite binding configuration.

The next product experiment is to return to a saved card after more bookmarks arrive: did the new material strengthen it, contradict it, or make the first investigation easier? Record those outcomes before adding more generators. Separately, complete the email/X identity split and launch access controls before inviting outside users.
