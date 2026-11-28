#!/bin/sh
set -eu
cd "$(dirname "$0")"

JAR_URL='https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar'
JAR_SHA='df7cef5d37bcca879817424c001696e07fd094d68a72690449af3045fd972469'
JAR=.tlc/tla2tools.jar

mkdir -p .tlc states
if [ ! -f "$JAR" ]; then
  curl -fsSL -L -o "$JAR" "$JAR_URL"
fi
got=$(shasum -a 256 "$JAR" | awk '{print $1}')
if [ "$got" != "$JAR_SHA" ]; then
  echo "tla2tools.jar sha256 mismatch: $got" >&2
  exit 1
fi

JAVA=${JAVA:-java}
TLC="$JAVA -XX:+UseParallelGC -jar $JAR -workers 2"

expect_pass() {
  cfg=$1
  out=$2
  echo "==> fixed design ($cfg)"
  $TLC -config "$cfg" -metadir states/fixed StimgraphAuth.tla >"$out" 2>&1 || true
  if ! grep -q 'Model checking completed. No error has been found.' "$out"; then
    echo "expected the fixed spec to pass; see $out" >&2
    tail -40 "$out" >&2
    exit 1
  fi
  grep -E 'No error has been found|states generated|distinct states|depth of the complete' "$out" || true
}

expect_fail() {
  cfg=$1
  inv=$2
  out=$3
  echo "==> mutant $cfg (expect $inv)"
  $TLC -config "$cfg" -metadir "states/$(basename "$cfg" .cfg)" StimgraphAuth.tla >"$out" 2>&1 || true
  if ! grep -q "Invariant $inv is violated" "$out"; then
    echo "expected $inv to be violated by $cfg; see $out" >&2
    tail -40 "$out" >&2
    exit 1
  fi
  echo "violated $inv"
}

expect_pass StimgraphAuth.cfg fixed.out
expect_fail mutants/OrphanGrant.cfg InvStoredOrRevoked mutants/OrphanGrant.out
expect_fail mutants/DisconnectOrigin.cfg InvSafeFromCrossSite mutants/DisconnectOrigin.out
expect_fail mutants/InMemoryLock.cfg InvNoImportDeleted mutants/InMemoryLock.out
echo "ok: fixed spec holds; each mutant fails on the expected invariant."
