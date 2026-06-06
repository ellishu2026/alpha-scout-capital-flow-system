#!/usr/bin/env python3
"""Calculate fixed-list Moomoo flow signal forward-return research metrics.

Research only. This script reads existing archives and writes local research
outputs. It does not update production rules, snapshots, archives, or trading
state.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import statistics
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from import_moomoo_net_inflow_xlsx import (
    DEFAULT_FILE as DEFAULT_XLSX_FILE,
    SHEET_NAME,
    normalize_row,
    read_xlsx_rows,
)

FIXED_LIST = ["SOXL", "SMH", "NVDA", "MSFT", "GOOGL", "ORCL", "RKLB", "LLY", "IONQ"]
MOOMOO_PROVIDERS = [
    "MOOMOO_CAPITAL_DISTRIBUTION",
    "MOOMOO_CAPITAL_DISTRIBUTION_ARCHIVE",
    "MOOMOO_HISTORICAL_XLSX_IMPORT",
]
PRICE_PROVIDERS = ["POLYGON", "ALPHA_VANTAGE", "TWELVE_DATA", "EODHD"]
HORIZONS = [1, 3, 5, 10, 20]
WINDOWS = {"1D": 1, "3D": 3, "5D": 5, "10D": 10, "20D": 20}
FLOW_PROVIDER_PRIORITY = {
    "MOOMOO_CAPITAL_DISTRIBUTION": 3,
    "MOOMOO_CAPITAL_DISTRIBUTION_ARCHIVE": 3,
    "MOOMOO_HISTORICAL_XLSX_IMPORT": 2,
}
OUTPUT_JSON = Path("data/research/moomoo_flow_win_rate_v1978.json")
OUTPUT_CSV = Path("data/research/moomoo_flow_win_rate_v1978.csv")
OUTPUT_MD = Path("docs/research/moomoo-flow-win-rate-v1978.md")
OUTPUT_JSON_V199 = Path("data/research/moomoo_flow_win_rate_v199.json")
OUTPUT_CSV_V199 = Path("data/research/moomoo_flow_win_rate_v199.csv")
OUTPUT_MD_V199 = Path("docs/research/moomoo-flow-win-rate-v199.md")
DEFAULT_PRICE_ARCHIVE = Path("data/research/fixed_close_prices_v199.json")


@dataclass(frozen=True)
class FlowRow:
    ticker: str
    date: str
    net_flow: float
    provider: str


@dataclass(frozen=True)
class PriceRow:
    ticker: str
    date: str
    close: float
    provider: str


def load_env(path: Path = Path(".env.local")) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def supabase_get(table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
    query = urllib.parse.urlencode(params, safe="(),.*")
    request = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/{table}?{query}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def supabase_configured() -> bool:
    return bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY"))


def to_float(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def parse_moomoo_rows(rows: list[dict[str, Any]]) -> list[FlowRow]:
    by_key: dict[tuple[str, str], FlowRow] = {}
    for row in rows:
        ticker = str(row.get("ticker") or "").upper()
        provider = str(row.get("provider") or "")
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        distribution = payload.get("distribution") if isinstance(payload.get("distribution"), dict) else payload
        date = str(
            distribution.get("flowDate")
            or distribution.get("flow_date")
            or distribution.get("date")
            or row.get("data_date")
            or ""
        )[:10]
        net_flow = to_float(distribution.get("netFlow") or distribution.get("net_flow") or distribution.get("in_flow"))
        if ticker not in FIXED_LIST or provider not in MOOMOO_PROVIDERS or not date or net_flow is None:
            continue
        key = (ticker, date)
        existing = by_key.get(key)
        if (
            existing is None
            or FLOW_PROVIDER_PRIORITY.get(provider, 0) >= FLOW_PROVIDER_PRIORITY.get(existing.provider, 0)
        ):
            by_key[key] = FlowRow(ticker=ticker, date=date, net_flow=net_flow, provider=provider)
    return sorted(by_key.values(), key=lambda row: (row.ticker, row.date))


def parse_price_rows(rows: list[dict[str, Any]]) -> list[PriceRow]:
    by_ticker_provider: dict[tuple[str, str], list[PriceRow]] = defaultdict(list)
    for row in rows:
        ticker = str(row.get("ticker") or "").upper()
        provider = str(row.get("provider") or "")
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        candles = payload.get("candles") if isinstance(payload.get("candles"), list) else []
        if ticker not in FIXED_LIST or provider not in PRICE_PROVIDERS:
            continue
        for candle in candles:
            if not isinstance(candle, dict):
                continue
            date = str(candle.get("date") or "")[:10]
            close = to_float(candle.get("close"))
            if date and close is not None and close > 0:
                by_ticker_provider[(ticker, provider)].append(
                    PriceRow(ticker=ticker, date=date, close=close, provider=provider),
                )

    selected: list[PriceRow] = []
    provider_rank = {provider: index for index, provider in enumerate(PRICE_PROVIDERS)}
    for ticker in FIXED_LIST:
        candidates = [
            (provider_rank[provider], rows)
            for (row_ticker, provider), rows in by_ticker_provider.items()
            if row_ticker == ticker
        ]
        if not candidates:
            continue
        _, rows_for_provider = sorted(candidates, key=lambda item: (item[0], -len(item[1])))[0]
        by_date = {row.date: row for row in rows_for_provider}
        selected.extend(by_date[date] for date in sorted(by_date))
    return selected


def fetch_archives() -> tuple[list[FlowRow], list[PriceRow]]:
    ticker_filter = f"in.({','.join(FIXED_LIST)})"
    provider_filter = f"in.({','.join([*MOOMOO_PROVIDERS, *PRICE_PROVIDERS])})"
    rows = supabase_get(
        "alpha_scout_market_data_archive",
        {
            "select": "ticker,provider,data_date,payload",
            "ticker": ticker_filter,
            "provider": provider_filter,
            "limit": "10000",
        },
    )
    return parse_moomoo_rows(rows), parse_price_rows(rows)


def load_local_xlsx_flow_rows(path: Path) -> list[FlowRow]:
    raw_records = read_xlsx_rows(path, SHEET_NAME)
    rows: list[FlowRow] = []
    for record in raw_records:
        normalized = normalize_row(record)
        if not normalized or normalized["ticker"] not in FIXED_LIST:
            continue
        rows.append(
            FlowRow(
                ticker=normalized["ticker"],
                date=normalized["date"],
                net_flow=normalized["netFlow"],
                provider="MOOMOO_HISTORICAL_XLSX_IMPORT",
            ),
        )
    return sorted(rows, key=lambda row: (row.ticker, row.date))


def load_local_price_rows(path: Path) -> list[PriceRow]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text())
    records = payload.get("rows") if isinstance(payload, dict) else []
    rows: list[PriceRow] = []
    for record in records or []:
        if not isinstance(record, dict):
            continue
        ticker = str(record.get("ticker") or "").upper()
        date = str(record.get("date") or "")[:10]
        adjusted = to_float(record.get("adjustedClose"))
        close = to_float(record.get("close"))
        selected = adjusted if adjusted is not None and adjusted > 0 else close
        source = str(record.get("source") or "LOCAL_PRICE_ARCHIVE")
        if ticker in FIXED_LIST and date and selected is not None and selected > 0:
            rows.append(PriceRow(ticker=ticker, date=date, close=selected, provider=source))
    by_key = {(row.ticker, row.date): row for row in rows}
    return sorted(by_key.values(), key=lambda row: (row.ticker, row.date))


def load_research_inputs(
    xlsx_file: Path,
    price_archive: Path,
) -> tuple[list[FlowRow], list[PriceRow], str, str | None]:
    local_price_rows = load_local_price_rows(price_archive)
    if supabase_configured():
        flow_rows, price_rows = fetch_archives()
        if price_rows:
            return flow_rows, price_rows, "SUPABASE_ARCHIVE", None
        warning = "SUPABASE_PRICE_ARCHIVE_EMPTY: using local fixed-list close price archive."
        return flow_rows, local_price_rows, "SUPABASE_FLOW_LOCAL_PRICE_ARCHIVE", warning
    flow_rows = load_local_xlsx_flow_rows(xlsx_file)
    if local_price_rows:
        return flow_rows, local_price_rows, "LOCAL_XLSX_FLOW_FIXED_CLOSE_PRICE_ARCHIVE", None
    return (
        flow_rows,
        [],
        "LOCAL_XLSX_FLOW_ONLY",
        "PRICE_ARCHIVE_MISSING: run scripts/fetch_fixed_close_prices.py before calculating forward returns.",
    )


def percentile(sorted_values: list[float], value: float) -> float:
    if not sorted_values:
        return 0.0
    count = sum(1 for item in sorted_values if item <= value)
    return (count / len(sorted_values)) * 100


def median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def average(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def ready_status(sample_size: int) -> str:
    if sample_size < 30:
        return "Not Ready"
    if sample_size < 80:
        return "Watch"
    return "Usable"


def profit_factor(returns: list[float]) -> float | None:
    wins = sum(value for value in returns if value > 0)
    losses = abs(sum(value for value in returns if value < 0))
    if losses == 0:
        return None
    return wins / losses


def build_signal_rows(flow_rows: list[FlowRow], price_rows: list[PriceRow]) -> list[dict[str, Any]]:
    flows_by_ticker: dict[str, list[FlowRow]] = defaultdict(list)
    prices_by_ticker: dict[str, list[PriceRow]] = defaultdict(list)
    for row in flow_rows:
        flows_by_ticker[row.ticker].append(row)
    for row in price_rows:
        prices_by_ticker[row.ticker].append(row)

    percentile_maps: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    base_rows: list[dict[str, Any]] = []
    for ticker, rows in flows_by_ticker.items():
        rows = sorted(rows, key=lambda row: row.date)
        values = [row.net_flow for row in rows]
        for index, row in enumerate(rows):
            flow_windows = {
                "flow1D": row.net_flow,
                "flow3D": sum(values[index - 2:index + 1]) if index >= 2 else None,
                "flow5D": sum(values[index - 4:index + 1]) if index >= 4 else None,
                "flow10D": sum(values[index - 9:index + 1]) if index >= 9 else None,
                "flow20D": sum(values[index - 19:index + 1]) if index >= 19 else None,
            }
            base = {"ticker": ticker, "signalDate": row.date, "provider": row.provider, **flow_windows}
            base["consecutivePositiveFlowDays"] = 0
            for prior in reversed(values[:index + 1]):
                if prior > 0:
                    base["consecutivePositiveFlowDays"] += 1
                else:
                    break
            base["positiveFlowCountIn5D"] = sum(1 for value in values[max(0, index - 4):index + 1] if value > 0)
            base["positiveFlowCountIn10D"] = sum(1 for value in values[max(0, index - 9):index + 1] if value > 0)
            base["positiveFlowCountIn20D"] = sum(1 for value in values[max(0, index - 19):index + 1] if value > 0)
            base["prior3DFlow"] = sum(values[index - 3:index]) if index >= 3 else None
            base["prior5DFlow"] = sum(values[index - 5:index]) if index >= 5 else None
            base_rows.append(base)
            for key in ("flow1D", "flow5D", "flow20D"):
                value = base.get(key)
                if value is not None:
                    percentile_maps[ticker][key].append(value)

    for ticker in percentile_maps:
        for key in percentile_maps[ticker]:
            percentile_maps[ticker][key].sort()

    price_lookup: dict[str, dict[str, int]] = {}
    price_lists: dict[str, list[PriceRow]] = {}
    for ticker, rows in prices_by_ticker.items():
        sorted_rows = sorted(rows, key=lambda row: row.date)
        price_lists[ticker] = sorted_rows
        price_lookup[ticker] = {row.date: index for index, row in enumerate(sorted_rows)}

    signal_rows: list[dict[str, Any]] = []
    for row in base_rows:
        ticker = row["ticker"]
        date = row["signalDate"]
        for key in ("flow1D", "flow5D", "flow20D"):
            value = row.get(key)
            if value is None:
                row[f"{key}PercentileWithinTicker"] = None
                row[f"{key}RankWithinTicker"] = None
                continue
            sorted_values = percentile_maps[ticker][key]
            row[f"{key}PercentileWithinTicker"] = percentile(sorted_values, value)
            row[f"{key}RankWithinTicker"] = 1 + sum(1 for item in sorted_values if item > value)

        prices = price_lists.get(ticker, [])
        index = price_lookup.get(ticker, {}).get(date)
        signal_close = prices[index].close if index is not None else None
        row["closePriceOnSignalDate"] = signal_close
        for horizon in HORIZONS:
            if index is None or signal_close is None or index + horizon >= len(prices):
                row[f"return_{horizon}D"] = None
                continue
            row[f"futureClose_{horizon}D"] = prices[index + horizon].close
            row[f"return_{horizon}D"] = prices[index + horizon].close / signal_close - 1
        for prior in (5, 10):
            if index is None or signal_close is None or index - prior < 0:
                row[f"priceReturn_{prior}D_prior"] = None
            else:
                row[f"priceReturn_{prior}D_prior"] = signal_close / prices[index - prior].close - 1
        signal_rows.append(row)
    return signal_rows


def signal_definitions() -> list[tuple[str, str, Any]]:
    definitions: list[tuple[str, str, Any]] = []
    for key in ("flow1D", "flow3D", "flow5D", "flow10D", "flow20D"):
        definitions.append((f"{key} > 0", "Simple positive flow", lambda row, k=key: row.get(k) is not None and row[k] > 0))
    for key in ("flow1D", "flow5D", "flow20D"):
        pct_key = f"{key}PercentileWithinTicker"
        for threshold in (70, 80, 90):
            definitions.append((
                f"{key} percentile >= {threshold}",
                "Strong inflow percentile",
                lambda row, k=pct_key, t=threshold: row.get(k) is not None and row[k] >= t,
            ))
        definitions.append((
            f"{key} percentile <= 10",
            "Large outflow risk",
            lambda row, k=pct_key: row.get(k) is not None and row[k] <= 10,
        ))
    definitions.extend([
        ("at least 3 positive days in latest 5D", "Persistent inflow", lambda row: row.get("positiveFlowCountIn5D", 0) >= 3),
        ("at least 4 positive days in latest 5D", "Persistent inflow", lambda row: row.get("positiveFlowCountIn5D", 0) >= 4),
        ("at least 7 positive days in latest 10D", "Persistent inflow", lambda row: row.get("positiveFlowCountIn10D", 0) >= 7),
        (
            "flow1D > 0 and flow3D > 0 and flow5D > 0",
            "Persistent inflow",
            lambda row: all(row.get(k) is not None and row[k] > 0 for k in ("flow1D", "flow3D", "flow5D")),
        ),
        (
            "flow3D > 0 and flow5D > 0 and flow10D > 0",
            "Persistent inflow",
            lambda row: all(row.get(k) is not None and row[k] > 0 for k in ("flow3D", "flow5D", "flow10D")),
        ),
        (
            "flow1D > 0 after prior 3D flow < 0",
            "Reversal",
            lambda row: row.get("flow1D") is not None and row["flow1D"] > 0 and row.get("prior3DFlow") is not None and row["prior3DFlow"] < 0,
        ),
        (
            "flow3D > 0 after prior 5D flow < 0",
            "Reversal",
            lambda row: row.get("flow3D") is not None and row["flow3D"] > 0 and row.get("prior5DFlow") is not None and row["prior5DFlow"] < 0,
        ),
        (
            "flow1D < 0 after prior 3D flow > 0",
            "Reversal",
            lambda row: row.get("flow1D") is not None and row["flow1D"] < 0 and row.get("prior3DFlow") is not None and row["prior3DFlow"] > 0,
        ),
        (
            "flow1D < 0 and flow3D < 0 and flow5D < 0",
            "Large outflow risk",
            lambda row: all(row.get(k) is not None and row[k] < 0 for k in ("flow1D", "flow3D", "flow5D")),
        ),
    ])
    return definitions


def compute_metrics(signal_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    total_by_horizon = {horizon: len(signal_rows) for horizon in HORIZONS}
    for name, category, predicate in signal_definitions():
        matching = [row for row in signal_rows if predicate(row)]
        for horizon in HORIZONS:
            key = f"return_{horizon}D"
            returns = [row[key] for row in matching if row.get(key) is not None]
            wins = [value for value in returns if value > 0]
            losses = [value for value in returns if value <= 0]
            sample_size = len(returns)
            results.append({
                "signalGroup": name,
                "category": category,
                "forwardHorizon": f"{horizon}D",
                "sampleSize": sample_size,
                "winRate": len(wins) / sample_size if sample_size else None,
                "avgReturn": average(returns),
                "medianReturn": median(returns),
                "maxReturn": max(returns) if returns else None,
                "minReturn": min(returns) if returns else None,
                "avgWinner": average(wins),
                "avgLoser": average(losses),
                "profitFactor": profit_factor(returns),
                "positiveReturnCount": len(wins),
                "negativeReturnCount": len(losses),
                "missingPriceRows": len(matching) - sample_size,
                "readyStatus": ready_status(sample_size),
                "matchedSignalRows": len(matching),
                "totalSignalRows": total_by_horizon[horizon],
            })
    return results


def pct(value: float | None) -> str:
    return "N/A" if value is None else f"{value * 100:.2f}%"


def num(value: float | None) -> str:
    return "N/A" if value is None else f"{value:.4f}"


def write_outputs(summary: dict[str, Any], metrics: list[dict[str, Any]]) -> None:
    OUTPUT_JSON_V199.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_CSV_V199.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_MD_V199.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON_V199.write_text(json.dumps({"summary": summary, "metrics": metrics}, indent=2))
    with OUTPUT_CSV_V199.open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(metrics[0].keys()) if metrics else [])
        if metrics:
            writer.writeheader()
            writer.writerows(metrics)

    top_5d = sorted(
        [row for row in metrics if row["forwardHorizon"] == "5D" and row["winRate"] is not None],
        key=lambda row: (row["winRate"], row["sampleSize"], row["avgReturn"] or -999),
        reverse=True,
    )[:10]
    top_10d_avg = sorted(
        [row for row in metrics if row["forwardHorizon"] == "10D" and row["avgReturn"] is not None],
        key=lambda row: (row["avgReturn"], row["sampleSize"]),
        reverse=True,
    )[:10]
    outflow = [
        row for row in metrics
        if row["category"] == "Large outflow risk" and row["forwardHorizon"] in {"5D", "10D", "20D"}
    ]

    def table(rows: list[dict[str, Any]]) -> str:
        lines = ["| Signal group | Horizon | Samples | Win rate | Avg return | Ready |", "|---|---:|---:|---:|---:|---|"]
        for row in rows:
            lines.append(
                f"| {row['signalGroup']} | {row['forwardHorizon']} | {row['sampleSize']} | "
                f"{pct(row['winRate'])} | {pct(row['avgReturn'])} | {row['readyStatus']} |"
            )
        return "\n".join(lines)

    ready_counts = Counter(row["readyStatus"] for row in metrics)

    md = f"""# Fixed List Moomoo Flow Win Rate Research V1.9.9

Research only. No production rule change. No automatic trading action.

## Dataset Summary

- Fixed tickers: {', '.join(summary['fixedTickers'])}
- Moomoo flow rows: {summary['moomooFlowRows']}
- Price rows: {summary['priceRows']}
- Forward return rows: {summary['forwardReturnRows']}
- Data source mode: {summary['dataSourceMode']}
- Date range: {summary['dateMin']} -> {summary['dateMax']}
- Usable signal rows: {summary['usableSignalRows']}
- Metrics generated: {len(metrics)}
- Ready status counts: {dict(ready_counts)}
- Missing price rows by horizon: {summary['missingPriceRowsByHorizon']}
- Data warning: {summary.get('dataWarning') or 'None'}

## Price Data Source Coverage

- Price date range: {summary.get('priceDateMin')} -> {summary.get('priceDateMax')}
- Price source counts: {summary.get('priceSourceCounts')}
- Price rows by ticker: {summary.get('priceRowsByTicker')}
- Missing forward price rows by horizon: {summary.get('missingForwardPriceRowsByHorizon')}

## Ticker Coverage

{json.dumps(summary['tickerCoverage'], indent=2)}

## Top 10 Signal Groups By 5D Win Rate

{table(top_5d)}

## Top 10 Signal Groups By 10D Avg Return

{table(top_10d_avg)}

## Outflow Risk Summary

{table(outflow[:10])}

## Signal Disagreement Notes

This research compares Moomoo flow conditions with forward returns only. It does not change the dashboard Entry Action, Position Action, scoring model, threshold simulation, rule promotion gate, A/B comparison, Risk Gate, or trading behavior.

## Limitations

- Fixed List only.
- Uses fixed-list archived daily close prices; missing signal/future prices are excluded per horizon.
- Recent dates lack longer forward-return horizons by definition.
- Moomoo XLSX rows provide net inflow only; daily collector rows may include buy/sell breakdown.
"""
    OUTPUT_MD_V199.write_text(md)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixed-list-only", action="store_true")
    parser.add_argument("--xlsx-file", default=DEFAULT_XLSX_FILE)
    parser.add_argument("--price-archive", default=DEFAULT_PRICE_ARCHIVE)
    args = parser.parse_args()
    if not args.fixed_list_only:
        print("--fixed-list-only is required for V1.9.9 research.")
        return 2
    load_env()
    flow_rows, price_rows, data_source_mode, data_warning = load_research_inputs(
        Path(args.xlsx_file),
        Path(args.price_archive),
    )
    signal_rows = build_signal_rows(flow_rows, price_rows)
    metrics = compute_metrics(signal_rows)
    date_values = [row.date for row in flow_rows]
    price_dates = [row.date for row in price_rows]
    ticker_coverage = {
        ticker: {
            "flowRows": sum(1 for row in flow_rows if row.ticker == ticker),
            "priceRows": sum(1 for row in price_rows if row.ticker == ticker),
            "flowDateMin": min([row.date for row in flow_rows if row.ticker == ticker], default=None),
            "flowDateMax": max([row.date for row in flow_rows if row.ticker == ticker], default=None),
        }
        for ticker in FIXED_LIST
    }
    missing_by_horizon = {
        f"{horizon}D": sum(1 for row in signal_rows if row.get(f"return_{horizon}D") is None)
        for horizon in HORIZONS
    }
    forward_rows_by_horizon = {
        f"{horizon}D": sum(1 for row in signal_rows if row.get(f"return_{horizon}D") is not None)
        for horizon in HORIZONS
    }
    provider_counts = Counter(row.provider for row in flow_rows)
    price_provider_counts = Counter(row.provider for row in price_rows)
    ready_counts = Counter(row["readyStatus"] for row in metrics)
    best_signal_groups = {
        "top5DWinRate": sorted(
            [
                row for row in metrics
                if row["forwardHorizon"] == "5D" and row["winRate"] is not None
            ],
            key=lambda row: (row["winRate"], row["sampleSize"], row["avgReturn"] or -999),
            reverse=True,
        )[:10],
        "top10DAvgReturn": sorted(
            [
                row for row in metrics
                if row["forwardHorizon"] == "10D" and row["avgReturn"] is not None
            ],
            key=lambda row: (row["avgReturn"], row["sampleSize"]),
            reverse=True,
        )[:10],
    }
    summary = {
        "version": "V1.9.9_FIXED_LIST_MOOMOO_FLOW_WIN_RATE_RESEARCH",
        "researchOnly": True,
        "productionRuleChanged": False,
        "fixedTickers": FIXED_LIST,
        "moomooFlowRows": len(flow_rows),
        "priceRows": len(price_rows),
        "forwardReturnRows": sum(forward_rows_by_horizon.values()),
        "forwardReturnRowsByHorizon": forward_rows_by_horizon,
        "dataSourceMode": data_source_mode,
        "dataWarning": data_warning,
        "dateMin": min(date_values) if date_values else None,
        "dateMax": max(date_values) if date_values else None,
        "priceDateMin": min(price_dates) if price_dates else None,
        "priceDateMax": max(price_dates) if price_dates else None,
        "usableSignalRows": len(signal_rows),
        "missingPriceRowsByHorizon": missing_by_horizon,
        "missingForwardPriceRowsByHorizon": missing_by_horizon,
        "providerCounts": dict(provider_counts),
        "priceSourceCounts": dict(price_provider_counts),
        "priceRowsByTicker": {
            ticker: sum(1 for row in price_rows if row.ticker == ticker)
            for ticker in FIXED_LIST
        },
        "metricsCount": len(metrics),
        "readyStatusSummary": dict(ready_counts),
        "bestSignalGroups": best_signal_groups,
        "tickerCoverage": ticker_coverage,
        "outputFiles": [str(OUTPUT_MD_V199), str(OUTPUT_JSON_V199), str(OUTPUT_CSV_V199)],
        "noTradingApiUsed": True,
    }
    write_outputs(summary, metrics)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
