#!/usr/bin/env bash
# The digest helper must succeed when sha*sum --check is unusable.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VERIFIER="$ROOT/verify-digest.sh"
BASH_BIN="$(command -v bash)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

if grep -n -- '--check' "$VERIFIER" "$ROOT/check-access-model.sh" >/dev/null; then
  echo "digest scripts still call sha*sum --check" >&2
  exit 1
fi

printf 'bookmark-mcp' >"$WORKDIR/sample"
python3 - "$WORKDIR/sample" <<'PY' >"$WORKDIR/expected"
import hashlib
import sys

data = open(sys.argv[1], "rb").read()
print(hashlib.sha256(data).hexdigest())
print(hashlib.sha1(data).hexdigest())
PY
expected_sha256="$(sed -n '1p' "$WORKDIR/expected")"
expected_sha1="$(sed -n '2p' "$WORKDIR/expected")"

"$BASH_BIN" "$VERIFIER" --file "$WORKDIR/sample" --sha256 "$expected_sha256" --sha1 "$expected_sha1"

set +e
"$BASH_BIN" "$VERIFIER" --file "$WORKDIR/sample" --sha256 "0000000000000000000000000000000000000000000000000000000000000000" --sha1 "$expected_sha1" >"$WORKDIR/bad.out" 2>"$WORKDIR/bad.err"
bad_status=$?
set -e
if [[ "$bad_status" -eq 0 ]]; then
  echo "wrong sha256 was accepted" >&2
  exit 1
fi
if grep -q 'bookmark-mcp' "$WORKDIR/bad.out" "$WORKDIR/bad.err"; then
  echo "mismatch output included file bytes" >&2
  exit 1
fi

python3="$(command -v python3)"
mkdir -p "$WORKDIR/bin"

cat >"$WORKDIR/bin/shasum" <<EOF
#!/bin/sh
for arg in "\$@"; do
  case "\$arg" in
    --check|--status|-)
      echo "shasum: --check --status stdin missing -" >&2
      exit 1
      ;;
  esac
done
exec "$python3" - "\$@" <<'PY'
import hashlib
import sys

args = sys.argv[1:]
algo = "256"
if "-a" in args:
    algo = args[args.index("-a") + 1]
path = args[-1]
hasher = hashlib.sha1() if algo == "1" else hashlib.sha256()
with open(path, "rb") as handle:
    hasher.update(handle.read())
print(hasher.hexdigest())
PY
EOF
cat >"$WORKDIR/bin/sha1sum" <<EOF
#!/bin/sh
for arg in "\$@"; do
  case "\$arg" in
    --check|--status|-)
      echo "sha1sum: --check --status stdin missing -" >&2
      exit 1
      ;;
  esac
done
exec "$python3" - "\$@" <<'PY'
import hashlib
import sys

path = sys.argv[-1]
print(hashlib.sha1(open(path, "rb").read()).hexdigest())
PY
EOF
cat >"$WORKDIR/bin/sha256sum" <<EOF
#!/bin/sh
for arg in "\$@"; do
  case "\$arg" in
    --check|--status|-)
      echo "sha256sum: --check --status stdin missing -" >&2
      exit 1
      ;;
  esac
done
exec "$python3" - "\$@" <<'PY'
import hashlib
import sys

path = sys.argv[-1]
print(hashlib.sha256(open(path, "rb").read()).hexdigest())
PY
EOF
chmod +x "$WORKDIR/bin/shasum" "$WORKDIR/bin/sha1sum" "$WORKDIR/bin/sha256sum"

mkdir -p "$WORKDIR/sys"
ln -s "$(command -v awk)" "$WORKDIR/sys/awk"

PATH="$WORKDIR/bin:$WORKDIR/sys" "$BASH_BIN" "$VERIFIER" --file "$WORKDIR/sample" --sha256 "$expected_sha256" --sha1 "$expected_sha1"

mkdir -p "$WORKDIR/noshasum"
cp "$WORKDIR/bin/sha1sum" "$WORKDIR/bin/sha256sum" "$WORKDIR/noshasum/"
PATH="$WORKDIR/noshasum:$WORKDIR/sys" "$BASH_BIN" "$VERIFIER" --file "$WORKDIR/sample" --sha256 "$expected_sha256" --sha1 "$expected_sha1"

mkdir -p "$WORKDIR/pythononly"
ln -s "$python3" "$WORKDIR/pythononly/python3"
PATH="$WORKDIR/pythononly" "$BASH_BIN" "$VERIFIER" --file "$WORKDIR/sample" --sha256 "$expected_sha256" --sha1 "$expected_sha1"
