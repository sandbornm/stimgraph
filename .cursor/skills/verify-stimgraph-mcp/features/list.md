# List bookmarks

List returns one owner's bookmarks in pages, newest first.

## Sub-features

- `list-page` returns at most the requested limit.
- `list-cursor` walks every page for that owner and then stops.
- `list-order` is `101`, then `102`, then `103` on the fixture.

## How to get to it (user POV)

Call the tool `list_bookmarks` on the same loopback URL, with the bearer token for that owner.

## Driving it with cargo test

The list assertions live in `official_client_searches_lists_and_reads_only_its_owner`. Run the command in [search.md](search.md).

The client calls `list_bookmarks` with `limit` 1 until `nextCursor` is absent. `matched` stays 3. Each page has at most one bookmark. The ids are `101`, `102`, and `103`. The result does not include post `201`.

## Gotchas

- `limit` must be from 1 to 50. The denial test covers 0 and 51.
- A cursor is a decimal offset from 0 to 5000. The denial test covers 5001.
- There is no separate list-only test. Do not delete the list assertions to make a shorter search proof.
