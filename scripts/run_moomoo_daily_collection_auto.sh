#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/Users/ellislunhugmail.com/alpha-scout-capital-flow-system"
LOCK_DIR="/tmp/alphascout_moomoo_daily_collection.lock"

cd "$PROJECT_DIR"

# launchd uses a minimal PATH by default. Add Homebrew and common Python paths
# so python3 can find packages such as moomoo.
export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/sbin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

echo "PATH=$PATH"
echo "python3=$(command -v python3 || true)"
python3 -c "import sys; print('python executable=' + sys.executable)"

mkdir -p logs

LOG_FILE="logs/moomoo_daily_collection_$(date +%Y-%m-%d).log"
exec >> "$LOG_FILE" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Start Moomoo daily collection automation"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another moomoo daily collection is already running. Exit."
  exit 0
fi

cleanup() {
  local status=$?
  rmdir "$LOCK_DIR" 2>/dev/null || true
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] End Moomoo daily collection automation status=${status}"
  exit "$status"
}
trap cleanup EXIT

if [[ -f ".env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.local"
  set +a
fi

MAX_ATTEMPTS=3
ATTEMPT=1
STATUS=1

while [ "$ATTEMPT" -le "$MAX_ATTEMPTS" ]; do
  echo "---- collector attempt $ATTEMPT / $MAX_ATTEMPTS ----"

  if /usr/bin/caffeinate -dimsu bash scripts/run_moomoo_daily_collection.sh; then
    STATUS=0
    echo "---- collector attempt $ATTEMPT succeeded ----"
    break
  fi

  STATUS=$?
  echo "---- collector attempt $ATTEMPT failed with status=$STATUS ----"

  if [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; then
    echo "Retrying in 20 seconds..."
    sleep 20
  fi

  ATTEMPT=$((ATTEMPT + 1))
done

exit "$STATUS"
