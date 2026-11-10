# Read one bookmark

Detail returns one bookmark for the authenticated owner, or the same not-found object for an unknown id and for another owner's id.

## Sub-features

- `detail-own` returns post `101` with topic label `Security` and url `https://x.com/ada/status/101`.
- `detail-hidden` returns `bookmark_not_found` for post `201`.
- `detail-missing` returns the same object for post `999`.
- `detail-cross` returns `bookmark_not_found` when the other principal asks for post `101`.

## How to get to it (user POV)

Call the tool `get_bookmark` with `post_id`.

## Driving it with cargo test

The detail assertions live in `official_client_searches_lists_and_reads_only_its_owner`. Run the command in [search.md](search.md).

`post_id` `101` returns handle `ada`. `post_id` `201` and `post_id` `999` return equal JSON with error `bookmark_not_found` and `is_error` true. Neither body contains `OTHER_OWNER_BOOKMARK_TEXT`.

## Gotchas

- `post_id` must match `^[0-9]{1,32}$`. The denial test covers `not-a-number`.
- A not-found result is public and high integrity. It is not a row read of the other owner.
- The url is present only when the handle and the post id match the server's shape check. Otherwise the field is null.
