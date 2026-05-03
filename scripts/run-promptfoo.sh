#!/usr/bin/env bash
# Entry script for the builder-language eval suite.
#
# Usage:
#   ./scripts/run-promptfoo.sh                       # full run
#   ./scripts/run-promptfoo.sh --filter-providers haiku    # subset
#   PROMPTFOO_REPEAT=3 ./scripts/run-promptfoo.sh    # 3 runs per cell

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Load env from repo root if present.
load_env() {
  local f="$1"
  if [[ -f "$f" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$f"
    set +a
  fi
}
load_env "${REPO_ROOT}/.env"
load_env "${REPO_ROOT}/.env.local"

: "${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is required}"
: "${GEMINI_API_KEY:?GEMINI_API_KEY is required}"

mkdir -p "${REPO_ROOT}/artifacts"

CONFIG="${1:-${REPO_ROOT}/promptfoo/main.yaml}"
shift || true

cd "${REPO_ROOT}"

# Promptfoo writes results to ./artifacts/promptfoo-results.html (per config)
# plus a JSON log that the report script reads.
exec bunx promptfoo eval -c "${CONFIG}" \
  --output "${REPO_ROOT}/artifacts/results.json" \
  "$@"
