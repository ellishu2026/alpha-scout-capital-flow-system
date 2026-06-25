#!/bin/bash
set -euo pipefail

PROJECT_DIR="/Users/ellislunhugmail.com/alpha-scout-capital-flow-system"
LOCK_DIR="/tmp/alphascout_moomoo_daily_collection.lock"

cd "$PROJECT_DIR"

# launchd uses a minimal PATH by default. Add Python/Homebrew paths
# so python3 can find packages such as moomoo.
export PATH="/Library/Frameworks/Python.framework/Versions/3.12/bin:/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/sbin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

mkdir -p logs
LOG_FILE="logs/moomoo_daily_collection_$(date +%Y-%m-%d).log"

exec >> "$LOG_FILE" 2>&1

echo ""
echo "============================================================"
echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Start Moomoo daily collection automation"
echo "Project: $PROJECT_DIR"
echo "PATH=$PATH"
echo "python3=$(command -v python3 || true)"
python3 -c "import sys; print('python executable=' + sys.executable); import moomoo; print('moomoo import ok')"
echo "============================================================"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another moomoo daily collection is already running. Exit."
  exit 0
fi

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

set -a
if [ -f ".env.local" ]; then
  source ".env.local"
fi
set +a

MAX_ATTEMPTS=3
ATTEMPT=1
STATUS=1
RETRY_SLEEP_SECONDS=90

while [ "$ATTEMPT" -le "$MAX_ATTEMPTS" ]; do
  echo ""
  echo "---- collector attempt $ATTEMPT / $MAX_ATTEMPTS ----"

  ATTEMPT_LOG="$(mktemp /tmp/alphascout_moomoo_attempt.XXXXXX.log)"

  set +e
  /usr/bin/caffeinate -dimsu bash scripts/run_moomoo_daily_collection.sh 2>&1 | tee "$ATTEMPT_LOG"
  RUN_STATUS=${PIPESTATUS[0]}
  set -e

  if [ "$RUN_STATUS" -eq 0 ] \
    && grep -q "PASS latestDayCollectionRowsSaved" "$ATTEMPT_LOG" \
    && grep -q "PASS savedCount" "$ATTEMPT_LOG" \
    && ! grep -q "FAIL " "$ATTEMPT_LOG" \
    && ! grep -q "Network interruption" "$ATTEMPT_LOG"; then
    STATUS=0
    echo "---- collector attempt $ATTEMPT succeeded ----"
    rm -f "$ATTEMPT_LOG"
    break
  fi

  STATUS=1
  echo "---- collector attempt $ATTEMPT failed logical validation ----"
  echo "RUN_STATUS=$RUN_STATUS"
  echo "Reason: missing PASS rows, found FAIL, or found Network interruption."

  rm -f "$ATTEMPT_LOG"

  if [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; then
    echo "Retrying in $RETRY_SLEEP_SECONDS seconds..."
    sleep "$RETRY_SLEEP_SECONDS"
  fi

  ATTEMPT=$((ATTEMPT + 1))
done

echo "============================================================"
echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] End Moomoo daily collection automation status=$STATUS"
echo "============================================================"

exit "$STATUS"
