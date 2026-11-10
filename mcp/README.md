# Run the bookmark MCP on loopback

This release is a private read-only process for bookmarks already stored in a Stimgraph SQLite file. It uses the official Rust SDK `rmcp` 3.9.0 and Streamable HTTP at `/mcp`. It does not start the web app, does not migrate the database, and does not listen on a public address.

A later public product page is described in the [security model](../docs/mcp-security-model.md). This guide does not install that page, a registry entry, or a control tool.

Facts for review are in the [security spec](../docs/mcp-security-spec.md) and the [dependency list](../docs/mcp-dependencies.md).

## Check the crate on an isolated fixture

Use a machine that already has `rustc` 1.88 or newer and `cargo`. When `rustup` is the driver, `mcp/rust-toolchain.toml` selects 1.99.1. The host also needs a C compiler, because `rusqlite` compiles the bundled SQLite sources.

Do not point this check at a production database. Do not start the Next.js app. Do not run `tailscale serve`. Do not enable Funnel. Do not install a LaunchAgent.

From the repository root:

```bash
unset STIMGRAPH_MCP_DATABASE STIMGRAPH_MCP_PRINCIPALS STIMGRAPH_MCP_BIND
mcp/scripts/verify-isolated.sh
```

The script runs `cargo test --locked` and the TLC checks. Proof logs stay in `/tmp/stimgraph-mcp-proof` unless `STIMGRAPH_MCP_PROOF` names another directory. The tests build their own SQLite files and delete them.

On a cold cargo cache, fetch the pinned crates once, then rerun the script.

```bash
cargo fetch --locked --manifest-path mcp/Cargo.toml
```

The model check needs Java 21, `curl`, and `sha1sum`. `mcp/scripts/check-access-model.sh` downloads `tla2tools.jar` 1.7.4 into `~/.cache/stimgraph-mcp` when the jar is absent, and it checks SHA-1 `bee4a54f3ee3d4afc347c3240ec2d9e93b075104`.

`mcp/scripts/check-access-model.sh --expect-violation` must fail the `Separation` invariant. That failure is the broken model, not a server mode.

## Run one loopback process against a copy

Do this only when you mean to talk to the server from a client on the same machine. Leave the Next.js app stopped. Leave Tailscale unchanged.

1. Build with `cargo build --locked --manifest-path mcp/Cargo.toml`.
2. Copy the bookmark database to a path from `mktemp`. The server opens that path read-only. It does not checkpoint a WAL file.
3. Export `STIMGRAPH_MCP_BIND=127.0.0.1:8765`.
4. Export `STIMGRAPH_MCP_DATABASE` as the absolute path of the copy.
5. Export `STIMGRAPH_MCP_PRINCIPALS` as a JSON array that stays out of git. Each object has `id`, `token`, `owner_id`, and `revoked`. The token is 16 to 256 graphic ASCII characters. `owner_id` must be the `bookmarks.owner_id` that token may read. Set `revoked` to true to deny a token until you change the map and restart.
6. Run `mcp/target/debug/stimgraph-mcp`. The process prints `stimgraph-mcp listening on http://127.0.0.1:8765/mcp`. It does not create a database.
7. Point an MCP client at that URL with header `Authorization: Bearer` and the token. A missing `Origin` is accepted. An `Origin` other than loopback HTTP is rejected.

## Roll back that process

Stop the process you started. Do not boot the web app, do not change Tailscale, and do not load a plist. Delete the copy from `mktemp`. Restart is required to change or revoke a principal. The server has no write path. Confirm the source file with a separate sqlite client if you want a row count on record.

## Tools

`search_bookmarks`, `list_bookmarks`, and `get_bookmark`. Each call reads only the owner id bound to the bearer token. Bookmark text in the result is data, not an instruction. There is no SQL tool, no file tool, and no network tool.
