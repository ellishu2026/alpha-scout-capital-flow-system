#!/usr/bin/env python3
"""Validate fixed-list Moomoo XLSX flow windows and optional refresh output.

This script is diagnostic only. It reads the manually exported Moomoo XLSX file
and never imports, uploads, refreshes, trades, or calls provider APIs.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from import_moomoo_net_inflow_xlsx import (
    DEFAULT_FILE,
    FIXED_LIST,
    SHEET_NAME,
    WINDOWS,
    fixed_window_preview,
    is_us_trading_day,
    normalize_row,
    previous_trading_window,
    read_xlsx_rows,
)

EXPECTED_PROVIDER = "MOOMOO_HISTORICAL_XLSX_IMPORT"
EXPECTED_SOURCE = "Moomoo Historical XLSX Import"
EXPECTED_FLOW_SOURCE = "Moomoo Direct Flow"
EXPECTED_TIER = "MOOMOO_DIRECT_CAPITAL_FLOW"
EXPECTED_TIER_LABEL = "Moomoo Direct Capital Flow"
WINDOW_FIELD_MAP = {
    "1D": "capitalFlow1D",
    "3D": "capitalFlow3D",
    "5D": "capitalFlow5D",
    "10D": "capitalFlow10D",
    "20D": "capitalFlow20D",
    "5W": "capitalFlow5W",
    "6W": "capitalFlow6W",
    "9W": "capitalFlow9W",
    "12W": "capitalFlow12W",
}


def trading_dates_between(start: str, end: str) -> list[str]:
    import datetime as dt

    current = dt.date.fromisoformat(start)
    final = dt.date.fromisoformat(end)
    dates: list[str] = []
    while current <= final:
        if is_us_trading_day(current):
            dates.append(current.isoformat())
        current += dt.timedelta(days=1)
    return dates


def finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def direction(value: float | None) -> str:
    if value is None:
        return "Unknown"
    if value > 0:
        return "Positive"
    if value < 0:
        return "Negative"
    return "Neutral"


def format_missing(missing: list[str]) -> dict[str, Any]:
    return {
        "count": len(missing),
        "dates": missing[:20],
        "truncated": len(missing) > 20,
    }


def load_import_rows(file_path: Path, sheet_name: str, end_date: str) -> dict[str, Any]:
    raw_records = read_xlsx_rows(file_path, sheet_name)
    normalized = [row for row in (normalize_row(record) for record in raw_records) if row]
    fixed_set = set(FIXED_LIST)
    rows_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    duplicates: list[dict[str, str]] = []
    skipped_non_fixed = 0
    skipped_after_end = 0

    for row in normalized:
        if row["ticker"] not in fixed_set:
            skipped_non_fixed += 1
            continue
        if row["date"] > end_date:
            skipped_after_end += 1
            continue
        key = (row["ticker"], row["date"])
        if key in rows_by_key:
            duplicates.append({"ticker": row["ticker"], "date": row["date"]})
        rows_by_key[key] = row

    rows = sorted(
        rows_by_key.values(),
        key=lambda row: (row["date"], FIXED_LIST.index(row["ticker"])),
    )
    return {
        "rawRecords": raw_records,
        "rows": rows,
        "duplicates": duplicates,
        "skippedNonFixed": skipped_non_fixed,
        "skippedAfterEnd": skipped_after_end,
    }


def build_validation(rows: list[dict[str, Any]], end_date: str) -> dict[str, Any]:
    by_ticker: dict[str, dict[str, float]] = {ticker: {} for ticker in FIXED_LIST}
    for row in rows:
        by_ticker.setdefault(row["ticker"], {})[row["date"]] = row["netFlow"]

    dates = [row["date"] for row in rows]
    date_min = min(dates) if dates else None
    date_max = max(dates) if dates else None
    expected_dates = trading_dates_between(date_min, end_date) if date_min else []
    preview = fixed_window_preview(rows, end_date)
    preview_by_ticker = {item["ticker"]: item for item in preview}

    missing_by_ticker: dict[str, Any] = {}
    ticker_reports: list[dict[str, Any]] = []
    for ticker in FIXED_LIST:
        date_map = by_ticker.get(ticker, {})
        missing = [day for day in expected_dates if day not in date_map]
        missing_by_ticker[ticker] = format_missing(missing)
        preview_item = preview_by_ticker.get(ticker, {"ticker": ticker})
        windows = {label: preview_item.get(label) for label in WINDOWS}
        source_coverage = preview_item.get("sourceCoveragePct")
        ticker_reports.append({
            "ticker": ticker,
            "rowCount": len(date_map),
            "dateMin": min(date_map) if date_map else None,
            "dateMax": max(date_map) if date_map else None,
            "missingTradingDateCount": len(missing),
            "windows": windows,
            "sourceCoveragePct": source_coverage,
            "source": EXPECTED_SOURCE,
            "providerUsed": EXPECTED_PROVIDER,
            "flowDataTier": EXPECTED_TIER,
            "flowDataTierLabel": EXPECTED_TIER_LABEL,
        })

    full_windows = all(
        all(report["windows"].get(label) is not None for label in WINDOWS)
        for report in ticker_reports
    )
    no_missing = all(item["count"] == 0 for item in missing_by_ticker.values())
    return {
        "dateMin": date_min,
        "dateMax": date_max,
        "expectedTradingDateCount": len(expected_dates),
        "missingRowsByTicker": missing_by_ticker,
        "windowValidationStatus": "PASS" if full_windows else "WARNING_MISSING_WINDOW_ROWS",
        "sourceValidationStatus": "PASS_LOCAL_XLSX_AUTHORITATIVE_SOURCE",
        "coverageStatus": "PASS" if no_missing else "WARNING_MISSING_TRADING_DATES",
        "tickerReports": ticker_reports,
    }


def refresh_items(refresh_json_path: str | None) -> list[dict[str, Any]]:
    if not refresh_json_path:
        return []
    with open(refresh_json_path) as file:
        payload = json.load(file)
    return (
        ((payload.get("snapshot") or {}).get("fixedSnapshot") or {}).get("items")
        or ((payload.get("fixedSnapshot") or {}).get("items"))
        or []
    )


def compare_refresh(
    items: list[dict[str, Any]],
    ticker_reports: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not items:
        return None
    expected_by_ticker = {report["ticker"]: report for report in ticker_reports}
    item_by_ticker = {str(item.get("ticker") or "").upper(): item for item in items}
    mismatches: list[dict[str, Any]] = []
    source_errors: list[dict[str, Any]] = []
    order = [str(item.get("ticker") or "").upper() for item in items]

    for ticker in FIXED_LIST:
        item = item_by_ticker.get(ticker)
        if not item:
            mismatches.append({"ticker": ticker, "reason": "MISSING_FROM_REFRESH"})
            continue
        expected = expected_by_ticker[ticker]["windows"]
        for label, field in WINDOW_FIELD_MAP.items():
            actual_value = finite_number(item.get(field))
            expected_value = finite_number(expected.get(label))
            if actual_value is None or expected_value is None or abs(actual_value - expected_value) > 0.5:
                mismatches.append({
                    "ticker": ticker,
                    "window": label,
                    "expected": expected_value,
                    "actual": actual_value,
                })
        if item.get("flow1DSource") != EXPECTED_FLOW_SOURCE:
            source_errors.append({
                "ticker": ticker,
                "field": "flow1DSource",
                "expected": EXPECTED_FLOW_SOURCE,
                "actual": item.get("flow1DSource"),
            })
        if item.get("moomooFlowSource") != EXPECTED_SOURCE:
            source_errors.append({
                "ticker": ticker,
                "field": "moomooFlowSource",
                "expected": EXPECTED_SOURCE,
                "actual": item.get("moomooFlowSource"),
            })
        if item.get("providerUsed") != EXPECTED_PROVIDER:
            source_errors.append({
                "ticker": ticker,
                "field": "providerUsed",
                "expected": EXPECTED_PROVIDER,
                "actual": item.get("providerUsed"),
            })

    return {
        "fixedSnapshotCount": len(items),
        "fixedSnapshotOrder": order,
        "fixedSnapshotOrderStatus": "PASS" if order == FIXED_LIST else "FAIL",
        "windowComparisonStatus": "PASS" if not mismatches else "FAIL",
        "sourcePrecedenceStatus": "PASS" if not source_errors else "FAIL",
        "windowMismatches": mismatches,
        "sourceErrors": source_errors,
    }


def signal_review(items: list[dict[str, Any]], ticker_reports: list[dict[str, Any]]) -> dict[str, Any]:
    by_ticker = {report["ticker"]: report["windows"] for report in ticker_reports}
    ranked = {}
    for label in ("1D", "3D", "5D", "20D"):
        ranked[label] = sorted(
            [
                {"ticker": ticker, "value": finite_number(windows.get(label))}
                for ticker, windows in by_ticker.items()
            ],
            key=lambda item: item["value"] if item["value"] is not None else float("-inf"),
            reverse=True,
        )[:3]

    persistent_outflow = []
    flow_reversal = []
    for ticker, windows in by_ticker.items():
        d1 = finite_number(windows.get("1D"))
        d3 = finite_number(windows.get("3D"))
        d5 = finite_number(windows.get("5D"))
        d20 = finite_number(windows.get("20D"))
        if all(value is not None and value < 0 for value in (d3, d5, d20)):
            persistent_outflow.append({"ticker": ticker, "flow3D": d3, "flow5D": d5, "flow20D": d20})
        if d1 is not None and d20 is not None and direction(d1) != direction(d20):
            flow_reversal.append({
                "ticker": ticker,
                "flow1D": d1,
                "flow20D": d20,
                "reversal": f"{direction(d20)} 20D to {direction(d1)} 1D",
            })

    disagreement = []
    for item in items:
        ticker = str(item.get("ticker") or "").upper()
        if ticker not in by_ticker:
            continue
        windows = by_ticker[ticker]
        d1 = finite_number(windows.get("1D"))
        d3 = finite_number(windows.get("3D"))
        d5 = finite_number(windows.get("5D"))
        entry = item.get("entryActionSignal")
        position = item.get("positionActionSignal")
        positive_short = all(value is not None and value > 0 for value in (d1, d3, d5))
        negative_short = all(value is not None and value < 0 for value in (d1, d3, d5))
        entry_text = str(entry or "").upper()
        position_text = str(position or "").upper()
        if positive_short and ("AVOID" in entry_text or "REDUCE" in position_text or "SELL" in position_text):
            disagreement.append({
                "ticker": ticker,
                "flowState": "Positive 1D/3D/5D",
                "entryActionSignal": entry,
                "positionActionSignal": position,
            })
        if negative_short and ("BUY" in entry_text or "HOLD" in position_text):
            disagreement.append({
                "ticker": ticker,
                "flowState": "Negative 1D/3D/5D",
                "entryActionSignal": entry,
                "positionActionSignal": position,
            })

    return {
        "strongestNetInflow": ranked,
        "persistentOutflow": persistent_outflow,
        "flowReversal": flow_reversal,
        "priceActionSignalDisagreement": disagreement,
        "modelRulesChanged": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", default=DEFAULT_FILE)
    parser.add_argument("--sheet", default=SHEET_NAME)
    parser.add_argument("--end-date", default="2026-06-04")
    parser.add_argument("--fixed-list-only", action="store_true")
    parser.add_argument("--refresh-json", help="Optional production refresh JSON to compare fixedSnapshot values.")
    args = parser.parse_args()

    if not args.fixed_list_only:
        print("--fixed-list-only is required for V1.9.7 validation.", flush=True)
        return 2

    file_path = Path(args.file)
    if not file_path.exists():
        print(json.dumps({
            "ok": False,
            "error": "INPUT_FILE_NOT_FOUND",
            "inputFile": str(file_path),
        }, indent=2))
        return 2

    loaded = load_import_rows(file_path, args.sheet, args.end_date)
    rows = loaded["rows"]
    validation = build_validation(rows, args.end_date)
    row_counts = Counter(row["ticker"] for row in rows)
    refresh = refresh_items(args.refresh_json)
    refresh_validation = compare_refresh(refresh, validation["tickerReports"])
    review = signal_review(refresh, validation["tickerReports"])

    result = {
        "ok": (
            validation["windowValidationStatus"] == "PASS"
            and (refresh_validation is None or (
                refresh_validation["windowComparisonStatus"] == "PASS"
                and refresh_validation["sourcePrecedenceStatus"] == "PASS"
                and refresh_validation["fixedSnapshotOrderStatus"] == "PASS"
            ))
        ),
        "validationVersion": "V1.9.7_FIXED_LIST_MOOMOO_FLOW_WINDOW_VALIDATION",
        "inputFile": str(file_path),
        "sheetName": args.sheet,
        "fixedTickerCount": len(FIXED_LIST),
        "fixedListOrder": FIXED_LIST,
        "totalRowsRead": len(loaded["rawRecords"]),
        "importedRowCount": len(rows),
        "expectedImportedRows": 753,
        "importedRowCountStatus": "PASS" if len(rows) == 753 else "WARNING",
        "importedTickers": [ticker for ticker in FIXED_LIST if row_counts[ticker] > 0],
        "rowCountPerTicker": {ticker: row_counts[ticker] for ticker in FIXED_LIST},
        "dateMin": validation["dateMin"],
        "dateMax": validation["dateMax"],
        "expectedDateMax": args.end_date,
        "dateMaxStatus": "PASS" if validation["dateMax"] == args.end_date else "FAIL",
        "duplicateRows": {
            "count": len(loaded["duplicates"]),
            "rows": loaded["duplicates"][:20],
            "truncated": len(loaded["duplicates"]) > 20,
        },
        "nonFixedTickerRowsIgnored": loaded["skippedNonFixed"],
        "rowsSkippedAfterEndDate": loaded["skippedAfterEnd"],
        "missingRowsByTicker": validation["missingRowsByTicker"],
        "windowValidationStatus": validation["windowValidationStatus"],
        "sourceValidationStatus": validation["sourceValidationStatus"],
        "coverageStatus": validation["coverageStatus"],
        "expectedSource": EXPECTED_SOURCE,
        "expectedProviderUsed": EXPECTED_PROVIDER,
        "expectedFlowDataTier": EXPECTED_TIER,
        "expectedFlowDataTierLabel": EXPECTED_TIER_LABEL,
        "tickerReports": validation["tickerReports"],
        "productionRefreshValidation": refresh_validation,
        "signalReview": review,
        "rankedCandidatesRefreshed": False,
        "marketScanRefreshed": False,
        "providerCallsUsed": 0,
        "tradingApiUsed": False,
        "modelRulesChanged": False,
    }
    print(json.dumps(result, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
