# Stimgraph

Stimgraph helps people turn things they saved into directions worth investigating. Its mission is to make a personal collection explorable, preserve the reasoning behind useful connections, and develop research questions grounded in sources.

The recurring job is: “I saved all this. Help me find a worthwhile direction and remember why I followed it.” A concept trajectory gives that direction a question, a route, and evidence you can reopen. A research card carries it into a hypothesis, explicit assumptions, and a small next investigation. The graph remains the starting point: the user chooses where to look and when to ask for help.

## First useful offering

Start with personal use. Then try a small invite-only pilot if people can return to their own collections and find value without a walkthrough. Keep the public-facing promise narrow: explore saved material, preserve useful paths, and develop questions that can be investigated.

The current trajectory feature includes:

- A name and question or notes attached to the active path.
- A concept outline with saved posts and relationship labels between steps.
- Private persistence for connected accounts, with a separate record for each save.
- Reopening any available step and branching without changing the saved record.
- Nearby saved posts not visited in the current session.
- A Markdown outline export containing labels and notes, without full post text.

The outline records exploration. It does not establish prerequisites, mastery, or an authoritative hierarchy. Search jumps appear as new starting points. Missing items remain visible in saved records, and resuming uses a connected portion of the current map.

## Research workflow

The Research bench is part of the same mission. It starts from 2–8 bookmarks the user chooses, with optional reasons for saving them. Five lenses encourage method transfer, tensions, shared problems, changed constraints, and missing evidence. Stay close and Reach further adjust source suggestions using topic overlap. They do not rank scientific originality.

Each card keeps the question, method, problem, speculative connection, assumptions, counterexamples, smallest investigation, notes, and source evidence. Source roles are interpretations of the excerpt: problem, method, claim, assumption, or result. Generated quotations must match supplied excerpts; a matching quote does not validate the proposed connection. Cards are editable and privately versioned, with a Markdown export.

Optional Grok drafting is one explicit request with bounded excerpts and no tools. Nearby-work search is another explicit action: the user reviews a short query before it goes to Crossref. A dated metadata result is a reading lead. It does not establish novelty or exhaust the literature. These services never run simply because the user follows a graph edge.

Judge this feature by whether a user returns to a saved question, finds useful counterevidence, or carries out the small investigation. Avoid optimizing for the number of generated ideas or time spent wandering. More source types, claims, and search providers should earn their place by improving those outcomes.

## Where to take it next

| Addition | User question | Evidence needed |
| --- | --- | --- |
| Routes toward a chosen concept — implemented | “How do I get from embedded work to compilers?” | Shared bookmarked posts, with optional Grok interpretation; disconnected concepts receive separately labeled suggestions. |
| New material beside a saved trajectory | “Has anything arrived that helps with this question?” | Newly imported posts connected to that trajectory, with import time distinguished from post creation time. |
| Research cards from selected sources — implemented | “What did I learn, and what remains unclear?” | Exact source excerpts, explicit assumptions and failure conditions, and a dated, limited nearby-work search. |

Concept-to-concept routes and the Research bench are available. The next experiment is whether returning to a saved question is useful when more material arrives. Later candidates include marking an investigation tried, recording what failed, and comparing a new result with the original hypothesis. The proposed email-login and X-account separation is documented in [LAUNCH.md](LAUNCH.md).

If this becomes a paid product, charge for the private workspace and research workflow. Validate willingness to return before adding billing. Set import and optional AI budgets before opening signups; domain cost does not cover those ongoing services.

## Proposed closed release

This is a release plan, not a claim that these deployment controls are installed.

1. Reserve the name if the registrar's actual registration and renewal price is acceptable. Buying a domain does not require publishing an app. Cloudflare describes its registrar pricing as registry and ICANN cost without markup. Availability and the specific checkout price have not been verified here. [Cloudflare Registrar](https://developers.cloudflare.com/registrar/faq/).
2. Initially allow only the owner's email to reach the app. A later pilot can use an explicit invite list. Protect the app and its API together, including any alternate origin hostname, so the gate cannot be bypassed. Cloudflare Access supports email allow policies and denies access by default. Test the X callback with the final hostname before relying on the gate. [Access applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/), [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/).
3. Disable public map sharing at the API and UI, and revoke existing share records, before describing the whole system as closed. Trajectories already have no public URL; existing map shares are a separate feature. A public demo, if desired later, should use synthetic examples.
4. Keep collections separate. Test authorization on every account-owned record. Keep only the data needed for exploration, and provide deletion and a clear retention policy. The FTC recommends minimizing collection and retention and limiting access. [FTC security guidance](https://www.ftc.gov/business-guidance/resources/start-security-guide-business).
5. Keep Grok actions explicit and optional, with a clear description of the data sent. Turning on those features sends material to xAI. Its current API policy specifies 30-day default retention and no training on API inputs or outputs without explicit permission. A private app is still using an external processor when these actions run. [xAI API security](https://docs.x.ai/developers/faq/security).

## Before outside users

Private access reduces exposure; it does not settle legal liability. The appropriate business structure, terms, and privacy obligations depend on the operator's jurisdiction, users, and commercial model. Obtain legal advice before treating an invite-only launch or a disclaimer as protection.

Review X's approved use case and terms, especially current-content display, removal of unavailable posts, and redistribution. The current local archive and outline export are not a completed compliance review. In particular, deleting the user's map is different from keeping cached source content and saved labels consistent with upstream removals. [X Developer Policy](https://docs.x.com/developer-terms/policy).

Check naming conflicts before marketing the product. Registering a domain does not grant trademark rights; a search should consider similar names and related products as well as federal registrations. No trademark clearance has been performed for Stimgraph. [USPTO trademark process](https://www.uspto.gov/trademarks/basics/trademark-process), [USPTO search guidance](https://www.uspto.gov/trademarks/basics/why-register-your-trademark).

Sources checked September 4, 2026.
