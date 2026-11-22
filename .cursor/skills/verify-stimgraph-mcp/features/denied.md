# Denied access

A caller who fails the transport check, the bearer check, the tool name, or the argument bounds gets no stored bookmark text. The fixture database does not change.

## Sub-features

- `deny-anon` fails initialize when the official client has no token.
- `deny-unknown` and `deny-revoked` return HTTP 401 with the same body `unauthorized\n`.
- `deny-origin` returns HTTP 403 for `Origin: https://evil.example` when the bearer is valid.
- `deny-host` returns HTTP 403 for `Host: evil.example` when the bearer is valid.
- `deny-bounds` rejects limit 0, limit 51, cursor 5001, and a non-decimal post id.
- `deny-extra` rejects an `owner_id` field.
- `deny-sql` rejects a tool named `execute_sql`.

## How to get to it (user POV)

Send the request the sub-feature names. There is no extra tool that grants a bypass.

## Driving it with cargo test

From the repository root:

```bash
cargo test --locked --test protocol --manifest-path mcp/Cargo.toml -- --test-threads=1 --exact invalid_calls_disclose_no_stored_text_and_do_not_write --nocapture
cargo test --locked --test protocol --manifest-path mcp/Cargo.toml -- --test-threads=1 --exact auth_origin_and_host_rejections_are_empty_of_bookmark_text --nocapture
```

The first test expects protocol errors whose text contains `limit must be from 1 to 50`, `cursor must be an offset`, and `post_id must be a decimal id`. The extra `owner_id` field is `is_error` true and the text mentions `owner_id`. `execute_sql` is an error. None of those strings contain `OTHER_OWNER_BOOKMARK_TEXT` or `SESSION_PAYLOAD_CANARY`.

The second test expects a missing token to fail initialize. Raw HTTP for an unknown token, a revoked token, and no token is status 401 and body `unauthorized\n`. A valid token with a bad origin or a bad host is status 403, and the body contains `Origin` or `Host`. The database bytes are unchanged.

## Gotchas

- Unknown and revoked tokens are the same on the wire. The config bit is still real. Restart the process to change it.
- The SDK returns an unknown field as a tool result with `is_error`, not as a Rust `Err` from `call_tool`.
- A 403 for host or origin is only reached in the test with a valid bearer, because the bearer middleware runs first.
- Do not add a fixture row's text to an error message to make a failure easier to read. The assertion is that the text is absent.
