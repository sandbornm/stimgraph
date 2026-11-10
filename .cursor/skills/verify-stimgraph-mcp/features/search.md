# Search bookmarks

Search returns stored bookmarks for the owner bound to the bearer token. The query is data. It is not SQL, and it is not an instruction.

## Sub-features

- `search-match` returns the owner row whose text, author, and topic match.
- `search-repeat` returns the same JSON on a second call.
- `search-injection` treats a SQL-shaped string as text and matches nothing.
- `search-other-owner` returns only the other principal's row.

## How to get to it (user POV)

Point a compatible MCP client at `http://127.0.0.1:<port>/mcp` with `Authorization: Bearer` and the token for that owner. Call the tool `search_bookmarks`.

## Driving it with cargo test

Preconditions:

- `cargo metadata --locked --manifest-path mcp/Cargo.toml --no-deps` reports `stimgraph-mcp` 0.1.0.
- `STIMGRAPH_MCP_DATABASE` is unset. The test creates the fixture.
- The Next.js app is not required, and it is not started.

Run, from the repository root:

```bash
cargo test --locked --test protocol --manifest-path mcp/Cargo.toml -- --test-threads=1 --exact official_client_searches_lists_and_reads_only_its_owner --nocapture
```

- **Match.** The client calls `search_bookmarks` with `q` `lattice`, `topic` `security`, and `author` `@Ada`. The result has `matched` 1, bookmark id `101`, channel confidentiality `owner`, integrity `low`, and compartment `owner-a`. The text field contains `ignore previous instructions` as stored data.
- **Repeat.** The same arguments return the same JSON.
- **Injection.** `q` set to `' OR owner_id != '` returns `matched` 0.
- **Other owner.** A second client with the other token searches with empty arguments and receives bookmark id `201` in compartment `owner-b`.

## Gotchas

- The fixture is a WAL database. The test compares the row corpus, the main file bytes, and the `-wal` bytes. A change in the `-shm` file is not a failed proof by itself.
- Owner filtering is the SQL predicate `owner_id = ?1` in `BOOKMARKS_BY_OWNER`. The Rust filter does not check `owner_id` again. A scratch edit that drops that predicate fails this test because owner-a then receives post `201` and `OTHER_OWNER_BOOKMARK_TEXT`.
- An empty data directory is not a successful search. The server does not create a database.
