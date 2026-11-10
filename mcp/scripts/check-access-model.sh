#!/usr/bin/env bash
# Check the bookmark MCP access model with TLC 1.7.4.
# Pass --expect-violation to run the leak config, which must fail Separation.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JAR="${TLA2TOOLS_JAR:-${HOME}/.cache/stimgraph-mcp/tla2tools-1.7.4.jar}"
URL="https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar"
SHA1="bee4a54f3ee3d4afc347c3240ec2d9e93b075104"
MODE="pass"
if [[ "${1:-}" == "--expect-violation" ]]; then
  MODE="violation"
elif [[ $# -gt 0 ]]; then
  echo "usage: check-access-model.sh [--expect-violation]" >&2
  exit 2
fi

if [[ ! -f "$JAR" ]]; then
  mkdir -p "$(dirname "$JAR")"
  curl --fail --silent --show-error --location --output "$JAR" "$URL"
fi
echo "${SHA1}  ${JAR}" | sha1sum --check --status

cd "$ROOT/tla"
if [[ "$MODE" == "pass" ]]; then
  java -XX:+UseParallelGC -jar "$JAR" -workers 1 -config BookmarkMcp.cfg BookmarkMcp.tla
else
  set +e
  output="$(java -XX:+UseParallelGC -jar "$JAR" -workers 1 -config BookmarkMcpLeak.cfg BookmarkMcp.tla 2>&1)"
  status=$?
  set -e
  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "leak config was expected to violate Separation" >&2
    exit 1
  fi
  if ! grep -q "Invariant Separation is violated" <<<"$output"; then
    echo "leak config failed without a Separation counterexample" >&2
    exit 1
  fi
fi
