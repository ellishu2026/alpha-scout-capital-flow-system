#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

COLLECTOR_OUT="/tmp/alphascout_moomoo_daily_collector.out"
REFRESH_OUT="/tmp/alphascout_refresh_daily.out"

print_fail() {
  echo "---- daily collector status ----"
  echo "FAIL $1"
  echo "NO_TRADING_API_USED = true"
}

if [[ ! -f ".env.local" ]]; then
  print_fail ".env.local not found"
  exit 2
fi

set -a
# shellcheck disable=SC1091
source ".env.local"
set +a

PRODUCTION_URL="${ALPHASCOUT_PRODUCTION_URL:-https://alpha-scout-capital-flow-system.vercel.app}"

missing=()
if [[ -z "${MOOMOO_INGEST_TOKEN:-}" ]]; then
  missing+=("MOOMOO_INGEST_TOKEN")
fi
if [[ -z "${ALPHASCOUT_REFRESH_TOKEN:-}" ]]; then
  missing+=("ALPHASCOUT_REFRESH_TOKEN")
fi

if (( ${#missing[@]} > 0 )); then
  print_fail "missingEnv = ${missing[*]}"
  exit 2
fi

echo "---- running moomoo daily collector ----"
python3 scripts/moomoo_collect_and_upload.py --auto-universe --backfill-days 4 | tee "$COLLECTOR_OUT"

echo "---- production refresh verification ----"
curl -s "${PRODUCTION_URL}/api/cron/refresh" \
  -H "Authorization: Bearer ${ALPHASCOUT_REFRESH_TOKEN}" \
  -o "$REFRESH_OUT" \
  -w "HTTP_CODE=%{http_code}\nCONTENT_TYPE=%{content_type}\nTIME_TOTAL=%{time_total}\nSIZE=%{size_download}\n"

echo "---- moomoo coverage summary ----"
python3 - "$COLLECTOR_OUT" "$REFRESH_OUT" <<'PY'
import json
import sys

collector_path, refresh_path = sys.argv[1], sys.argv[2]


def load_collector_summary(path):
    text = open(path, encoding="utf-8").read()
    marker = "---- upload summary ----"
    status_marker = "---- daily collector status ----"
    if marker not in text:
        return {}
    block = text.split(marker, 1)[1]
    if status_marker in block:
        block = block.split(status_marker, 1)[0]
    block = block.strip()
    if not block:
        return {}
    return json.loads(block)


def nested_get(data, keys):
    for key in keys:
        if not isinstance(data, dict):
            return None
        data = data.get(key)
    return data


collector = load_collector_summary(collector_path)
refresh = json.load(open(refresh_path, encoding="utf-8"))
snapshot = refresh.get("snapshot") if isinstance(refresh.get("snapshot"), dict) else {}
refresh_summary = (
    refresh.get("moomooArchiveCoverageSummary")
    or snapshot.get("moomooArchiveCoverageSummary")
    or refresh.get("moomooCoverageSummary")
    or snapshot.get("moomooCoverageSummary")
    or refresh.get("estimatedFlowProxyDisplaySummary")
    or snapshot.get("estimatedFlowProxyDisplaySummary")
    or {}
)

fields = {
    "latestCompletedMarketDate": collector.get("latestCompletedMarketDate"),
    "finalTickerCount": collector.get("finalTickerCount"),
    "savedCount": collector.get("savedCount"),
    "moomooArchiveTickerCount": refresh_summary.get("moomooArchiveTickerCount")
    or refresh.get("moomooArchiveTickerCount")
    or snapshot.get("moomooArchiveTickerCount"),
    "moomooDirectFlowAvailableCount": refresh_summary.get("moomooDirectFlowAvailableCount")
    or refresh.get("moomooDirectFlowAvailableCount")
    or snapshot.get("moomooDirectFlowAvailableCount"),
    "moomooFallbackCount": refresh_summary.get("moomooFallbackCount")
    or refresh.get("moomooFallbackCount")
    or snapshot.get("moomooFallbackCount"),
    "dateCoverage": collector.get("dateCoverage")
    or refresh_summary.get("moomooArchiveDateCoverage")
    or refresh.get("moomooArchiveDateCoverage")
    or snapshot.get("moomooArchiveDateCoverage"),
    "historicalBackfillSupported": collector.get("historicalBackfillSupported"),
    "historicalRowsSaved": collector.get("historicalRowsSaved"),
}

for key, value in fields.items():
    print(f"{key}: {value}")

items = nested_get(refresh, ["snapshot", "items"]) or refresh.get("items") or []
if items:
    moomoo_rows = [
        item for item in items
        if item.get("moomooFlowAvailable") or item.get("flow1DSource") == "Moomoo Direct Flow"
    ]
    print(f"visibleMoomooRows: {len(moomoo_rows)} / {len(items)}")
PY
