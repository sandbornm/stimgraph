#!/usr/bin/env bash
# Check a file against pinned digests. Hash the file path. Do not hash a stdin stream.
# The v1.7.4 release notes publish a SHA-1 for tla2tools.jar and do not publish a SHA-256.
# Pass both pins. The SHA-256 is the digest of the jar whose SHA-1 matches that release note.
set -euo pipefail

usage() {
  echo "usage: verify-digest.sh --file PATH --sha256 HEX [--sha1 HEX]" >&2
  exit 2
}

file=""
expected_sha256=""
expected_sha1=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)
      file="${2:-}"
      shift 2
      ;;
    --sha256)
      expected_sha256="${2:-}"
      shift 2
      ;;
    --sha1)
      expected_sha1="${2:-}"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

if [[ -z "$file" || -z "$expected_sha256" || ! -f "$file" ]]; then
  usage
fi

digest_hex() {
  local algo="$1"
  local target="$2"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a "$algo" "$target" | awk 'NR==1 { print $1 }'
    return
  fi
  if [[ "$algo" == "256" ]] && command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$target" | awk 'NR==1 { print $1 }'
    return
  fi
  if [[ "$algo" == "1" ]] && command -v sha1sum >/dev/null 2>&1; then
    sha1sum "$target" | awk 'NR==1 { print $1 }'
    return
  fi
  python3 - "$algo" "$target" <<'PY'
import hashlib
import sys

algo, path = sys.argv[1], sys.argv[2]
hasher = hashlib.sha1() if algo == "1" else hashlib.sha256()
with open(path, "rb") as handle:
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        hasher.update(chunk)
print(hasher.hexdigest())
PY
}

actual_sha256="$(digest_hex 256 "$file")"
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  echo "sha256 mismatch" >&2
  exit 1
fi
if [[ -n "$expected_sha1" ]]; then
  actual_sha1="$(digest_hex 1 "$file")"
  if [[ "$actual_sha1" != "$expected_sha1" ]]; then
    echo "sha1 mismatch" >&2
    exit 1
  fi
fi
