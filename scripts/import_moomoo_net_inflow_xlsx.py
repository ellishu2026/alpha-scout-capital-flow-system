#!/usr/bin/env python3
"""Import manually exported Moomoo fixed-list net inflow XLSX rows.

This script imports data only. It does not import or call Moomoo trading APIs,
does not call OpenD, and does not refresh or score the market universe.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


DEFAULT_ENDPOINT = (
    "https://alpha-scout-capital-flow-system.vercel.app"
    "/api/moomoo/ingest-daily-flow"
)
DEFAULT_FILE = "data/imports/moomoo/net_inflow_from_moomoo.xlsx"
SHEET_NAME = "Net Inflow Data"
XLSX_SOURCE = "MOOMOO_HISTORICAL_XLSX_IMPORT"
CALCULATION_METHOD = "MOOMOO_MANUAL_EXPORT_NET_INFLOW"
MAX_SYMBOLS_PER_DATE = 20
FIXED_LIST = [
    "SOXL",
    "SMH",
    "NVDA",
    "MSFT",
    "GOOGL",
    "ORCL",
    "RKLB",
    "LLY",
    "IONQ",
]
WINDOWS = {
    "1D": 1,
    "3D": 3,
    "5D": 5,
    "10D": 10,
    "20D": 20,
    "5W": 25,
    "6W": 30,
    "9W": 45,
    "12W": 60,
}
NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


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


def easter_sunday(year: int) -> dt.date:
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
        easter_sunday(year) - dt.timedelta(days=2),
        last_weekday(year, 5, 0),
        observed_date(6, 19, year),
        observed_date(7, 4, year),
        nth_weekday(year, 9, 0, 1),
        nth_weekday(year, 11, 3, 4),
        observed_date(12, 25, year),
    }


def is_us_trading_day(day: dt.date) -> bool:
    return day.weekday() < 5 and day not in us_market_holidays(day.year)


def previous_trading_window(end_date: str, count: int) -> list[str]:
    current = dt.date.fromisoformat(end_date)
    days: list[str] = []
    while len(days) < count:
        if is_us_trading_day(current):
            days.append(current.isoformat())
        current -= dt.timedelta(days=1)
    return list(reversed(days))


def column_letters(cell_ref: str) -> str:
    return "".join(ch for ch in cell_ref if ch.isalpha())


def excel_serial_to_date(value: float) -> str:
    base = dt.datetime(1899, 12, 30)
    return (base + dt.timedelta(days=value)).date().isoformat()


def parse_date(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return excel_serial_to_date(float(value))
    text = str(value).strip()
    if not text:
        return None
    try:
        return excel_serial_to_date(float(text))
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return dt.datetime.strptime(text[:10], fmt).date().isoformat()
        except ValueError:
            continue
    try:
        return dt.date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        return None


def parse_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        parsed = float(value)
    else:
        text = str(value).strip().replace(",", "").replace("$", "")
        if text.startswith("(") and text.endswith(")"):
            text = f"-{text[1:-1]}"
        try:
            parsed = float(text)
        except ValueError:
            return None
    return parsed if parsed == parsed else None


def text_of(element: ET.Element | None) -> str:
    if element is None:
        return ""
    return "".join(element.itertext())


def read_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return [text_of(si) for si in root.findall("main:si", NS)]


def workbook_sheet_path(zf: zipfile.ZipFile, sheet_name: str) -> str:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_targets = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall("pkgrel:Relationship", NS)
    }
    for sheet in workbook.findall("main:sheets/main:sheet", NS):
        if sheet.attrib.get("name") != sheet_name:
            continue
        rel_id = sheet.attrib.get(f"{{{NS['rel']}}}id")
        target = rel_targets.get(rel_id or "")
        if not target:
            break
        return f"xl/{target.lstrip('/')}" if not target.startswith("xl/") else target
    raise RuntimeError(f'Sheet "{sheet_name}" not found.')


def cell_value(cell: ET.Element, shared_strings: list[str]) -> Any:
    cell_type = cell.attrib.get("t")
    value_element = cell.find("main:v", NS)
    raw = text_of(value_element)
    if cell_type == "s":
        try:
            return shared_strings[int(raw)]
        except (ValueError, IndexError):
            return ""
    if cell_type == "inlineStr":
        return text_of(cell.find("main:is", NS))
    if cell_type == "b":
        return raw == "1"
    if raw == "":
        return ""
    try:
        return float(raw)
    except ValueError:
        return raw


def read_xlsx_rows(path: Path, sheet_name: str) -> list[dict[str, Any]]:
    with zipfile.ZipFile(path) as zf:
        shared_strings = read_shared_strings(zf)
        sheet_path = workbook_sheet_path(zf, sheet_name)
        root = ET.fromstring(zf.read(sheet_path))
        rows = []
        for row in root.findall("main:sheetData/main:row", NS):
            values: dict[str, Any] = {}
            for cell in row.findall("main:c", NS):
                ref = cell.attrib.get("r", "")
                values[column_letters(ref)] = cell_value(cell, shared_strings)
            rows.append(values)

    if not rows:
        return []

    header_row = rows[0]
    headers = {
        col: str(value).strip()
        for col, value in header_row.items()
        if str(value).strip()
    }
    records: list[dict[str, Any]] = []
    for row in rows[1:]:
        record = {
            header: row.get(col)
            for col, header in headers.items()
        }
        if any(value not in (None, "") for value in record.values()):
            records.append(record)
    return records


def normalize_row(record: dict[str, Any]) -> dict[str, Any] | None:
    ticker = str(record.get("Ticker") or "").strip().upper()
    date = parse_date(record.get("Date"))
    net_flow = parse_number(record.get("Net Inflow USD"))
    if not ticker or not date or net_flow is None:
        return None
    return {
        "ticker": ticker,
        "date": date,
        "netFlow": net_flow,
    }


def build_ingest_item(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "ticker": row["ticker"],
        "source": XLSX_SOURCE,
        "buyAmount": None,
        "sellAmount": None,
        "netFlow": row["netFlow"],
        "capitalInSuper": 0,
        "capitalInBig": 0,
        "capitalInMid": 0,
        "capitalInSmall": 0,
        "capitalOutSuper": 0,
        "capitalOutBig": 0,
        "capitalOutMid": 0,
        "capitalOutSmall": 0,
        "updateTime": row["date"],
        "currency": "USD",
        "calculationMethod": CALCULATION_METHOD,
        "buySellBreakdownAvailable": False,
    }


def post_payload(endpoint: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8")
        raise RuntimeError(f"ingest failed HTTP {error.code}: {body}") from error


def import_rows(
    endpoint: str,
    token: str,
    rows: list[dict[str, Any]],
    dry_run: bool,
) -> tuple[list[dict[str, Any]], int, int]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row["date"]].append(build_ingest_item(row))

    responses: list[dict[str, Any]] = []
    saved = 0
    failed = 0
    for date, items in sorted(grouped.items()):
        if len(items) > MAX_SYMBOLS_PER_DATE:
            raise RuntimeError(f"{date}: fixed-list import exceeded {MAX_SYMBOLS_PER_DATE} rows")
        payload = {
            "date": date,
            "source": XLSX_SOURCE,
            "items": items,
        }
        if dry_run:
            response = {
                "ok": True,
                "date": date,
                "savedCount": len(items),
                "failedCount": 0,
                "dryRun": True,
            }
        else:
            response = post_payload(endpoint, token, payload)
        responses.append({"date": date, **response})
        saved += int(response.get("savedCount") or 0)
        failed += int(response.get("failedCount") or 0)
    return responses, saved, failed


def fixed_window_preview(rows: list[dict[str, Any]], end_date: str) -> list[dict[str, Any]]:
    by_ticker: dict[str, dict[str, float]] = {
        ticker: {} for ticker in FIXED_LIST
    }
    for row in rows:
        by_ticker.setdefault(row["ticker"], {})[row["date"]] = row["netFlow"]

    preview: list[dict[str, Any]] = []
    for ticker in FIXED_LIST:
        date_map = by_ticker.get(ticker, {})
        item: dict[str, Any] = {"ticker": ticker}
        coverage_counts = []
        for label, count in WINDOWS.items():
            target_dates = previous_trading_window(end_date, count)
            available = [
                date_map[day]
                for day in target_dates
                if day in date_map
            ]
            coverage_counts.append(len(available) / count)
            item[label] = sum(available) if len(available) == count else None
        item["sourceCoveragePct"] = round(
            (sum(coverage_counts) / len(coverage_counts)) * 100,
            2,
        )
        preview.append(item)
    return preview


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", default=DEFAULT_FILE)
    parser.add_argument("--sheet", default=SHEET_NAME)
    parser.add_argument("--endpoint", default=os.getenv("ALPHASCOUT_MOOMOO_INGEST_URL", DEFAULT_ENDPOINT))
    parser.add_argument("--token", default=os.getenv("MOOMOO_INGEST_TOKEN"))
    parser.add_argument("--fixed-list-only", action="store_true")
    parser.add_argument("--replace-existing", action="store_true")
    parser.add_argument("--refresh-fixed", action="store_true")
    parser.add_argument("--end-date", default="2026-06-04")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    input_path = Path(args.file)
    if not input_path.exists():
        print(json.dumps({
            "ok": False,
            "archiveStatus": "FAILED",
            "error": "INPUT_FILE_NOT_FOUND",
            "inputFile": str(input_path),
            "expectedPath": DEFAULT_FILE,
        }, indent=2))
        return 2
    if not args.fixed_list_only:
        print("--fixed-list-only is required for V1.9.6.", file=sys.stderr)
        return 2
    if not args.token and not args.dry_run:
        print("MOOMOO_INGEST_TOKEN is required unless --dry-run is used.", file=sys.stderr)
        return 2

    raw_records = read_xlsx_rows(input_path, args.sheet)
    normalized = [row for row in (normalize_row(record) for record in raw_records) if row]
    end_date = args.end_date
    fixed_set = set(FIXED_LIST)
    imported_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    duplicates = 0
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
        if key in imported_by_key:
            duplicates += 1
        imported_by_key[key] = row

    rows_to_import = sorted(
        imported_by_key.values(),
        key=lambda row: (row["date"], FIXED_LIST.index(row["ticker"])),
    )
    responses, saved_count, failed_count = import_rows(
        args.endpoint,
        args.token or "",
        rows_to_import,
        args.dry_run,
    )
    tickers_imported = [
        ticker
        for ticker in FIXED_LIST
        if any(row["ticker"] == ticker for row in rows_to_import)
    ]
    dates = [row["date"] for row in rows_to_import]
    preview = fixed_window_preview(rows_to_import, end_date) if args.refresh_fixed else []
    rows_replaced = saved_count if args.replace_existing else 0
    archive_status = "SAVED" if failed_count == 0 else "PARTIAL"
    fixed_window_status = (
        "LOCAL_PREVIEW_REBUILT_FIXED_LIST_ONLY"
        if args.refresh_fixed
        else "NOT_REQUESTED"
    )

    print(json.dumps({
        "ok": failed_count == 0,
        "inputFile": str(input_path),
        "sheetName": args.sheet,
        "totalRowsRead": len(raw_records),
        "fixedListRowsImported": len(rows_to_import),
        "tickersImported": tickers_imported,
        "dateMin": min(dates) if dates else None,
        "dateMax": max(dates) if dates else None,
        "rowsSaved": saved_count,
        "rowsReplaced": rows_replaced,
        "rowsSkippedNonFixed": skipped_non_fixed,
        "rowsSkippedAfterEndDate": skipped_after_end,
        "duplicateRowsHandled": duplicates,
        "archiveStatus": archive_status,
        "fixedWindowRebuildStatus": fixed_window_status,
        "fixedListOnly": True,
        "fixedListCount": len(FIXED_LIST),
        "fixedListOrder": FIXED_LIST,
        "replaceExisting": args.replace_existing,
        "source": "Moomoo Historical XLSX Import",
        "provider": XLSX_SOURCE,
        "flowDataTier": "MOOMOO_DIRECT_CAPITAL_FLOW",
        "flowDataTierLabel": "Moomoo Direct Capital Flow",
        "flowDataQualityScore": 85,
        "buySellBreakdownAvailable": False,
        "calculationMethod": CALCULATION_METHOD,
        "rankedCandidatesRefreshed": False,
        "marketScanRefreshed": False,
        "providerCallsUsed": 0,
        "tradingApiUsed": False,
        "ingestResponses": responses,
        "fixedWindowPreview": preview,
    }, indent=2))
    return 0 if failed_count == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
