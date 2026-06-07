#!/usr/bin/env python3
"""Calculate fixed-list same-day signal direction match win rates.

Research only. Win means signal direction matches same-day close price
direction. This script does not change production actions, scoring, thresholds,
Risk Gate behavior, or trading state.
"""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from calculate_moomoo_flow_win_rate import (
    DEFAULT_PRICE_ARCHIVE,
    DEFAULT_XLSX_FILE,
    FIXED_LIST,
    FlowRow,
    load_local_price_rows,
    load_local_xlsx_flow_rows,
)


OUTPUT_JSON = Path("data/research/signal_match_win_rate_v2025.json")
OUTPUT_CSV = Path("data/research/signal_match_win_rate_v2025.csv")
OUTPUT_MD = Path("docs/research/signal-match-win-rate-v2025.md")
DAILY_COLLECTOR_OVERLAY = Path("data/research/moomoo_daily_collector_overlay_v2021.json")
VERSION = "V2.0.2.5"
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
CATEGORIES = [
    "Strong Inflow",
    "Persistent Inflow",
    "Strong Outflow",
    "Persistent Outflow",
    "Flow Reversal",
]
THRESHOLD_MODE = "PER_TICKER_PERCENTILE"
STRONG_INFLOW_PERCENTILE = 0.8
STRONG_OUTFLOW_PERCENTILE = 0.2
PERSISTENT_LOOKBACK_DAYS = 5
PERSISTENT_MIN_DIRECTIONAL_DAYS = 3
FLOW_PROVIDER_PRIORITY = {
    "MOOMOO_CAPITAL_DISTRIBUTION": 3,
    "MOOMOO_CAPITAL_DISTRIBUTION_ARCHIVE": 3,
    "MOOMOO_HISTORICAL_XLSX_IMPORT": 2,
}


def pct(value: float | None) -> str:
    return "N/A" if value is None else f"{value * 100:.1f}%"


def direction_from_value(value: float | None) -> str:
    if value is None or value == 0:
        return "Neutral"
    return "Bullish" if value > 0 else "Bearish"


def flow_state_from_value(value: float | None) -> str:
    if value is None or value == 0:
        return "Flat"
    return "Inflow" if value > 0 else "Outflow"


def price_direction(today: float | None, previous: float | None) -> str:
    if today is None or previous is None or today == previous:
        return "Neutral"
    return "Up" if today > previous else "Down"


def result_for(signal_direction: str, close_direction: str) -> str:
    if signal_direction == "Bullish" and close_direction == "Up":
        return "Win"
    if signal_direction == "Bearish" and close_direction == "Down":
        return "Win"
    if signal_direction in {"Bullish", "Bearish"} and close_direction in {"Up", "Down"}:
        return "Fail"
    return "Excluded"


def percentile(values: list[float], value: float) -> float:
    if not values:
        return 0.0
    return sum(1 for item in values if item <= value) / len(values)


def build_flow_features(flow_rows: list[FlowRow]) -> dict[tuple[str, str], dict[str, Any]]:
    by_ticker: dict[str, list[FlowRow]] = defaultdict(list)
    for row in flow_rows:
        by_ticker[row.ticker].append(row)

    features: dict[tuple[str, str], dict[str, Any]] = {}
    for ticker, rows in by_ticker.items():
        rows = sorted(rows, key=lambda row: row.date)
        values = [row.net_flow for row in rows]
        sorted_values = sorted(values)
        for index, row in enumerate(rows):
            flow3 = sum(values[index - 2:index + 1]) if index >= 2 else None
            flow5 = sum(values[index - 4:index + 1]) if index >= 4 else None
            prior3 = sum(values[index - 3:index]) if index >= 3 else None
            prior5 = sum(values[index - 5:index]) if index >= 5 else None
            recent5 = values[max(0, index - 4):index + 1]
            recent10 = values[max(0, index - 9):index + 1]
            positive5 = sum(1 for value in recent5 if value > 0)
            negative5 = sum(1 for value in recent5 if value < 0)
            features[(ticker, row.date)] = {
                "netFlow": row.net_flow,
                "provider": row.provider,
                "flow3D": flow3,
                "flow5D": flow5,
                "flow1DPercentile": percentile(sorted_values, row.net_flow),
                "positiveFlowCountIn5D": positive5,
                "negativeFlowCountIn5D": negative5,
                "positiveFlowCountIn10D": sum(1 for value in recent10 if value > 0),
                "prior3DFlow": prior3,
                "prior5DFlow": prior5,
            }
    return features


def category_signal_direction(category: str, feature: dict[str, Any] | None) -> str:
    if not feature:
        return "Neutral"
    net_flow = feature.get("netFlow")
    if category == "Strong Inflow":
        if net_flow is not None and net_flow > 0 and feature.get("flow1DPercentile", 0) >= STRONG_INFLOW_PERCENTILE:
            return "Bullish"
        return "Neutral"
    if category == "Persistent Inflow":
        if feature.get("positiveFlowCountIn5D", 0) >= PERSISTENT_MIN_DIRECTIONAL_DAYS:
            return "Bullish"
        return "Neutral"
    if category == "Strong Outflow":
        if net_flow is not None and net_flow < 0 and feature.get("flow1DPercentile", 1) <= STRONG_OUTFLOW_PERCENTILE:
            return "Bearish"
        return "Neutral"
    if category == "Persistent Outflow":
        if feature.get("negativeFlowCountIn5D", 0) >= PERSISTENT_MIN_DIRECTIONAL_DAYS:
            return "Bearish"
        return "Neutral"
    if category == "Flow Reversal":
        if net_flow is not None and net_flow > 0 and (feature.get("prior3DFlow") or 0) < 0:
            return "Bullish"
        if net_flow is not None and net_flow < 0 and (feature.get("prior3DFlow") or 0) > 0:
            return "Bearish"
        return "Neutral"
    return "Neutral"



def primary_flow_state(feature: dict[str, Any] | None) -> str:
    """Return unified flow-state label using per-ticker thresholds.

    Priority:
    1. Flow Reversal
    2. Strong Inflow / Strong Outflow
    3. Persistent Inflow / Persistent Outflow
    4. Flat / Fluctuate
    """
    if not feature:
        return "Flat"

    net_flow = feature.get("netFlow")
    if net_flow is None or net_flow == 0:
        return "Flat"

    # Reversal has priority because it describes a regime change.
    if category_signal_direction("Flow Reversal", feature) != "Neutral":
        return "Flow Reversal"
    if category_signal_direction("Strong Inflow", feature) == "Bullish":
        return "Strong Inflow"
    if category_signal_direction("Strong Outflow", feature) == "Bearish":
        return "Strong Outflow"
    if category_signal_direction("Persistent Inflow", feature) == "Bullish":
        return "Persistent Inflow"
    if category_signal_direction("Persistent Outflow", feature) == "Bearish":
        return "Persistent Outflow"

    prior3 = feature.get("prior3DFlow")
    if prior3 is not None and ((net_flow > 0 and prior3 < 0) or (net_flow < 0 and prior3 > 0)):
        return "Flow Reversal"

    return "Flat"


def signal_direction_from_flow_state(flow_state: str, net_flow: float | None = None) -> str:
    if flow_state in {"Strong Inflow", "Persistent Inflow"}:
        return "Bullish"
    if flow_state in {"Strong Outflow", "Persistent Outflow"}:
        return "Bearish"
    if flow_state == "Flow Reversal":
        return direction_from_value(net_flow)
    return "Neutral"


def load_daily_collector_overlay(path: Path) -> list[FlowRow]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text())
    rows: list[FlowRow] = []
    for item in payload.get("rows", []):
        ticker = str(item.get("ticker", "")).upper()
        date = str(item.get("date", ""))
        if ticker not in FIXED_LIST or not date:
            continue
        try:
            net_flow = float(item["netFlow"])
        except (KeyError, TypeError, ValueError):
            continue
        rows.append(
            FlowRow(
                ticker=ticker,
                date=date,
                net_flow=net_flow,
                provider=str(item.get("provider") or payload.get("source") or "MOOMOO_CAPITAL_DISTRIBUTION_ARCHIVE"),
            )
        )
    return rows


def combine_flow_rows_with_priority(*row_sets: list[FlowRow]) -> list[FlowRow]:
    by_key: dict[tuple[str, str], FlowRow] = {}
    for row_set in row_sets:
        for row in row_set:
            key = (row.ticker, row.date)
            current = by_key.get(key)
            if current is None or FLOW_PROVIDER_PRIORITY.get(row.provider, 0) >= FLOW_PROVIDER_PRIORITY.get(current.provider, 0):
                by_key[key] = row
    return sorted(by_key.values(), key=lambda row: (row.ticker, row.date))


def build_price_maps(price_rows: list[Any]) -> tuple[dict[tuple[str, str], float], dict[str, list[str]]]:
    close_by_key = {(row.ticker, row.date): row.close for row in price_rows}
    dates_by_ticker: dict[str, list[str]] = defaultdict(list)
    for row in price_rows:
        dates_by_ticker[row.ticker].append(row.date)
    for ticker in dates_by_ticker:
        dates_by_ticker[ticker] = sorted(set(dates_by_ticker[ticker]))
    return close_by_key, dates_by_ticker


def daily_details_for_category(
    category: str,
    date: str,
    features: dict[tuple[str, str], dict[str, Any]],
    close_by_key: dict[tuple[str, str], float],
    dates_by_ticker: dict[str, list[str]],
) -> list[dict[str, Any]]:
    details: list[dict[str, Any]] = []
    for ticker in FIXED_LIST:
        ticker_dates = dates_by_ticker.get(ticker, [])
        if date not in ticker_dates:
            previous_date = None
        else:
            index = ticker_dates.index(date)
            previous_date = ticker_dates[index - 1] if index > 0 else None
        signal_direction = category_signal_direction(category, features.get((ticker, date)))
        close_direction = price_direction(
            close_by_key.get((ticker, date)),
            close_by_key.get((ticker, previous_date or "")),
        )
        result = result_for(signal_direction, close_direction)
        details.append({
            "ticker": ticker,
            "date": date,
            "signalCategory": category,
            "flowState": flow_state_from_value(features.get((ticker, date), {}).get("netFlow")),
            "signalDirection": signal_direction,
            "closeDirection": close_direction,
            "result": result,
            "netFlow": features.get((ticker, date), {}).get("netFlow"),
            "closePriceToday": close_by_key.get((ticker, date)),
            "closePricePreviousTradingDay": close_by_key.get((ticker, previous_date or "")),
        })
    return details


def daily_flow_direction_details(
    date: str,
    features: dict[tuple[str, str], dict[str, Any]],
    close_by_key: dict[tuple[str, str], float],
    dates_by_ticker: dict[str, list[str]],
) -> list[dict[str, Any]]:
    details: list[dict[str, Any]] = []
    for ticker in FIXED_LIST:
        ticker_dates = dates_by_ticker.get(ticker, [])
        if date not in ticker_dates:
            previous_date = None
        else:
            index = ticker_dates.index(date)
            previous_date = ticker_dates[index - 1] if index > 0 else None
        feature = features.get((ticker, date))
        net_flow = feature.get("netFlow") if feature else None
        flow_state = primary_flow_state(feature)
        signal_direction = signal_direction_from_flow_state(flow_state, net_flow)
        close_direction = price_direction(
            close_by_key.get((ticker, date)),
            close_by_key.get((ticker, previous_date or "")),
        )
        details.append({
            "ticker": ticker,
            "date": date,
            "signalCategory": "Flow State",
            "flowState": flow_state,
            "signalDirection": signal_direction,
            "closeDirection": close_direction,
            "result": result_for(signal_direction, close_direction),
            "netFlow": net_flow,
            "flowPercentileWithinTicker": feature.get("flow1DPercentile") if feature else None,
            "provider": feature.get("provider") if feature else None,
            "closePriceToday": close_by_key.get((ticker, date)),
            "closePricePreviousTradingDay": close_by_key.get((ticker, previous_date or "")),
        })
    return details


def summarize_daily(details: list[dict[str, Any]]) -> dict[str, Any]:
    wins = sum(1 for row in details if row["result"] == "Win")
    fails = sum(1 for row in details if row["result"] == "Fail")
    excluded = len(details) - wins - fails
    valid = wins + fails
    return {
        "checkedTickers": len(details),
        "validSamples": valid,
        "wins": wins,
        "fails": fails,
        "excluded": excluded,
        "dailyWinRate": wins / valid if valid else None,
    }


def trend_for(daily_rates: list[float]) -> str:
    if len(daily_rates) < 4:
        return "Stable"
    recent = sum(daily_rates[-3:]) / 3
    prior = sum(daily_rates[:3]) / 3
    if recent > prior + 0.05:
        return "Improving"
    if recent < prior - 0.05:
        return "Weakening"
    return "Stable"


def summarize_window_details(details: list[dict[str, Any]]) -> dict[str, Any]:
    wins = sum(1 for row in details if row["result"] == "Win")
    fails = sum(1 for row in details if row["result"] == "Fail")
    valid = wins + fails
    return {
        "wins": wins,
        "fails": fails,
        "valid": valid,
        "winRate": wins / valid if valid else None,
    }


def build_fixed_ticker_window_summary(
    common_dates: list[str],
    features: dict[tuple[str, str], dict[str, Any]],
    close_by_key: dict[tuple[str, str], float],
    dates_by_ticker: dict[str, list[str]],
) -> dict[str, Any]:
    details_by_date = {
        date: daily_flow_direction_details(date, features, close_by_key, dates_by_ticker)
        for date in common_dates
    }
    sum_windows: dict[str, dict[str, Any]] = {}
    ticker_rows: list[dict[str, Any]] = []

    for label, count in WINDOWS.items():
        window_dates = common_dates[-count:]
        details = [
            row
            for date in window_dates
            for row in details_by_date.get(date, [])
        ]
        sum_windows[label] = summarize_window_details(details)
        sum_windows[label]["daysIncluded"] = len(window_dates)

    for ticker in FIXED_LIST:
        windows: dict[str, dict[str, Any]] = {}
        for label, count in WINDOWS.items():
            window_dates = common_dates[-count:]
            details = [
                row
                for date in window_dates
                for row in details_by_date.get(date, [])
                if row["ticker"] == ticker
            ]
            windows[label] = summarize_window_details(details)
            windows[label]["daysIncluded"] = len(window_dates)
        ticker_rows.append({"ticker": ticker, "windows": windows})

    return {
        "definition": "SUM row uses total wins over total valid samples for the latest window. Ticker rows use each ticker's wins over valid days in the same window.",
        "sum": {
            "rank": "SUM",
            "ticker": "Fixed List Total",
            "windows": sum_windows,
        },
        "tickers": ticker_rows,
    }



def suggested_next_test_for_category(category: str, valid: int) -> str:
    if valid < 5:
        return "Collect more samples before threshold tuning"
    if category == "Strong Inflow":
        return "Test ticker-specific inflow percentile"
    if category == "Persistent Inflow":
        return "Test inflow persistence threshold"
    if category == "Strong Outflow":
        return "Test ticker-specific outflow percentile"
    if category == "Persistent Outflow":
        return "Test outflow persistence threshold"
    if category == "Flow Reversal":
        return "Test reversal confirmation filter"
    return "Review ticker-specific threshold"


def build_per_ticker_signal_diagnostics(
    common_dates: list[str],
    features: dict[tuple[str, str], dict[str, Any]],
    close_by_key: dict[tuple[str, str], float],
    dates_by_ticker: dict[str, list[str]],
) -> list[dict[str, Any]]:
    """Find each fixed ticker's strongest and weakest signal category/window.

    Research only. This does not change production thresholds or actions.
    Best/weak rows are based on same-day signal-direction match rate.
    """

    detail_cache: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for category in CATEGORIES:
        for date in common_dates:
            detail_cache[(category, date)] = daily_details_for_category(
                category,
                date,
                features,
                close_by_key,
                dates_by_ticker,
            )

    rows: list[dict[str, Any]] = []
    for ticker in FIXED_LIST:
        ticker_stats: list[dict[str, Any]] = []

        for category in CATEGORIES:
            for label, count in WINDOWS.items():
                window_dates = common_dates[-count:]
                details = [
                    row
                    for date in window_dates
                    for row in detail_cache.get((category, date), [])
                    if row["ticker"] == ticker
                ]
                summary = summarize_window_details(details)
                valid = summary["valid"]
                win_rate = summary["winRate"]

                if valid <= 0 or win_rate is None:
                    continue

                ticker_stats.append({
                    "ticker": ticker,
                    "category": category,
                    "window": label,
                    "wins": summary["wins"],
                    "fails": summary["fails"],
                    "valid": valid,
                    "winRate": win_rate,
                    "daysIncluded": len(window_dates),
                })

        if not ticker_stats:
            rows.append({
                "ticker": ticker,
                "bestFlowState": "N/A",
                "bestWindow": "N/A",
                "bestWinRate": None,
                "bestWins": 0,
                "bestValid": 0,
                "samples": 0,
                "weakFlowState": "N/A",
                "weakWindow": "N/A",
                "weakWinRate": None,
                "weakWins": 0,
                "weakValid": 0,
                "suggestedNextTest": "Missing valid signal-match samples",
            })
            continue

        # Prefer diagnostics with at least 5 samples. If unavailable, use any valid sample.
        preferred = [item for item in ticker_stats if item["valid"] >= 5] or ticker_stats

        best = max(
            preferred,
            key=lambda item: (
                item["winRate"],
                item["valid"],
                item["wins"],
            ),
        )
        weak = min(
            preferred,
            key=lambda item: (
                item["winRate"],
                -item["valid"],
            ),
        )

        rows.append({
            "ticker": ticker,
            "bestFlowState": best["category"],
            "bestWindow": best["window"],
            "bestWinRate": best["winRate"],
            "bestWins": best["wins"],
            "bestFails": best["fails"],
            "bestValid": best["valid"],
            "samples": best["valid"],
            "weakFlowState": weak["category"],
            "weakWindow": weak["window"],
            "weakWinRate": weak["winRate"],
            "weakWins": weak["wins"],
            "weakFails": weak["fails"],
            "weakValid": weak["valid"],
            "suggestedNextTest": suggested_next_test_for_category(best["category"], best["valid"]),
            "allCategoryWindowStats": ticker_stats,
        })

    return rows


def main() -> int:
    xlsx_flow_rows = load_local_xlsx_flow_rows(Path(DEFAULT_XLSX_FILE))
    daily_overlay_rows = load_daily_collector_overlay(DAILY_COLLECTOR_OVERLAY)
    flow_rows = combine_flow_rows_with_priority(xlsx_flow_rows, daily_overlay_rows)
    price_rows = load_local_price_rows(Path(DEFAULT_PRICE_ARCHIVE))
    features = build_flow_features(flow_rows)
    close_by_key, dates_by_ticker = build_price_maps(price_rows)
    flow_dates = sorted({row.date for row in flow_rows})
    price_dates = sorted({row.date for row in price_rows})
    common_dates = sorted(set(flow_dates) & set(price_dates))
    latest_date = common_dates[-1] if common_dates else None

    category_rows: list[dict[str, Any]] = []
    daily_by_category: dict[str, list[dict[str, Any]]] = {}
    for category in CATEGORIES:
        daily_rows: list[dict[str, Any]] = []
        for date in common_dates:
            details = daily_details_for_category(category, date, features, close_by_key, dates_by_ticker)
            daily_rows.append({"date": date, **summarize_daily(details)})
        daily_by_category[category] = daily_rows

        row: dict[str, Any] = {
            "category": category,
            "status": "Research",
            "latestDate": latest_date,
        }
        for label, count in WINDOWS.items():
            window = daily_rows[-count:]
            rates = [item["dailyWinRate"] for item in window if item["dailyWinRate"] is not None]
            row[f"winRate{label}"] = sum(rates) / len(rates) if rates else None
            row[f"daysIncluded{label}"] = len(rates)
        latest_window = daily_rows[-20:]
        total_wins = sum(item["wins"] for item in latest_window)
        total_fails = sum(item["fails"] for item in latest_window)
        row["totalWins"] = total_wins
        row["totalFails"] = total_fails
        row["validSamples"] = total_wins + total_fails
        row["trend"] = trend_for([item["dailyWinRate"] for item in latest_window if item["dailyWinRate"] is not None])
        category_rows.append(row)

    latest_flow_details = (
        daily_flow_direction_details(latest_date, features, close_by_key, dates_by_ticker)
        if latest_date
        else []
    )
    latest_summary = summarize_daily(latest_flow_details)
    fixed_ticker_window_summary = build_fixed_ticker_window_summary(
        common_dates,
        features,
        close_by_key,
        dates_by_ticker,
    )
    per_ticker_signal_diagnostics = build_per_ticker_signal_diagnostics(
        common_dates,
        features,
        close_by_key,
        dates_by_ticker,
    )
    payload = {
        "researchOnly": True,
        "productionRuleChanged": False,
        "version": VERSION,
        "thresholdMode": THRESHOLD_MODE,
        "strongInflowPercentile": STRONG_INFLOW_PERCENTILE,
        "strongOutflowPercentile": STRONG_OUTFLOW_PERCENTILE,
        "persistentLookbackDays": PERSISTENT_LOOKBACK_DAYS,
        "persistentMinDirectionalDays": PERSISTENT_MIN_DIRECTIONAL_DAYS,
        "thresholdMethodology": "Each ticker is compared against its own historical Moomoo netFlow distribution. Raw netFlow amounts are not compared globally across tickers.",
        "fixedTickers": FIXED_LIST,
        "fixedTickerCount": len(FIXED_LIST),
        "latestDate": latest_date,
        "definition": "Win = signal direction matches same-day close price direction.",
        "signalDirectionSource": "Flow State from Moomoo netFlow: Inflow/Bullish, Outflow/Bearish, Flat/Neutral.",
        "priceDirectionDefinition": "Up if today's close is above previous trading day's close; Down if below.",
        "latestFlowDirectionSummary": latest_summary,
        "categories": category_rows,
        "fixedTickerWindowSummary": fixed_ticker_window_summary,
        "perTickerSignalDiagnostics": per_ticker_signal_diagnostics,
        "dailyByCategory": daily_by_category,
        "latestDayDetails": latest_flow_details,
        "dataCoverage": {
            "moomooFlowRows": len(flow_rows),
            "priceRows": len(price_rows),
            "flowDateMin": min(flow_dates) if flow_dates else None,
            "flowDateMax": max(flow_dates) if flow_dates else None,
            "priceDateMin": min(price_dates) if price_dates else None,
            "priceDateMax": max(price_dates) if price_dates else None,
            "commonDateCount": len(common_dates),
            "xlsxFlowRows": len(xlsx_flow_rows),
            "dailyCollectorOverlayRows": len(daily_overlay_rows),
        },
        "notes": [
            "Same-day signal match rate is separate from forward-return research.",
            "Neutral or missing signal/price directions are excluded from valid samples.",
            "Research only. No production rule changed.",
        ],
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(payload, indent=2))
    with OUTPUT_CSV.open("w", newline="") as file:
        fieldnames = [
            "rank",
            "ticker",
            *[f"{label}Wins" for label in WINDOWS],
            *[f"{label}Valid" for label in WINDOWS],
            *[f"{label}WinRate" for label in WINDOWS],
        ]
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        fixed_rows = [
            fixed_ticker_window_summary["sum"],
            *[
                {"rank": index + 1, **row}
                for index, row in enumerate(fixed_ticker_window_summary["tickers"])
            ],
        ]
        for row in fixed_rows:
            csv_row: dict[str, Any] = {
                "rank": row["rank"],
                "ticker": row["ticker"],
            }
            for label in WINDOWS:
                window = row["windows"][label]
                csv_row[f"{label}Wins"] = window["wins"]
                csv_row[f"{label}Valid"] = window["valid"]
                csv_row[f"{label}WinRate"] = window["winRate"]
            writer.writerow(csv_row)

    table_lines = [
        "| Category | 1D | 3D | 5D | 10D | 20D | Valid | Trend |",
        "|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for row in category_rows:
        table_lines.append(
            f"| {row['category']} | {pct(row['winRate1D'])} | {pct(row['winRate3D'])} | "
            f"{pct(row['winRate5D'])} | {pct(row['winRate10D'])} | {pct(row['winRate20D'])} | "
            f"{row['validSamples']} | {row['trend']} |"
        )
    fixed_window_lines = [
        "| Rank | Ticker | 1D | 3D | 5D | 10D | 20D | 5W | 6W | 9W | 12W |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    fixed_rows = [
        fixed_ticker_window_summary["sum"],
        *[
            {"rank": index + 1, **row}
            for index, row in enumerate(fixed_ticker_window_summary["tickers"])
        ],
    ]
    for row in fixed_rows:
        fixed_window_lines.append(
            f"| {row['rank']} | {row['ticker']} | "
            + " | ".join(
                f"{row['windows'][label]['wins']} / {row['windows'][label]['valid']} = {pct(row['windows'][label]['winRate'])}"
                for label in WINDOWS
            )
            + " |"
        )
    detail_lines = [
        "| Ticker | Flow State / Signal Direction | Close Direction | Result |",
        "|---|---|---|---|",
    ]
    for row in latest_flow_details:
        detail_lines.append(
            f"| {row['ticker']} | {row['flowState']} / {row['signalDirection']} | {row['closeDirection']} | {row['result']} |"
        )
    OUTPUT_MD.write_text(
        f"""# Signal Direction Match Win Rate V2.0.2.3

Research only. No production rule changed. No automatic trading action.

Win = signal direction matches same-day close price direction. Fail = mismatch. Strong/weak flow states use per-ticker historical Moomoo netFlow percentiles.
Neutral or missing signal/price directions are excluded.

1D is the latest common fixed-list trading day. 3D, 5D, 10D, and 20D are
averages of daily fixed-list match rates over those windows.

The ticker-level fixed-list table uses raw total wins divided by raw valid
samples. The SUM row is not an average of rounded percentages.

## Methodology

- Threshold mode: PER_TICKER_PERCENTILE
- Strong Inflow: ticker's own flow percentile >= 80th percentile
- Strong Outflow: ticker's own flow percentile <= 20th percentile
- Persistent Inflow/Outflow: directional flow appears in at least 3 of the latest 5 trading days
- Flow states are calculated per ticker; NVDA is compared with NVDA history, IONQ with IONQ history, etc.

## Dataset

- Fixed tickers: {', '.join(FIXED_LIST)}
- Latest date: {latest_date}
- Moomoo flow rows: {payload['dataCoverage']['moomooFlowRows']}
- Price rows: {payload['dataCoverage']['priceRows']}
- Common dates: {payload['dataCoverage']['commonDateCount']}

## Signal Match Rates

{chr(10).join(table_lines)}

## Signal Match for Fixed List

{chr(10).join(fixed_window_lines)}

## Per-Ticker Signal Quality Diagnostics

| Ticker | Best Flow State | Best Window | Best Win Rate | Samples | Weak Flow State | Suggested Next Test |
|---|---|---:|---:|---:|---|---|
{chr(10).join(
    f"| {row['ticker']} | {row['bestFlowState']} | {row['bestWindow']} | {pct(row['bestWinRate'])} | {row['samples']} | {row['weakFlowState']} | {row['suggestedNextTest']} |"
    for row in per_ticker_signal_diagnostics
)}

## Latest-Day Flow State Details

{chr(10).join(detail_lines)}

## Limitations

- Fixed List only.
- Uses Moomoo netFlow flow state when historical Entry / Position signals are unavailable.
- Same-day match rate is not forward-return research.
- Research only. No production rule changed.
"""
    )
    print(json.dumps({
        "ok": True,
        "version": VERSION,
        "latestDate": latest_date,
        "fixedTickerCount": len(FIXED_LIST),
        "categories": category_rows,
        "latestFlowDirectionSummary": latest_summary,
        "outputFiles": [str(OUTPUT_JSON), str(OUTPUT_CSV), str(OUTPUT_MD)],
        "productionRuleChanged": False,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
