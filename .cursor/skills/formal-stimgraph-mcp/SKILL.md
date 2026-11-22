---
name: formal-stimgraph-mcp
description: "Model-check the stimgraph-mcp access guards with TLC. Use when a change touches owner filtering, authorize, bearer rejection, the read-only store, or mcp/tla/BookmarkMcp.tla."
---

# Formal check for bookmark MCP access

The property is one sentence. A request that is anonymous, revoked, rejected, or aimed at another owner discloses no row from that other owner, and no modeled action changes stored rows.

The harm is one sentence. A broken owner filter, or a disclosure on a denial, shows one person's bookmarks to another person.

The tool is TLC on a small TLA+ model, because the question is which request outcomes can disclose a row. A proof assistant is not used. The model is not the Rust. The protocol test is the check on the Rust. Read every TLC result with the pstack `/statechart` skill. Do not copy that skill's commands into this file or into `mcp/scripts/`.

## When a change needs this check

Run it when the diff touches any of these.

- `mcp/src/store.rs`, functions `ReadOnlyStore::open`, `ReadOnlyStore::search`, `ReadOnlyStore::get`, and the SQL constants `BOOKMARKS_BY_OWNER`, `BOOKMARK_BY_ID`, `TOPICS_BY_OWNER`, `TOPICS_BY_POST`.
- `mcp/src/policy.rs`, function `authorize`.
- `mcp/src/server.rs`, functions `streamable_config`, `authenticate_request`, `allow`, `search_bookmarks`, `list_bookmarks`, `get_bookmark`.
- `mcp/src/config.rs`, function `authenticate`.
- `mcp/tla/BookmarkMcp.tla` and its two configs.

A docs-only edit does not need a new TLC run. A change to term matching or page size does not change the model. Say that in the review, and do not pretend the model checked it.

## Run

From the repository root:

```bash
mcp/scripts/check-access-model.sh
mcp/scripts/check-access-model.sh --expect-violation
```

The first command must exit 0. The second command must exit 0 only because TLC reports that invariant `Separation` is violated. If the second command exits 0 without that sentence, the broken model is no longer broken, and the check is useless.

Java 21 and the pinned jar `tla2tools.jar` 1.7.4 are required. The script checks SHA-1 `bee4a54f3ee3d4afc347c3240ec2d9e93b075104`.

## How to read a failure

`/statechart` turns an invariant violation into the shortest path. In this model's words, a real bug is a path that ends with another owner's post in `disclosed`, or with `stored` different from the initial database.

A modeling error is a TLC parse error, a name that does not exist in `BookmarkMcp.tla`, or a path that no longer matches `authorize` or the SQL predicate. Fix the model only when the code's guard changed on purpose. Do not delete `Separation` to make the leak config pass.

The leak config is the known broken model. `Search` by `agent_a` puts post `201` of `owner_b` into `disclosed`. `stored` stays the same. That is the counterexample the second command must keep finding.

## Known break in the Rust

The model does not compile the Rust. This scratch shows that the protocol test, not the diagram, catches a missing owner filter.

In `BOOKMARKS_BY_OWNER`, replace `owner_id = ?1` with `?1 = ?1`. Keep the bound parameter so SQLite still accepts the statement. Run:

```bash
cargo test --locked --test protocol --manifest-path mcp/Cargo.toml -- --exact official_client_searches_lists_and_reads_only_its_owner
```

The test fails. Owner-a receives post `201` and the text `OTHER_OWNER_BOOKMARK_TEXT`. Restore the predicate `owner_id = ?1`. Run the test again and confirm it passes. Do not commit the scratch.

## Coverage

| Model name | Code | Test |
| --- | --- | --- |
| `BadTransport` | `streamable_config` | `auth_origin_and_host_rejections_are_empty_of_bookmark_text` |
| `RejectAnon` | `authenticate_request` | the same test, missing bearer |
| `RejectRevoked` | `authenticate` | the same test, revoked body equals unknown body |
| `RejectUnknownTool` | tool router | `invalid_calls_disclose_no_stored_text_and_do_not_write` calls `execute_sql` |
| `RejectBadInput` | `parse_search`, `parse_list`, `parse_post_id` | the same test |
| `Search`, `List` | `ReadOnlyStore::search` | `official_client_searches_lists_and_reads_only_its_owner` |
| `Detail` | `ReadOnlyStore::get` | the same test, posts `201` and `999` |
| `NoMutation` | read-only open, `query_only`, authorizer | fixture bytes, and `connection_rejects_writes_and_secret_tables` |

Checked config is `Leak = FALSE`. TLC on 2026-11-10 generated 36 states, 15 distinct, depth 2. The leak config stops at the `Separation` counterexample above.

Move the sync commit forward only after you run both commands and confirm that this table still names the guards in the new commit.

## Sync

Covered code was last confirmed at commit `d906fc6ae9572fea07f6b6afe128375704771cb7`.

## Limits

The check does not prove the SDK, SQLite, the operating system, or Tailscale. It does not model term matching, pagination, the 5000-row window, or the response caps. A term after 16000 characters is the Rust test `search_matches_text_and_topics_past_the_response_cap`, not a TLC state. Host and origin behavior in the Rust test is the pinned SDK's response to the allowlist in `streamable_config`. Passing TLC does not mean the diagram proved the binary.

After a later edit that skips this check, use `/maintain-formal-verification-skill` to bring the model back in line.
