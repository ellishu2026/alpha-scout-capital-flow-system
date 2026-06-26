#!/usr/bin/env python3
"""Read-only Moomoo archive gap detector.

This script reports recent fixed-list Moomoo archive coverage only. It does not
call Moomoo APIs, attempt historical backfill, or write production data.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = PROJECT_ROOT / ".env.local"
LOCAL_OVERLAY_FILE = PROJECT_ROOT / "data/research/moomoo_daily_collector_overlay_v2021.json"
LOCAL_XLSX_FILE = PROJECT_ROOT / "data/imports/moomoo/net_inflow_from_moomoo.xlsx"
US_EASTERN_TZ = ZoneInfo("America/New_York")

FIXED_LIST = ["SOXL", "SMH", "NVDA", "MSFT", "GOOGL", "ORCL", "RKLB", "LLY", "IONQ"]
MOOMOO_PROVIDERS = [
    "MOOMOO_CAPITAL_DISTRIBUTION",
    "MOOMOO_CAPITAL_DISTRIBUTION_ARCHIVE",
    "MOOMOO_CAPITAL_FLOW_ARCHIVE",
    "MOOMOO_HISTORICAL_XLSX_IMPORT",
]
FLOW_PROVIDER_PRIORITY = {
    "MOOMOO_CAPITAL_DISTRIBUTION": 3,
    "MOOMOO_CAPITAL_DISTRIBUTION_ARCHIVE": 3,
    "MOOMOO_CAPITAL_FLOW_ARCHIVE": 3,
    "MOOMOO_HISTORICAL_XLSX_IMPORT": 2,
}


def load_env(path: Path = ENV_FILE) -> None:
    if not path.exists():
        return

    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def observed_date(month: int, day: int, year: int) -> dt.date:
    holiday = dt.date(year, month, day)
    if holiday.weekday() == 5:
        return holiday - dt.timedelta(days=1)
    if holiday.weekday() == 6:
        return holiday + dt.timedelta(days=1)
    return holiday


def nth_weekday(year: int, month: int, weekday: int, n: int) -> dt.date:
    current = dt.date(year, month, 1)
    while current.weekday() != weekday:
        current += dt.timedelta(days=1)
    return current + dt.timedelta(days=7 * (n - 1))


def last_weekday(year: int, month: int, weekday: int) -> dt.date:
    if month == 12:
        current = dt.date(year + 1, 1, 1) - dt.timedelta(days=1)
    else:
        current = dt.date(year, month + 1, 1) - dt.timedelta(days=1)
    while current.weekday() != weekday:
        current -= dt.timedelta(days=1)
    return current


def easter_date(year: int) -> dt.date:
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return dt.date(year, month, day)


def us_market_holidays(year: int) -> set[dt.date]:
    return {
        observed_date(1, 1, year),
        nth_weekday(year, 1, 0, 3),
        nth_weekday(year, 2, 0, 3),
        easter_date(year) - dt.timedelta(days=2),
        last_weekday(year, 5, 0),
        observed_date(6, 19, year),
        observed_date(7, 4, year),
        nth_weekday(year, 9, 0, 1),
        nth_weekday(year, 11, 3, 4),
        observed_date(12, 25, year),
    }


def is_us_trading_day(day: dt.date) -> bool:
    return day.weekday() < 5 and day not in us_market_holidays(day.year)


def latest_completed_market_date(now: dt.datetime | None = None) -> dt.date:
    current = now.astimezone(US_EASTERN_TZ) if now else dt.datetime.now(US_EASTERN_TZ)
    candidate = current.date()
    if not is_us_trading_day(candidate) or current.time() < dt.time(16, 15):
        candidate -= dt.timedelta(days=1)
    while not is_us_trading_day(candidate):
        candidate -= dt.timedelta(days=1)
    return candidate


def recent_trading_days(latest: dt.date, count: int) -> list[str]:
    current = latest
    days: list[str] = []
    while len(days) < count:
        if is_us_trading_day(current):
            days.append(current.isoformat())
        current -= dt.timedelta(days=1)
    return list(reversed(days))


def to_float(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def supabase_configured() -> bool:
    return bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY"))


def supabase_get(table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    query = urllib.parse.urlencode(params, safe="(),.*")
    request = urllib.request.Request(
        f"{url}/rest/v1/{table}?{query}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def row_flow_date(row: dict[str, Any], payload: dict[str, Any]) -> str:
    distribution = payload.get("distribution") if isinstance(payload.get("distribution"), dict) else payload
    return str(
        distribution.get("flowDate")
        or distribution.get("flow_date")
        or distribution.get("date")
        or row.get("data_date")
        or ""
    )[:10]


def row_has_flow(row: dict[str, Any], payload: dict[str, Any]) -> bool:
    distribution = payload.get("distribution") if isinstance(payload.get("distribution"), dict) else payload
    return (
        to_float(distribution.get("netFlow")) is not None
        or to_float(distribution.get("net_flow")) is not None
        or to_float(distribution.get("in_flow")) is not None
    )


def build_coverage(rows: list[dict[str, Any]]) -> dict[str, set[str]]:
    selected: dict[tuple[str, str], str] = {}
    for row in rows:
        ticker = str(row.get("ticker") or "").upper()
        provider = str(row.get("provider") or "")
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        date = row_flow_date(row, payload)
        if (
            ticker not in FIXED_LIST
            or provider not in MOOMOO_PROVIDERS
            or not date
            or not row_has_flow(row, payload)
        ):
            continue
        key = (ticker, date)
        existing = selected.get(key)
        if existing is None or FLOW_PROVIDER_PRIORITY[provider] >= FLOW_PROVIDER_PRIORITY[existing]:
            selected[key] = provider

    coverage: dict[str, set[str]] = {}
    for ticker, date in selected:
        coverage.setdefault(date, set()).add(ticker)
    return coverage


def fetch_supabase_coverage(start_date: str) -> tuple[dict[str, set[str]], list[str]]:
    ticker_filter = f"in.({','.join(FIXED_LIST)})"
    provider_filter = f"in.({','.join(MOOMOO_PROVIDERS)})"
    rows = supabase_get(
        "alpha_scout_market_data_archive",
        {
            "select": "ticker,provider,data_date,payload",
            "ticker": ticker_filter,
            "provider": provider_filter,
            "data_date": f"gte.{start_date}",
            "limit": "10000",
        },
    )
    return build_coverage(rows), []


def local_overlay_coverage() -> tuple[dict[str, set[str]], list[str]]:
    diagnostics: list[str] = []
    rows: list[dict[str, Any]] = []

    if LOCAL_OVERLAY_FILE.exists():
        payload = json.loads(LOCAL_OVERLAY_FILE.read_text(encoding="utf-8"))
        for row in payload.get("rows", []):
            if not isinstance(row, dict):
                continue
            rows.append({
                "ticker": row.get("ticker"),
                "provider": row.get("provider") or payload.get("source"),
                "data_date": row.get("date"),
                "payload": {
                    "date": row.get("date"),
                    "netFlow": row.get("netFlow"),
                },
            })
    else:
        diagnostics.append(f"localArchiveFileMissing={LOCAL_OVERLAY_FILE.relative_to(PROJECT_ROOT)}")

    if not LOCAL_XLSX_FILE.exists():
        diagnostics.append(f"localManualXlsxMissing={LOCAL_XLSX_FILE.relative_to(PROJECT_ROOT)}")
    else:
        try:
            sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
            from import_moomoo_net_inflow_xlsx import (  # noqa: PLC0415
                SHEET_NAME,
                normalize_row,
                read_xlsx_rows,
            )

            for record in read_xlsx_rows(LOCAL_XLSX_FILE, SHEET_NAME):
                normalized = normalize_row(record)
                if not normalized:
                    continue
                rows.append({
                    "ticker": normalized["ticker"],
                    "provider": "MOOMOO_HISTORICAL_XLSX_IMPORT",
                    "data_date": normalized["date"],
                    "payload": {
                        "date": normalized["date"],
                        "netFlow": normalized["netFlow"],
                    },
                })
        except Exception as exc:  # noqa: BLE001 - local diagnostic fallback only
            diagnostics.append(f"localManualXlsxReadFailed={exc}")

    return build_coverage(rows), diagnostics


def format_list(values: list[str]) -> str:
    return ",".join(values) if values else "[]"


def maybe_write_report(summary_lines: list[str], enabled: bool) -> str | None:
    if not enabled:
        return None
    report_path = PROJECT_ROOT / f"logs/moomoo_archive_gap_report_{dt.date.today().isoformat()}.txt"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")
    return str(report_path.relative_to(PROJECT_ROOT))


def main() -> int:
    parser = argparse.ArgumentParser(description="Check recent Moomoo archive coverage gaps.")
    parser.add_argument("--lookback-trading-days", type=int, default=10)
    parser.add_argument("--expected-minimum-rows", type=int, default=None)
    parser.add_argument("--write-report", action="store_true")
    args = parser.parse_args()

    load_env()
    lookback = max(1, args.lookback_trading_days)
    latest = latest_completed_market_date()
    days = recent_trading_days(latest, lookback)
    expected_minimum = max(args.expected_minimum_rows or len(FIXED_LIST), len(FIXED_LIST))
    diagnostics: list[str] = []
    archive_data_source = "SUPABASE_REST" if supabase_configured() else "LOCAL_PROJECT_FILES"
    status = "PASS"

    try:
        if supabase_configured():
            coverage, diagnostics = fetch_supabase_coverage(days[0])
        else:
            coverage, diagnostics = local_overlay_coverage()
            diagnostics.append("SUPABASE_ENV_MISSING: using local project archive files only.")
            if not coverage:
                status = "UNKNOWN_ARCHIVE_UNAVAILABLE"
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        coverage = {}
        diagnostics.append(f"archiveQueryFailed={exc}")
        status = "UNKNOWN_ARCHIVE_QUERY_FAILED"

    coverage_counts = {day: len(coverage.get(day, set())) for day in days}
    missing_dates = [day for day, count in coverage_counts.items() if count == 0]
    partial_dates = [
        {"date": day, "rows": count}
        for day, count in coverage_counts.items()
        if 0 < count < expected_minimum
    ]

    if status == "PASS" and (missing_dates or partial_dates):
        status = "GAPS_DETECTED"

    summary_lines = [
        "MOOMOO_ARCHIVE_GAP_CHECK",
        f"latestCompletedMarketDate = {latest.isoformat()}",
        f"lookbackTradingDays = {lookback}",
        f"expectedMinimumRows = {expected_minimum}",
        f"fixedCount = {len(FIXED_LIST)}",
        f"calendarMode = US_MARKET_HOLIDAY_CALENDAR",
        f"archiveDataSource = {archive_data_source}",
        f"coverageCounts = {json.dumps(coverage_counts, sort_keys=True)}",
        f"missingDates = {format_list(missing_dates)}",
        f"partialDates = {json.dumps(partial_dates)}",
        f"status = {status}",
    ]

    if diagnostics:
        summary_lines.append(f"diagnostics = {json.dumps(diagnostics)}")

    if missing_dates or partial_dates:
        summary_lines.extend([
            f"MISSING_MOOMOO_DATES = {format_list(missing_dates)}",
            "GAP_REMEDIATION_SCHEME = B",
            "Recommended actions:",
            "1. Leave date marked as missing.",
            "2. Use manual Moomoo XLSX export/import if available.",
            "3. Optionally use OHLCV proxy fallback in future research mode, clearly labeled as OHLCV_PROXY, not MOOMOO_DIRECT.",
        ])

    report_path = maybe_write_report(summary_lines, args.write_report)
    if report_path:
        summary_lines.append(f"reportFile = {report_path}")

    print("\n".join(summary_lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
