#!/usr/bin/env bash
# Isolated fixture checks for the bookmark MCP.
# Does not open a caller-supplied database, does not start the web app, and does not call Tailscale.
set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo "usage: verify-isolated.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROOF="${STIMGRAPH_MCP_PROOF:-/tmp/stimgraph-mcp-proof}"

if [[ -n "${STIMGRAPH_MCP_DATABASE:-}" || -n "${STIMGRAPH_MCP_PRINCIPALS:-}" || -n "${STIMGRAPH_MCP_BIND:-}" ]]; then
  echo "ignored STIMGRAPH_MCP_DATABASE, STIMGRAPH_MCP_PRINCIPALS, and STIMGRAPH_MCP_BIND" >&2
fi
unset STIMGRAPH_MCP_DATABASE
unset STIMGRAPH_MCP_PRINCIPALS
unset STIMGRAPH_MCP_BIND

mkdir -p "$PROOF"
cd "$ROOT/mcp"

set +e
cargo test --locked --all-targets -- --test-threads=1 >"$PROOF/cargo-test.txt" 2>&1
test_status=$?
set -e
if [[ "$test_status" -ne 0 ]]; then
  echo "cargo test failed, log $PROOF/cargo-test.txt" >&2
  exit "$test_status"
fi

"$ROOT/mcp/scripts/check-access-model.sh" >"$PROOF/tlc.txt" 2>&1
"$ROOT/mcp/scripts/check-access-model.sh" --expect-violation >"$PROOF/tlc-leak.txt" 2>&1
echo "proof directory: $PROOF"
