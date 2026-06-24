# Local Moomoo Daily Automation

This local Mac automation wakes the machine at 08:00 local time and runs the existing Moomoo daily collector at 08:30 local time, Tuesday through Saturday. It keeps Moomoo Direct Flow as the source and only wraps the existing collector with local logging, locking, `launchd`, and `caffeinate`.

This task does not change production rules, data formulas, collector logic, Moomoo ingest logic, API logic, thresholds, Entry/Position, Risk Gate, scoring, or trading logic.

## Requirements

- Mac must be on or wakeable.
- User session should remain logged in.
- Moomoo OpenD / Moomoo connection should be available.
- Network must be available.
- `.env.local` token must be valid.

## Schedule

- Wake: 08:00 local Mac time.
- Run: Tuesday-Saturday at 08:30 local Mac time.

US market Monday-Friday close corresponds to Singapore Tuesday-Saturday morning. The wake script uses the Mac's current system timezone, so set the Mac timezone to Singapore if you want Singapore 08:00.

## Setup

```bash
bash scripts/setup_mac_wake_0800.sh
bash scripts/setup_moomoo_daily_launchd.sh
```

## Manual Test

```bash
bash scripts/run_moomoo_daily_collection_auto.sh
tail -120 logs/moomoo_daily_collection_$(date +%Y-%m-%d).log
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
PASS Moomoo latest-day archive saved
HTTP_CODE=200
```
