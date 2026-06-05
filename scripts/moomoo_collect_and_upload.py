#!/usr/bin/env python3
"""Collect Moomoo capital distribution data locally and upload to AlphaScout.

This script uses quote/capital-flow access only. It intentionally does not
import or initialize any trading context and does not call order/account APIs.
"""

from __future__ import annotations

import argparse
import datetime as dt
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
MAX_SYMBOLS_PER_RUN = 20
REQUEST_INTERVAL_SECONDS = 1.2
RETRY_LIMIT = 1


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


def parse_tickers(value: str | None) -> list[str]:
    if not value:
        return DEFAULT_TICKERS

    return [ticker.strip().upper() for ticker in value.split(",") if ticker.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default=os.getenv("ALPHASCOUT_MOOMOO_INGEST_URL", DEFAULT_ENDPOINT))
    parser.add_argument("--token", default=os.getenv("MOOMOO_INGEST_TOKEN"))
    parser.add_argument("--host", default=os.getenv("MOOMOO_OPEND_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("MOOMOO_OPEND_PORT", "11111")))
    parser.add_argument("--date", default=dt.date.today().isoformat())
    parser.add_argument("--tickers", default=os.getenv("MOOMOO_TICKERS"))
    args = parser.parse_args()

    if not args.token:
        print("MOOMOO_INGEST_TOKEN is required.", file=sys.stderr)
        return 2

    tickers = parse_tickers(args.tickers)[:MAX_SYMBOLS_PER_RUN]
    items: list[dict[str, Any]] = []
    errors: list[str] = []
    ctx = OpenQuoteContext(host=args.host, port=args.port)

    try:
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

    print("---- upload summary ----")
    print(json.dumps({
        "requestedTickers": len(tickers),
        "collected": len(items),
        "localErrors": errors,
        "ingestOk": response.get("ok"),
        "savedCount": response.get("savedCount"),
        "failedCount": response.get("failedCount"),
        "skippedDueToScopeCount": response.get("skippedDueToScopeCount"),
    }, indent=2))
    return 0 if response.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())

