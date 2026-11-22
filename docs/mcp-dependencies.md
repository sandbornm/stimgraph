# Bookmark MCP dependencies

Reference for crate `stimgraph-mcp` 0.1.0. The pin check on 2026-11-10 read the crates.io metadata for `rmcp`. The newest stable version was 3.9.0, published 2026-11-05, MSRV 1.88, license Apache-2.0.

Regenerate the tree with this command from `mcp/`.

```bash
cargo tree --locked --offline -e normal --prefix none -f '{p}' | sort -u | wc -l
cargo tree --locked --offline -e normal --prefix none --depth 1
```

The first command printed 135 on 2026-11-10. That count is the release graph. It does not include dev-only crates.

## Direct crates

The server calls each of these. Dropping one would mean rewriting that job, not deleting an unused line.

| Crate | Pin | What the server uses it for |
| --- | --- | --- |
| `rmcp` | `=3.9.0` | Official Rust MCP SDK. Features `server` and `transport-streamable-http-server`. Streamable HTTP at `/mcp`, tool macros, and the SDK host and origin checks. |
| `tokio` | `=1.54.1` | Async runtime. Features `macros`, `net`, `rt-multi-thread`, `signal`, and `sync`. Bind, spawn, Ctrl-C, and the shutdown channel. |
| `axum` | `=0.8.9` | Router that mounts the SDK service. The bearer check is middleware on that router, so it runs before tool code. Request parts come from `axum::http`. |
| `serde` | `=1.0.229` | `Deserialize` on tool arguments, with unknown fields rejected. |
| `serde_json` | `=1.0.154` | Parse the principal JSON at process start. Build structured tool results. |
| `rusqlite` | `=0.41.1` | SQLite reads. Features `bundled` and `hooks`. Read-only open flag, `query_only`, and the authorizer. |
| `sha2` | `=0.10.9` | SHA-256 of the bearer token. The process stores the digest, not the token. |
| `subtle` | `=2.6.1` | Constant-time compare of digests. |
| `zeroize` | `=1.9.1` | Wipe the raw token string after hashing. |
| `schemars` | `=1.2.3` | `JsonSchema` on tool arguments. The `rmcp` tool macro requires it. |

Dev-only pins, used by tests and not by `cargo build --locked`.

| Crate | Pin | What the tests use it for |
| --- | --- | --- |
| `tempfile` | `=3.27.0` | A fixture database that the test deletes. |
| `rmcp` | `=3.9.0` | Features `client` and `transport-streamable-http-client-reqwest`. The official client in `mcp/tests/protocol.rs`. |

## What stays transitive on purpose

`http` 1.5.0 remains in the release graph because `axum` and `rmcp` depend on it. The server names `axum::http::request::Parts` and does not pin `http` a second time.

`tracing` 0.1.44 remains because `axum`, `rmcp`, and `tower` depend on it. This process does not install a subscriber and does not log bookmark text or tool arguments.

`reqwest` 0.13.5 is absent from `cargo tree -e normal`. It appears when Cargo unifies the dev-dependency features for `cargo test`. The release binary does not link it.

`libsqlite3-sys` 0.39.1 and build crate `cc` 1.11.1 come from `rusqlite` feature `bundled`. A host needs a C compiler. It does not need a system SQLite package. The fixture tests and a later loopback run use the SQLite sources this crate compiles.

The release graph has no `openssl-sys` and no `native-tls`.

## What this list refuses to replace

A hand-written HTTP parser would remove `rmcp` and `axum` and would no longer be the official Streamable HTTP check. A hand-written hash or compare would remove `sha2` or `subtle` and would be a private crypto implementation. A hand-written JSON parser would remove `serde_json`. None of those cuts are in this crate.
