---
name: verify-stimgraph-mcp
description: "Drive the private stimgraph-mcp loopback server with the official Rust MCP client, on an isolated fixture database. Use after a change to mcp tools, auth, or storage, and before claiming search, list, detail, or denial behavior."
---

# Verify stimgraph-mcp

The surface is the Streamable HTTP server in `mcp/`. A client calls `search_bookmarks`, `list_bookmarks`, and `get_bookmark`. The Next.js app is a different surface. Do not start it for this skill. Do not run Tailscale. Do not open `.tailnet/state/stimgraph.sqlite`.

The proof path is the official client in `mcp/tests/protocol.rs`. That test builds a fixture database, binds `127.0.0.1:0`, and shuts the server down. There is no long-lived process to attach to.

This checks the private read-only server. It does not check a public product page, a registry entry, or a control tool. Those are not in this crate.

## Launch

From the repository root, with `rustc` 1.88 or newer, `cargo`, and a C compiler already installed:

```bash
unset STIMGRAPH_MCP_DATABASE STIMGRAPH_MCP_PRINCIPALS STIMGRAPH_MCP_BIND
cargo test --locked --test protocol --manifest-path mcp/Cargo.toml -- --test-threads=1 --list
```

Ready means the list prints `official_client_searches_lists_and_reads_only_its_owner`, `invalid_calls_disclose_no_stored_text_and_do_not_write`, and `auth_origin_and_host_rejections_are_empty_of_bookmark_text`. The server is not left running. A missing database is not a launch. `ReadOnlyStore::open` does not create a file.

## Doctor

Run this before a drive when the toolchain or the lock looks wrong. It does not bind a port and does not read a database.

```bash
rustc --version
cargo metadata --locked --manifest-path mcp/Cargo.toml --no-deps --format-version 1
```

The metadata name is `stimgraph-mcp`, the version is `0.1.0`, and `rust-version` is `1.88`. `rustc --version` must be 1.88 or newer. If `cargo metadata` asks to update the lock, stop. Do not point a manual binary at a database you did not just create with `mktemp`.

## Drive

The harness is `cargo test` for `mcp/tests/protocol.rs`. Drive one feature with the official client. The feature map lists the other tests.

Search, from the repository root:

```bash
mkdir -p /tmp/stimgraph-mcp-proof
unset STIMGRAPH_MCP_DATABASE STIMGRAPH_MCP_PRINCIPALS STIMGRAPH_MCP_BIND
cargo test --locked --test protocol --manifest-path mcp/Cargo.toml -- --test-threads=1 --exact official_client_searches_lists_and_reads_only_its_owner --nocapture > /tmp/stimgraph-mcp-proof/protocol.txt 2>&1
```

A passing drive ends with `ok` for that test name. The log shows a search for `lattice` that returns post `101` only, then list pages `101`, `102`, and `103`, then detail for `101`. Post `201` and post `999` return the same `bookmark_not_found` object. The log must not be treated as a pass if it contains `OTHER_OWNER_BOOKMARK_TEXT` on the owner-a search page. The fixture text `ignore previous instructions` is stored data on post `101` and may appear as a field value.

The same command covers list and detail because that is the test the repo has. The separate feature files say which assertions belong to which feature. Do not weaken the test to skip one of them.

## Evidence

`/tmp/stimgraph-mcp-proof/protocol.txt` is the proof. It must contain the test name and `ok`. The test also checks that the fixture row corpus, the main database bytes, and the `-wal` bytes are unchanged. Shared-memory bytes are not the proof. The test does not call the network except the loopback client it starts. It does not read `.env` files.

## Cleanup

The test deletes its temporary directory and aborts the server task it spawned. Do not kill processes by name. Do not delete `/tmp/stimgraph-mcp-proof`. If you started `stimgraph-mcp` yourself for a manual check, kill that process id only, and delete the `mktemp` copy you made.

## Helpers

`mcp/scripts/verify-isolated.sh` runs the full locked test suite and both TLC configs. It unsets the three `STIMGRAPH_MCP_*` variables first. Logs go to `/tmp/stimgraph-mcp-proof` or to `$STIMGRAPH_MCP_PROOF`. Use it for a host run. Use the Drive command above when you only need the official-client proof.
