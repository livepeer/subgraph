#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Usage: $0 <studio-slug> <version-label> <deploy-key>" >&2
  exit 1
fi

STUDIO_SLUG="$1"
VERSION_LABEL="$2"
DEPLOY_KEY="$3"

LOG_FILE="$(mktemp)"
cleanup() {
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

set -o pipefail
npx graph deploy --studio "$STUDIO_SLUG" --version-label "$VERSION_LABEL" --deploy-key "$DEPLOY_KEY" | tee "$LOG_FILE"

STUDIO_QUERY_URL="$(grep -Eo 'https://api\.studio\.thegraph\.com/query/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9._-]+' "$LOG_FILE" | tail -n 1 || true)"

if [ -n "$STUDIO_QUERY_URL" ] && [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "studio_query_url=$STUDIO_QUERY_URL" >> "$GITHUB_OUTPUT"
elif [ -z "$STUDIO_QUERY_URL" ]; then
  echo "Warning: Could not parse Studio query URL from deploy output." >&2
fi
