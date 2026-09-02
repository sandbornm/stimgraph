# Stimgraph

Stimgraph turns X bookmarks into an explorable map of saved posts, people, topics, and the connections between them. **STIM** means **Stuff That Interests Me**.

The map shows each saved post as a small particle near its author and topics. Solid lines trace direct bookmark evidence. Dotted lines show authors or topics that overlap across saved posts; those lines do not change the source ranking. Cyan diamonds are Grok scout finds: posts on X that fit the map but are not bookmarks yet.

X does not expose a bookmark webhook on this API, so a connected tab polls the newest 15 bookmarks every 90 seconds while it is visible. New saves flash on the field. Sync also imports who you follow: those accounts appear as quieter people on the globe, and bookmark authors you already follow are marked. Grok scout is a separate action: it searches X with `x_search` against your top topics, frequent authors, and followed accounts. Optionally keep scouting every 12 minutes while the tab stays open.

You can drag, zoom, select, search, filter by signal type, or jump to a random node. The interaction direction credits [Kat ⊷ the Poet Engineer’s gestural latent-space work](https://x.com/poetengineer__/status/1821654144958202077); the visual design and implementation here are original.

Select any node to grow a two-step neighborhood around it. Neighborhoods export as `.stimgraph` files that contain people, topics, and connection weights. They exclude saved-post nodes and bookmark text. Importing someone else’s neighborhood places both graphs in one field; matching people and topics become shared bridge nodes.

The Tune panel changes particle density, the minimum visible connection strength, motion, labels, and color. It can hide dotted affinity links or the on-screen guide. Quiet, Balanced, and Charged presets provide useful starting points. These preferences stay in the browser on the current device.

## Local setup

Use Node 22.13 or newer and pnpm.

1. In the [X Developer Console](https://console.x.com/), configure the app as a confidential **Web App, Automated App or Bot**.
2. Leave app permissions on **Read**.
3. Set the callback URL to `http://127.0.0.1:3001/api/auth/x/callback`.
4. Set the website URL to `http://127.0.0.1:3001`.
5. Put the credentials in `.env.local`, following `.env.example`. Never commit or paste that file into chat.
6. Install and run:

   ```bash
   pnpm install --ignore-scripts
   pnpm dev
   ```

Then open `http://127.0.0.1:3001`.

Required server credentials:

- `X_CLIENT_ID`: the OAuth 2.0 client ID for the X app.
- `X_CLIENT_SECRET`: the OAuth 2.0 client secret for the X app.
- `X_REDIRECT_URI`: exactly `http://127.0.0.1:3001/api/auth/x/callback` for local development.
- `XAI_API_KEY`: a dedicated xAI API key used for optional topic enrichment and Grok scout.

`NEXT_PUBLIC_SITE_URL` is non-secret and defaults to `http://127.0.0.1:3001` for social metadata.

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
pnpm exec tsc --noEmit
pnpm run build
```
