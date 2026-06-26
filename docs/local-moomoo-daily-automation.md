# Local Moomoo Daily Automation

This local Mac automation wakes the machine at 08:00 local time and runs the existing Moomoo daily collector at 08:30 local time, Tuesday through Saturday. It also schedules one 10:00 backup run on the same days. It keeps Moomoo Direct Flow as the source and only wraps the existing collector with local logging, locking, `launchd`, `caffeinate`, success-skip behavior, and read-only archive gap reporting.

This task does not change production rules, data formulas, collector logic, Moomoo ingest logic, API logic, thresholds, Entry/Position, Risk Gate, scoring, or trading logic.

## Requirements

- Mac must be on or wakeable.
- User session should remain logged in.
- Moomoo OpenD / Moomoo connection should be available.
- Network must be available.
- `.env.local` token must be valid.

## Schedule

- Wake: 08:00 local Mac time.
- Main run: Tuesday-Saturday at 08:30 local Mac time.
- Backup run: Tuesday-Saturday at 10:00 local Mac time.

US market Monday-Friday close corresponds to Singapore Tuesday-Saturday morning. The wake script uses the Mac's current system timezone, so set the Mac timezone to Singapore if you want Singapore 08:00.

The 10:00 backup run uses the same wrapper, `scripts/run_moomoo_daily_collection_auto.sh`. If the 08:30 run already succeeded, the 10:00 run automatically skips and exits 0.

## Skip Guard

Before collector attempts run, the wrapper checks today's log:

```text
logs/moomoo_daily_collection_YYYY-MM-DD.log
```

If the log already contains all success markers below, the wrapper prints `SKIP: Moomoo daily collection already succeeded today.` and exits 0 without running the collector again:

```text
PASS latestDayCollectionRowsSaved
PASS savedCount
End Moomoo daily collection automation status=0
```

Earlier failed runs do not trigger the skip guard unless the final success markers are also present.

## Gap Detection

After a successful collector run, the wrapper runs:

```bash
python3 scripts/check_moomoo_archive_gaps.py --lookback-trading-days 10
```

The checker is read-only. It checks recent Moomoo archive coverage for the fixed list, excludes US market holidays/weekends, and prints:

```text
MOOMOO_ARCHIVE_GAP_CHECK
latestCompletedMarketDate
lookbackTradingDays
expectedMinimumRows
missingDates
partialDates
status
```

If the checker fails, the wrapper prints `WARN: gap detector failed` but keeps the collection success status.

## Gap Remediation Scheme B

Detected gaps are reported only.

- No automatic Moomoo historical backfill.
- No Moomoo historical capital distribution API calls.
- Missing dates remain marked as missing.
- Recovery options are manual Moomoo XLSX export/import if available, or a future research-only OHLCV proxy fallback clearly labeled `OHLCV_PROXY`, not `MOOMOO_DIRECT`.

## Setup

```bash
bash scripts/setup_mac_wake_0800.sh
bash scripts/setup_moomoo_daily_launchd.sh
```

## Manual Test

```bash
bash scripts/run_moomoo_daily_collection_auto.sh
tail -180 logs/moomoo_daily_collection_$(date +%Y-%m-%d).log
```

## launchd Test

```bash
launchctl kickstart -k gui/$(id -u)/com.ellis.alphascout.moomoo-daily
```

## Stop Automation

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.ellis.alphascout.moomoo-daily.plist
```

## Cancel Wake Schedule

```bash
sudo pmset repeat cancel
```

## Validation Success Examples

```text
PASS ingestOk = true
PASS latestDayCollectionRowsSaved = 18
PASS savedCount = 18
PASS Moomoo latest-day archive saved
End Moomoo daily collection automation status=0
HTTP_CODE=200
```
