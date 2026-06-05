# Moomoo Daily Collector Checklist

This checklist runs the Moomoo Direct Flow archive workflow for the current AlphaScout scoped universe. It does not use trading APIs and does not change Entry / Position actions, scoring, thresholds, or Risk Gate behavior.

## Required Windows

1. Moomoo OpenD
   - Confirm status is `Connected`.
   - Confirm API port is `11111`.
   - Keep OpenD running while the collector runs.

2. Mac Terminal
   ```bash
   cd ~/alpha-scout-capital-flow-system
   ```

## Required Environment Variables

Load `.env.local` and confirm these variables exist:

- `MOOMOO_INGEST_TOKEN`
- `ALPHASCOUT_REFRESH_TOKEN`

Do not print token values.

## Daily Command

```bash
set -a
source .env.local
set +a

python3 scripts/moomoo_collect_and_upload.py --auto-universe --backfill-days 4
```

Manual test commands remain available:

```bash
python3 scripts/moomoo_collect_and_upload.py --auto-universe --backfill-days 4
python3 scripts/moomoo_collect_and_upload.py --tickers IONQ
python3 scripts/moomoo_collect_and_upload.py --tickers SOXL,SMH,NVDA
```

## One-Command Helper

```bash
bash scripts/run_moomoo_daily_collection.sh
```

The helper script:

- loads `.env.local`
- verifies required tokens are present
- runs the dynamic Moomoo collector with `--auto-universe --backfill-days 4`
- runs production refresh verification
- prints a compact coverage summary

## Production Refresh Verification

```bash
curl -s "https://alpha-scout-capital-flow-system.vercel.app/api/cron/refresh" \
  -H "Authorization: Bearer $ALPHASCOUT_REFRESH_TOKEN" \
  -o /tmp/alphascout_refresh_daily.out \
  -w "HTTP_CODE=%{http_code}\nCONTENT_TYPE=%{content_type}\nTIME_TOTAL=%{time_total}\nSIZE=%{size_download}\n"
```

## Coverage Check

If the one-command helper was used, it writes:

- collector output: `/tmp/alphascout_moomoo_daily_collector.out`
- refresh output: `/tmp/alphascout_refresh_daily.out`

Run:

```bash
python3 - <<'PY'
import json

collector_path = "/tmp/alphascout_moomoo_daily_collector.out"
refresh_path = "/tmp/alphascout_refresh_daily.out"

text = open(collector_path, encoding="utf-8").read()
collector = {}
if "---- upload summary ----" in text:
    block = text.split("---- upload summary ----", 1)[1]
    block = block.split("---- daily collector status ----", 1)[0].strip()
    collector = json.loads(block)

refresh = json.load(open(refresh_path, encoding="utf-8"))
snapshot = refresh.get("snapshot") if isinstance(refresh.get("snapshot"), dict) else {}
coverage = (
    refresh.get("moomooArchiveCoverageSummary")
    or snapshot.get("moomooArchiveCoverageSummary")
    or refresh.get("moomooCoverageSummary")
    or snapshot.get("moomooCoverageSummary")
    or refresh.get("estimatedFlowProxyDisplaySummary")
    or snapshot.get("estimatedFlowProxyDisplaySummary")
    or {}
)

for key, value in {
    "moomooArchiveTickerCount": coverage.get("moomooArchiveTickerCount") or refresh.get("moomooArchiveTickerCount") or snapshot.get("moomooArchiveTickerCount"),
    "moomooArchiveDateCoverage": coverage.get("moomooArchiveDateCoverage") or refresh.get("moomooArchiveDateCoverage") or snapshot.get("moomooArchiveDateCoverage"),
    "moomooDirectFlowAvailableCount": coverage.get("moomooDirectFlowAvailableCount") or refresh.get("moomooDirectFlowAvailableCount") or snapshot.get("moomooDirectFlowAvailableCount"),
    "moomooFallbackCount": coverage.get("moomooFallbackCount") or refresh.get("moomooFallbackCount") or snapshot.get("moomooFallbackCount"),
    "maxSymbolsPerRun": coverage.get("maxSymbolsPerRun") or refresh.get("maxSymbolsPerRun") or snapshot.get("maxSymbolsPerRun"),
    "latestCompletedMarketDate": collector.get("latestCompletedMarketDate"),
    "latestDayCollectionRowsSaved": collector.get("latestDayCollectionRowsSaved"),
    "historicalTargetDates": collector.get("historicalTargetDates"),
    "historicalSupportedDates": collector.get("historicalSupportedDates"),
    "historicalFailedDates": collector.get("historicalFailedDates"),
    "historicalReason": collector.get("historicalReason") or collector.get("reason"),
}.items():
    print(f"{key} = {value}")
PY
```

## Status Rules

The collector prints a final block:

```text
---- daily collector status ----
PASS latestDayCollectionRowsSaved = 18
PASS finalTickerCount = 18 <= maxSymbolsPerRun 20
PASS ingestOk = true
PASS savedCount = 18
PASS Moomoo latest-day archive saved
WARNING historicalBackfillSupported = false
INFO historicalTargetDates = [...]
INFO historicalReason = ...
NO_TRADING_API_USED = true
```

Treat the run as successful when latest-day collection passes and `finalTickerCount <= maxSymbolsPerRun`. Historical backfill may show `WARNING` if Moomoo does not return matching prior trading-date rows; latest-day archive coverage is still valid.

Treat the run as failed if:

- required env vars are missing
- `finalTickerCount > maxSymbolsPerRun`
- latest-day collection saves zero rows
- `latestDayCollectionRowsSaved != finalTickerCount`
- `ingestOk = false`

## Safety

- Only `OpenQuoteContext` quote/capital flow access is allowed.
- Do not use `TradeContext`.
- Do not call order, cancel, replace, account, position, or trading APIs.
- Do not expand collection beyond `maxSymbolsPerRun = 20`.
