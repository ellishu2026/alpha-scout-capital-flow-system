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


def rows_from_data(data: Any) -> list[dict[str, Any]]:
    if hasattr(data, "to_dict"):
        return data.to_dict("records")
    if isinstance(data, list):
        return [dict(row) for row in data]
    return [dict(data)]


def fetch_capital_distribution(ctx: OpenQuoteContext, ticker: str) -> dict[str, Any]:
    code = moomoo_code(ticker)
    last_error = ""

    for attempt in range(RETRY_LIMIT + 1):
        ret, data = ctx.get_capital_distribution(code)
        if ret == RET_OK:
            rows = rows_from_data(data)
            if not rows:
                raise RuntimeError(f"{ticker}: no capital distribution rows")
            return build_item(ticker, dict(rows[-1]))

        last_error = str(data)
        if attempt < RETRY_LIMIT:
            time.sleep(REQUEST_INTERVAL_SECONDS)

    raise RuntimeError(f"{ticker}: {last_error or 'MOOMOO_REQUEST_FAILED'}")


def recent_trading_days(end_date: str, count: int) -> list[str]:
    current = dt.date.fromisoformat(end_date)
    days: list[str] = []

    while len(days) < count:
        if current.weekday() < 5:
            days.append(current.isoformat())
        current -= dt.timedelta(days=1)

    return days


def row_date(row: dict[str, Any]) -> str | None:
    value = (
        row.get("capital_flow_item_time")
        or row.get("capitalFlowItemTime")
        or row.get("time_key")
        or row.get("time")
        or row.get("date")
        or row.get("update_time")
    )
    if not value:
        return None

    text = str(value)
    return text[:10] if len(text) >= 10 else None


def row_time(row: dict[str, Any]) -> str:
    value = (
        row.get("capital_flow_item_time")
        or row.get("capitalFlowItemTime")
        or row.get("time_key")
        or row.get("time")
        or row.get("update_time")
        or ""
    )
    return str(value)


def first_number(row: dict[str, Any], keys: list[str]) -> float | None:
    for key in keys:
        value = row.get(key)
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            continue
        if parsed == parsed:
            return parsed

    return None


def build_capital_flow_item(
    ticker: str,
    target_date: str,
    row: dict[str, Any],
) -> dict[str, Any]:
    net_flow = first_number(row, ["in_flow", "inFlow", "netFlow", "net_flow"])
    if net_flow is None:
        raise RuntimeError("missing in_flow/netFlow")

    return {
        "ticker": ticker.upper(),
        "source": "MOOMOO_CAPITAL_FLOW",
        "date": target_date,
        "buyAmount": None,
        "sellAmount": None,
        "netFlow": net_flow,
        "capitalInSuper": first_number(row, ["super_in_flow", "superInFlow"]) or 0,
        "capitalInBig": first_number(row, ["big_in_flow", "bigInFlow"]) or 0,
        "capitalInMid": first_number(row, ["mid_in_flow", "midInFlow"]) or 0,
        "capitalInSmall": first_number(row, ["sml_in_flow", "small_in_flow", "smlInFlow"]) or 0,
        "capitalOutSuper": 0,
        "capitalOutBig": 0,
        "capitalOutMid": 0,
        "capitalOutSmall": 0,
        "updateTime": row_time(row),
        "currency": "USD",
        "calculationMethod": "MOOMOO_GET_CAPITAL_FLOW_LAST_INTRADAY_ROW",
        "buySellBreakdownAvailable": False,
    }


def fetch_capital_flow_day(
    ctx: OpenQuoteContext,
    ticker: str,
    target_date: str,
) -> dict[str, Any]:
    method = getattr(ctx, "get_capital_flow", None)
    if not callable(method):
        raise RuntimeError("get_capital_flow unavailable")

    code = moomoo_code(ticker)
    last_error = ""

    for attempt in range(RETRY_LIMIT + 1):
        try:
            ret, data = method(
                code,
                period_type="INTRADAY",
                start=target_date,
                end=target_date,
            )
        except TypeError:
            ret, data = method(code, "INTRADAY", target_date, target_date)

        if ret == RET_OK:
            rows = [
                row
                for row in rows_from_data(data)
                if row_date(row) == target_date and first_number(row, ["in_flow", "inFlow", "netFlow", "net_flow"]) is not None
            ]
            if not rows:
                raise RuntimeError(f"{ticker} {target_date}: no matching capital flow rows")
            rows.sort(key=row_time)
            return build_capital_flow_item(ticker, target_date, rows[-1])

        last_error = str(data)
        if attempt < RETRY_LIMIT:
            time.sleep(REQUEST_INTERVAL_SECONDS)

    raise RuntimeError(f"{ticker} {target_date}: {last_error or 'MOOMOO_CAPITAL_FLOW_FAILED'}")


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


def collect_historical_backfill(
    ctx: OpenQuoteContext,
    tickers: list[str],
    end_date: str,
    backfill_days: int,
) -> dict[str, Any]:
    tested_days = max(0, min(backfill_days, MAX_BACKFILL_DAYS))
    if tested_days <= 1 or not tickers:
        return {
            "items": [],
            "historicalBackfillSupported": False,
            "backfillDaysRequested": tested_days,
            "testedDays": tested_days,
            "supportedDays": 1 if tickers else 0,
            "failedDays": [],
            "failedTickerDates": [],
            "historicalRowsFailed": 0,
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

    target_days = recent_trading_days(end_date, tested_days)
    historical_items: list[dict[str, Any]] = []
    failed_ticker_dates: list[dict[str, str]] = []
    failed_days: set[str] = set()

    for ticker_index, ticker in enumerate(tickers):
        if ticker_index > 0:
            time.sleep(REQUEST_INTERVAL_SECONDS)
        for target_index, target_date in enumerate(target_days):
            if ticker_index > 0 or target_index > 0:
                time.sleep(REQUEST_INTERVAL_SECONDS)
            try:
                historical_items.append(fetch_capital_flow_day(ctx, ticker, target_date))
            except Exception as exc:  # noqa: BLE001 - per ticker/date failure should continue
                failed_days.add(target_date)
                failed_ticker_dates.append({
                    "ticker": ticker,
                    "date": target_date,
                    "error": str(exc),
                })

    supported_days = len({item["date"] for item in historical_items})
    historical_supported: bool | str
    if supported_days == tested_days:
        historical_supported = True
    elif supported_days > 0:
        historical_supported = "partial"
    else:
        historical_supported = False

    return {
        "items": historical_items,
        "historicalBackfillSupported": historical_supported,
        "backfillDaysRequested": tested_days,
        "testedDays": tested_days,
        "supportedDays": supported_days,
        "failedDays": sorted(failed_days),
        "failedTickerDates": failed_ticker_dates,
        "historicalRowsFailed": len(failed_ticker_dates),
        "reason": (
            "Moomoo get_capital_flow returned matching target-date rows."
            if historical_items
            else "Moomoo get_capital_flow did not return matching target-date rows for this run."
        ),
        "apiChecks": api_checks,
    }


def post_historical_groups(
    endpoint: str,
    token: str,
    items: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int, int]:
    responses: list[dict[str, Any]] = []
    saved = 0
    failed = 0
    grouped: dict[str, list[dict[str, Any]]] = {}

    for item in items:
        grouped.setdefault(item["date"], []).append(item)

    for date, rows in sorted(grouped.items()):
        response = post_payload(
            endpoint,
            token,
            {
                "date": date,
                "source": "MOOMOO_CAPITAL_FLOW",
                "items": rows,
            },
        )
        responses.append({"date": date, **response})
        saved += int(response.get("savedCount") or 0)
        failed += int(response.get("failedCount") or 0)

    return responses, saved, failed


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
        historical_result = collect_historical_backfill(
            ctx,
            tickers,
            args.date,
            args.backfill_days,
        )
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
    historical_items = historical_result.pop("items", [])
    historical_responses, historical_saved, historical_failed = post_historical_groups(
        args.endpoint,
        args.token,
        historical_items,
    )
    ingest_ok = bool(response.get("ok")) and all(
        bool(result.get("ok")) for result in historical_responses
    )
    date_coverage: dict[str, int] = {args.date: len(items)}
    for item in historical_items:
        date_coverage[item["date"]] = date_coverage.get(item["date"], 0) + 1
    archive_coverage_by_ticker = {item["ticker"]: [args.date] for item in items}
    for item in historical_items:
        archive_coverage_by_ticker.setdefault(item["ticker"], [])
        if item["date"] not in archive_coverage_by_ticker[item["ticker"]]:
            archive_coverage_by_ticker[item["ticker"]].append(item["date"])

    print("---- upload summary ----")
    print(json.dumps({
        "requestedTickers": len(tickers),
        "collected": len(items),
        "localErrors": errors,
        "ingestOk": ingest_ok,
        "savedCount": response.get("savedCount"),
        "failedCount": int(response.get("failedCount") or 0) + historical_failed,
        "skippedDueToScopeCount": response.get("skippedDueToScopeCount"),
        **universe_summary,
        **historical_result,
        "historicalRowsSaved": historical_saved,
        "historicalIngestResponses": historical_responses,
        "dateCoverage": date_coverage,
        "moomooArchiveCoverageByTicker": archive_coverage_by_ticker,
    }, indent=2))
    return 0 if ingest_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
