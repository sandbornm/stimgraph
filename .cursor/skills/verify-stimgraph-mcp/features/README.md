# stimgraph-mcp features

The client is an MCP client that speaks Streamable HTTP to `127.0.0.1`. The proof harness is `mcp/tests/protocol.rs`.

| Feature | File | Test |
| --- | --- | --- |
| Search bookmarks | [search.md](search.md) | `official_client_searches_lists_and_reads_only_its_owner` |
| List bookmarks | [list.md](list.md) | the same test, list pages |
| Read one bookmark | [detail.md](detail.md) | the same test, `get_bookmark` |
| Denied access | [denied.md](denied.md) | `invalid_calls_disclose_no_stored_text_and_do_not_write` and `auth_origin_and_host_rejections_are_empty_of_bookmark_text` |
