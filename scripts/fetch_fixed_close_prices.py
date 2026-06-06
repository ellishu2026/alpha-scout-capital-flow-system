#!/usr/bin/env python3
"""Fetch fixed-list historical daily close prices for Moomoo flow research.

Fixed-list research only. This script does not scan the market universe, does
not use paid provider quota, and does not touch production signal logic.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


FIXED_LIST = ["SOXL", "SMH", "NVDA", "MSFT", "GOOGL", "ORCL", "RKLB", "LLY", "IONQ"]
OUTPUT_JSON = Path("data/research/fixed_close_prices_v199.json")
OUTPUT_CSV = Path("data/research/fixed_close_prices_v199.csv")
REQUEST_INTERVAL_SECONDS = 0.4


@dataclass(frozen=True)
class PriceArchiveRow:
    ticker: str
    date: str
    open: float | None
    high: float | None
    low: float | None
    close: float
    adjustedClose: float | None
    volume: int | None
    source: str
    archiveStatus: str
    fetchedAt: str
    priceDataQuality: str
    closePriceType: str
    fallbackUsed: bool


def to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(str(value).replace(",", ""))
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def to_int(value: Any) -> int | None:
    parsed = to_float(value)
    return int(parsed) if parsed is not None else None


def stooq_symbol(ticker: str) -> str:
    return f"{ticker.lower()}.us"


def fetch_text(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "AlphaScoutResearch/1.9.9"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read().decode("utf-8")


def fetch_stooq(ticker: str, start_date: str, end_date: str, fetched_at: str) -> list[PriceArchiveRow]:
    d1 = start_date.replace("-", "")
    d2 = end_date.replace("-", "")
    url = (
        "https://stooq.com/q/d/l/?"
        + urllib.parse.urlencode({"s": stooq_symbol(ticker), "d1": d1, "d2": d2, "i": "d"})
    )
    text = fetch_text(url)
    reader = csv.DictReader(text.splitlines())
    rows: list[PriceArchiveRow] = []
    for record in reader:
        date = str(record.get("Date") or "")[:10]
        close = to_float(record.get("Close"))
        if not date or close is None or close <= 0:
            continue
        rows.append(
            PriceArchiveRow(
                ticker=ticker,
                date=date,
                open=to_float(record.get("Open")),
                high=to_float(record.get("High")),
                low=to_float(record.get("Low")),
                close=close,
                adjustedClose=None,
                volume=to_int(record.get("Volume")),
                source="STOOQ_DAILY_CSV",
                archiveStatus="SAVED",
                fetchedAt=fetched_at,
                priceDataQuality="BASIC_DAILY_OHLCV",
                closePriceType="close",
                fallbackUsed=False,
            ),
        )
    return rows


def unix_time(day: str) -> int:
    return int(dt.datetime.fromisoformat(day).replace(tzinfo=dt.UTC).timestamp())


def fetch_yahoo_fallback(ticker: str, start_date: str, end_date: str, fetched_at: str) -> list[PriceArchiveRow]:
    end_exclusive = (dt.date.fromisoformat(end_date) + dt.timedelta(days=1)).isoformat()
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?"
        + urllib.parse.urlencode(
            {
                "period1": unix_time(start_date),
                "period2": unix_time(end_exclusive),
                "interval": "1d",
                "events": "history",
                "includeAdjustedClose": "true",
            },
        )
    )
    payload = json.loads(fetch_text(url))
    result = ((payload.get("chart") or {}).get("result") or [None])[0]
    if not result:
        return []
    timestamps = result.get("timestamp") or []
    quote = (((result.get("indicators") or {}).get("quote") or [{}])[0]) or {}
    adjclose = (((result.get("indicators") or {}).get("adjclose") or [{}])[0] or {}).get("adjclose") or []
    rows: list[PriceArchiveRow] = []
    for index, stamp in enumerate(timestamps):
        date = dt.datetime.fromtimestamp(stamp, tz=dt.UTC).date().isoformat()
        close = to_float((quote.get("close") or [None])[index] if index < len(quote.get("close") or []) else None)
        adjusted = to_float(adjclose[index] if index < len(adjclose) else None)
        selected_close = adjusted if adjusted is not None and adjusted > 0 else close
        if selected_close is None or selected_close <= 0:
            continue
        rows.append(
            PriceArchiveRow(
                ticker=ticker,
                date=date,
                open=to_float((quote.get("open") or [None])[index] if index < len(quote.get("open") or []) else None),
                high=to_float((quote.get("high") or [None])[index] if index < len(quote.get("high") or []) else None),
                low=to_float((quote.get("low") or [None])[index] if index < len(quote.get("low") or []) else None),
                close=close or selected_close,
                adjustedClose=adjusted,
                volume=to_int((quote.get("volume") or [None])[index] if index < len(quote.get("volume") or []) else None),
                source="YFINANCE_FALLBACK",
                archiveStatus="SAVED",
                fetchedAt=fetched_at,
                priceDataQuality="BASIC_DAILY_OHLCV",
                closePriceType="adjustedClose" if adjusted is not None and adjusted > 0 else "close",
                fallbackUsed=True,
            ),
        )
    return rows


def write_archive(rows: list[PriceArchiveRow], summary: dict[str, Any]) -> None:
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "summary": summary,
        "rows": [asdict(row) for row in rows],
    }
    OUTPUT_JSON.write_text(json.dumps(payload, indent=2))
    with OUTPUT_CSV.open("w", newline="") as file:
        fieldnames = list(asdict(rows[0]).keys()) if rows else [
            "ticker",
            "date",
            "open",
            "high",
            "low",
            "close",
            "adjustedClose",
            "volume",
            "source",
            "archiveStatus",
            "fetchedAt",
            "priceDataQuality",
            "closePriceType",
            "fallbackUsed",
        ]
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(asdict(row))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixed-list-only", action="store_true")
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument("--source", default="stooq")
    parser.add_argument("--fallback", default="yfinance")
    parser.add_argument("--archive", action="store_true")
    args = parser.parse_args()

    if not args.fixed_list_only:
        print("--fixed-list-only is required for V1.9.9.")
        return 2
    if args.source.lower() != "stooq":
        print("Only --source stooq is supported for V1.9.9.")
        return 2

    fetched_at = dt.datetime.now(dt.UTC).isoformat()
    all_rows: list[PriceArchiveRow] = []
    errors: dict[str, str] = {}
    fallback_tickers: list[str] = []

    for ticker in FIXED_LIST:
        rows: list[PriceArchiveRow] = []
        try:
            rows = fetch_stooq(ticker, args.start_date, args.end_date, fetched_at)
        except Exception as error:  # noqa: BLE001 - report per-ticker fetch failure.
            errors[ticker] = f"STOOQ_FAILED: {error}"
        time.sleep(REQUEST_INTERVAL_SECONDS)

        if not rows and args.fallback.lower() == "yfinance":
            try:
                rows = fetch_yahoo_fallback(ticker, args.start_date, args.end_date, fetched_at)
                if rows:
                    fallback_tickers.append(ticker)
            except Exception as error:  # noqa: BLE001 - report per-ticker fallback failure.
                errors[ticker] = f"{errors.get(ticker, '')}; YFINANCE_FAILED: {error}".strip("; ")
            time.sleep(REQUEST_INTERVAL_SECONDS)

        all_rows.extend(rows)

    by_key: dict[tuple[str, str], PriceArchiveRow] = {}
    for row in all_rows:
        if args.start_date <= row.date <= args.end_date:
            by_key[(row.ticker, row.date)] = row
    rows = sorted(by_key.values(), key=lambda row: (FIXED_LIST.index(row.ticker), row.date))
    by_ticker = {
        ticker: [row for row in rows if row.ticker == ticker]
        for ticker in FIXED_LIST
    }
    dates = [row.date for row in rows]
    source_counts: dict[str, int] = {}
    for row in rows:
        source_counts[row.source] = source_counts.get(row.source, 0) + 1

    summary = {
        "ok": bool(rows),
        "version": "V1.9.9_FIXED_LIST_CLOSE_PRICE_ARCHIVE",
        "fixedListOnly": True,
        "fixedTickers": FIXED_LIST,
        "startDate": args.start_date,
        "endDate": args.end_date,
        "source": "STOOQ_DAILY_CSV",
        "fallback": "YFINANCE_FALLBACK",
        "archiveStatus": "SAVED" if rows else "NO_ROWS",
        "priceRows": len(rows),
        "dateMin": min(dates) if dates else None,
        "dateMax": max(dates) if dates else None,
        "priceRowsByTicker": {ticker: len(items) for ticker, items in by_ticker.items()},
        "sourceCounts": source_counts,
        "fallbackUsedTickers": fallback_tickers,
        "errors": errors,
        "outputFiles": [str(OUTPUT_JSON), str(OUTPUT_CSV)] if args.archive else [],
        "providerQuotaUsed": {
            "alphaVantage": 0,
            "polygon": 0,
            "twelveData": 0,
            "eodhd": 0,
        },
        "broadUniverseFetched": False,
        "tradingApiUsed": False,
    }
    if args.archive:
        write_archive(rows, summary)
    print(json.dumps(summary, indent=2))
    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
