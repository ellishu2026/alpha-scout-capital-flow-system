#!/usr/bin/env python3
"""Collect Moomoo capital distribution data locally and upload to AlphaScout.

This script uses quote/capital-flow access only. It intentionally does not
import or initialize any trading context and does not call order/account APIs.
"""

from __future__ import annotations

import argparse
import datetime as dt
import inspect
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

from moomoo import OpenQuoteContext, RET_OK


DEFAULT_TICKERS = [
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
DEFAULT_ENDPOINT = (
    "https://alpha-scout-capital-flow-system.vercel.app"
    "/api/moomoo/ingest-daily-flow"
)
DEFAULT_REFRESH_ENDPOINT = (
    "https://alpha-scout-capital-flow-system.vercel.app"
    "/api/cron/refresh"
)
MAX_SYMBOLS_PER_RUN = 20
REQUEST_INTERVAL_SECONDS = 1.2
RETRY_LIMIT = 1
MAX_BACKFILL_DAYS = 4


def moomoo_code(ticker: str) -> str:
    return f"US.{ticker.strip().upper().replace('-', '.')}"


def number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def row_value(row: dict[str, Any], key: str) -> float:
    return number(row.get(key))


def build_item(ticker: str, row: dict[str, Any]) -> dict[str, Any]:
    capital_in_super = row_value(row, "capital_in_super")
    capital_in_big = row_value(row, "capital_in_big")
    capital_in_mid = row_value(row, "capital_in_mid")
    capital_in_small = row_value(row, "capital_in_small")
    capital_out_super = row_value(row, "capital_out_super")
    capital_out_big = row_value(row, "capital_out_big")
    capital_out_mid = row_value(row, "capital_out_mid")
    capital_out_small = row_value(row, "capital_out_small")
    buy_amount = capital_in_super + capital_in_big + capital_in_mid + capital_in_small
    sell_amount = (
        capital_out_super + capital_out_big + capital_out_mid + capital_out_small
    )

    return {
        "ticker": ticker.upper(),
        "buyAmount": buy_amount,
        "sellAmount": sell_amount,
        "netFlow": buy_amount - sell_amount,
        "capitalInSuper": capital_in_super,
        "capitalInBig": capital_in_big,
        "capitalInMid": capital_in_mid,
        "capitalInSmall": capital_in_small,
        "capitalOutSuper": capital_out_super,
        "capitalOutBig": capital_out_big,
        "capitalOutMid": capital_out_mid,
        "capitalOutSmall": capital_out_small,
        "updateTime": str(row.get("update_time") or row.get("updateTime") or ""),
        "currency": "USD",
    }


def fetch_capital_distribution(ctx: OpenQuoteContext, ticker: str) -> dict[str, Any]:
    code = moomoo_code(ticker)
    last_error = ""

    for attempt in range(RETRY_LIMIT + 1):
        ret, data = ctx.get_capital_distribution(code)
        if ret == RET_OK:
            if hasattr(data, "to_dict"):
                rows = data.to_dict("records")
            elif isinstance(data, list):
                rows = data
            else:
                rows = [dict(data)]
            if not rows:
                raise RuntimeError(f"{ticker}: no capital distribution rows")
            return build_item(ticker, dict(rows[-1]))

        last_error = str(data)
        if attempt < RETRY_LIMIT:
            time.sleep(REQUEST_INTERVAL_SECONDS)

    raise RuntimeError(f"{ticker}: {last_error or 'MOOMOO_REQUEST_FAILED'}")


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
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8")
        raise RuntimeError(f"ingest failed HTTP {error.code}: {body}") from error


def get_json(endpoint: str, token: str | None = None) -> dict[str, Any]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = urllib.request.Request(endpoint, headers=headers, method="GET")

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8")
        raise RuntimeError(f"refresh failed HTTP {error.code}: {body}") from error


def parse_tickers(value: str | None) -> list[str]:
    if not value:
        return DEFAULT_TICKERS

    return [ticker.strip().upper() for ticker in value.split(",") if ticker.strip()]


def clean_ticker(value: Any) -> str | None:
    if not isinstance(value, str):
        return None

    ticker = value.strip().upper()
    return ticker or None


def extract_item_tickers(items: Any) -> list[str]:
    if not isinstance(items, list):
        return []

    tickers: list[str] = []
    for item in items:
        if isinstance(item, dict):
            ticker = clean_ticker(item.get("ticker") or item.get("symbol"))
            if ticker:
                tickers.append(ticker)
        else:
            ticker = clean_ticker(item)
            if ticker:
                tickers.append(ticker)

    return tickers


def load_refresh_payload(args: argparse.Namespace) -> dict[str, Any]:
    if args.refresh_payload:
        with open(args.refresh_payload, encoding="utf-8") as handle:
            return json.load(handle)

    return get_json(args.refresh_url, args.refresh_token)


def build_auto_universe(args: argparse.Namespace) -> tuple[list[str], dict[str, Any]]:
    payload = load_refresh_payload(args)
    snapshot = payload.get("snapshot") if isinstance(payload.get("snapshot"), dict) else payload
    top_level_fixed_snapshot = (
        payload.get("fixedSnapshot")
        if isinstance(payload.get("fixedSnapshot"), dict)
        else {}
    )
    fixed_snapshot = (
        snapshot.get("fixedSnapshot")
        if isinstance(snapshot, dict) and isinstance(snapshot.get("fixedSnapshot"), dict)
        else top_level_fixed_snapshot
    )
    fixed_tickers = extract_item_tickers(fixed_snapshot.get("items"))
    ranked_tickers = extract_item_tickers(snapshot.get("items") if isinstance(snapshot, dict) else [])

    merged: list[str] = []
    seen: set[str] = set()
    for ticker in [*fixed_tickers, *ranked_tickers]:
        if ticker in seen:
            continue
        seen.add(ticker)
        merged.append(ticker)

    final_tickers = merged[:MAX_SYMBOLS_PER_RUN]
    summary = {
        "mode": "auto-universe",
        "fixedCount": len(fixed_tickers),
        "rankedCount": len(ranked_tickers),
        "dedupedCount": len(merged),
        "finalTickerCount": len(final_tickers),
        "finalTickers": final_tickers,
        "maxSymbolsPerRun": MAX_SYMBOLS_PER_RUN,
    }

    return final_tickers, summary


def select_tickers(args: argparse.Namespace) -> tuple[list[str], dict[str, Any]]:
    if args.auto_universe:
        return build_auto_universe(args)

    tickers = parse_tickers(args.tickers)
    final_tickers = tickers[:MAX_SYMBOLS_PER_RUN]
    return final_tickers, {
        "mode": "manual" if args.tickers else "manual-default",
        "fixedCount": len(DEFAULT_TICKERS) if not args.tickers else 0,
        "rankedCount": 0,
        "dedupedCount": len(dict.fromkeys(tickers)),
        "finalTickerCount": len(final_tickers),
        "finalTickers": final_tickers,
        "maxSymbolsPerRun": MAX_SYMBOLS_PER_RUN,
    }


def test_historical_backfill(
    ctx: OpenQuoteContext,
    tickers: list[str],
    backfill_days: int,
) -> dict[str, Any]:
    tested_days = max(0, min(backfill_days, MAX_BACKFILL_DAYS))
    if tested_days <= 1 or not tickers:
        return {
            "historicalBackfillSupported": False,
            "testedDays": tested_days,
            "supportedDays": 1 if tickers else 0,
            "failedDays": [],
            "reason": "Current-day collection only; backfill test was not requested.",
            "apiChecks": [],
        }

    api_checks: list[dict[str, Any]] = []
    ticker = tickers[0]
    code = moomoo_code(ticker)

    for method_name in ["get_capital_distribution", "get_capital_flow"]:
        method = getattr(ctx, method_name, None)
        if not callable(method):
            api_checks.append({
                "method": method_name,
                "available": False,
                "supportsDateParameter": False,
                "status": "METHOD_NOT_AVAILABLE",
            })
            continue

        try:
            signature = str(inspect.signature(method))
        except (TypeError, ValueError):
            signature = "UNKNOWN"

        supports_date_parameter = any(
            name in signature.lower()
            for name in ["date", "start", "end", "begin", "time"]
        )
        check: dict[str, Any] = {
            "method": method_name,
            "available": True,
            "signature": signature,
            "supportsDateParameter": supports_date_parameter,
        }

        try:
            ret, data = method(code)
            check["latestCallOk"] = ret == RET_OK
            check["latestCallStatus"] = "OK" if ret == RET_OK else str(data)
        except Exception as exc:  # noqa: BLE001 - capability probe must not block upload
            check["latestCallOk"] = False
            check["latestCallStatus"] = str(exc)

        api_checks.append(check)

    return {
        "historicalBackfillSupported": False,
        "testedDays": tested_days,
        "supportedDays": 1,
        "failedDays": [],
        "reason": (
            "Moomoo collector confirmed latest-day quote access. "
            "No supported historical date parameter is enabled in this collector yet."
        ),
        "apiChecks": api_checks,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default=os.getenv("ALPHASCOUT_MOOMOO_INGEST_URL", DEFAULT_ENDPOINT))
    parser.add_argument("--token", default=os.getenv("MOOMOO_INGEST_TOKEN"))
    parser.add_argument("--host", default=os.getenv("MOOMOO_OPEND_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("MOOMOO_OPEND_PORT", "11111")))
    parser.add_argument("--date", default=dt.date.today().isoformat())
    parser.add_argument("--tickers", default=os.getenv("MOOMOO_TICKERS"))
    parser.add_argument("--auto-universe", action="store_true")
    parser.add_argument("--refresh-url", default=os.getenv("ALPHASCOUT_REFRESH_URL", DEFAULT_REFRESH_ENDPOINT))
    parser.add_argument(
        "--refresh-token",
        default=os.getenv("ALPHASCOUT_REFRESH_TOKEN") or os.getenv("CRON_SECRET"),
    )
    parser.add_argument("--refresh-payload")
    parser.add_argument("--backfill-days", type=int, default=1)
    args = parser.parse_args()

    if not args.token:
        print("MOOMOO_INGEST_TOKEN is required.", file=sys.stderr)
        return 2

    tickers, universe_summary = select_tickers(args)
    print("---- collection universe ----")
    print(json.dumps(universe_summary, indent=2))

    items: list[dict[str, Any]] = []
    errors: list[str] = []
    historical_result: dict[str, Any] = {}
    ctx = OpenQuoteContext(host=args.host, port=args.port)

    try:
        historical_result = test_historical_backfill(ctx, tickers, args.backfill_days)
        for index, ticker in enumerate(tickers):
            if index > 0:
                time.sleep(REQUEST_INTERVAL_SECONDS)
            try:
                item = fetch_capital_distribution(ctx, ticker)
                items.append(item)
                print(
                    f"{ticker}: netFlow={item['netFlow']:.2f} "
                    f"buy={item['buyAmount']:.2f} sell={item['sellAmount']:.2f}"
                )
            except Exception as exc:  # noqa: BLE001 - per-ticker failures should continue
                errors.append(f"{ticker}:{exc}")
                print(f"{ticker}: FAILED {exc}", file=sys.stderr)
    finally:
        ctx.close()

    payload = {
        "date": args.date,
        "source": "MOOMOO_CAPITAL_DISTRIBUTION",
        "items": items,
    }
    response = post_payload(args.endpoint, args.token, payload)
    date_coverage = {args.date: len(items)}
    archive_coverage_by_ticker = {item["ticker"]: [args.date] for item in items}

    print("---- upload summary ----")
    print(json.dumps({
        "requestedTickers": len(tickers),
        "collected": len(items),
        "localErrors": errors,
        "ingestOk": response.get("ok"),
        "savedCount": response.get("savedCount"),
        "failedCount": response.get("failedCount"),
        "skippedDueToScopeCount": response.get("skippedDueToScopeCount"),
        **universe_summary,
        **historical_result,
        "historicalRowsSaved": 0,
        "dateCoverage": date_coverage,
        "moomooArchiveCoverageByTicker": archive_coverage_by_ticker,
    }, indent=2))
    return 0 if response.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
