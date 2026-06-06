#!/usr/bin/env python3
"""Review V1.9.9 Moomoo flow win-rate results and select candidates.

Research only. No production rule, scoring, threshold, Risk Gate, or trading
behavior is changed.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import calculate_moomoo_flow_win_rate as winrate


INPUT_JSON = Path("data/research/moomoo_flow_win_rate_v199.json")
OUTPUT_JSON = Path("data/research/moomoo_flow_signal_candidates_v200.json")
OUTPUT_CSV = Path("data/research/moomoo_flow_signal_candidates_v200.csv")
OUTPUT_MD = Path("docs/research/moomoo-flow-signal-candidates-v200.md")
VERSION = "V2.0.0"
NEXT_STEP = "V2.0.1 Flow Threshold Simulation"


def pct(value: float | None) -> str:
    return "N/A" if value is None else f"{value * 100:.2f}%"


def fmt(value: float | None) -> str:
    return "N/A" if value is None else f"{value:.4f}"


def avg(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def load_v199(input_path: Path = INPUT_JSON) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = json.loads(input_path.read_text())
    return payload.get("summary") or {}, payload.get("metrics") or []


def build_signal_context() -> tuple[list[dict[str, Any]], dict[tuple[str, str], dict[str, Any]], dict[str, Any]]:
    flow_rows, price_rows, data_source_mode, data_warning = winrate.load_research_inputs(
        Path(winrate.DEFAULT_XLSX_FILE),
        winrate.DEFAULT_PRICE_ARCHIVE,
    )
    signal_rows = winrate.build_signal_rows(flow_rows, price_rows)
    predicates = {name: (category, predicate) for name, category, predicate in winrate.signal_definitions()}
    context: dict[tuple[str, str], dict[str, Any]] = {}
    for signal_name, (category, predicate) in predicates.items():
        matching = [row for row in signal_rows if predicate(row)]
        for horizon in winrate.HORIZONS:
            key = f"return_{horizon}D"
            valid = [row for row in matching if row.get(key) is not None]
            ticker_counts = Counter(row["ticker"] for row in valid)
            returns_by_ticker: dict[str, list[float]] = defaultdict(list)
            for row in valid:
                returns_by_ticker[row["ticker"]].append(row[key])
            context[(signal_name, f"{horizon}D")] = {
                "category": category,
                "tickerCoverage": dict(ticker_counts),
                "contributingTickerCount": len(ticker_counts),
                "dominantTicker": ticker_counts.most_common(1)[0][0] if ticker_counts else None,
                "dominantTickerSamplePct": (
                    ticker_counts.most_common(1)[0][1] / len(valid) if valid else None
                ),
                "dateCoverage": {
                    "min": min((row["signalDate"] for row in valid), default=None),
                    "max": max((row["signalDate"] for row in valid), default=None),
                },
                "avgReturnByTicker": {
                    ticker: avg(values)
                    for ticker, values in sorted(returns_by_ticker.items())
                },
            }
    summary = {
        "dataSourceMode": data_source_mode,
        "dataWarning": data_warning,
        "flowRows": len(flow_rows),
        "priceRows": len(price_rows),
        "signalRows": len(signal_rows),
    }
    return signal_rows, context, summary


def same_signal_positive_horizons(metrics: list[dict[str, Any]]) -> dict[str, int]:
    grouped: dict[str, set[str]] = defaultdict(set)
    for row in metrics:
        if (
            row.get("sampleSize", 0) >= 80
            and row.get("winRate") is not None
            and row["winRate"] >= 0.52
            and row.get("avgReturn") is not None
            and row["avgReturn"] > 0
        ):
            grouped[row["signalGroup"]].add(row["forwardHorizon"])
    return {key: len(value) for key, value in grouped.items()}


def classify(row: dict[str, Any], context: dict[str, Any], positive_horizon_count: int) -> tuple[str, str, list[str]]:
    sample_size = int(row.get("sampleSize") or 0)
    win_rate = row.get("winRate")
    avg_return = row.get("avgReturn")
    median_return = row.get("medianReturn")
    avg_winner = row.get("avgWinner")
    avg_loser = row.get("avgLoser")
    profit_factor = row.get("profitFactor")
    category = row.get("category")
    ticker_count = int(context.get("contributingTickerCount") or 0)
    dominant_pct = context.get("dominantTickerSamplePct")
    notes: list[str] = []

    if row.get("readyStatus") != "Usable" or sample_size < 80:
        if sample_size < 30:
            return "Not Ready", "Insufficient sample size", ["sampleSize < 30"]
        return "Watch", "Sample size below usable threshold", ["30 <= sampleSize < 80"]

    if ticker_count < 5:
        notes.append("contributing tickers < 5")
    if dominant_pct is not None and dominant_pct > 0.45:
        notes.append("dominant ticker concentration > 45%")
    if avg_loser is not None and avg_winner is not None and avg_loser < 0:
        winner_loser_ratio = avg_winner / abs(avg_loser) if avg_loser else None
        if winner_loser_ratio is not None and winner_loser_ratio < 0.8:
            notes.append("avg loser large versus avg winner")

    weak_or_negative = (
        avg_return is not None
        and median_return is not None
        and avg_return < 0
        and median_return < 0
    )
    if sample_size < 30 or weak_or_negative:
        return "Rejected", "Weak or negative forward-return behavior", notes

    risk_pattern = category == "Large outflow risk" or "flow1D < 0" in row.get("signalGroup", "")
    if risk_pattern:
        if avg_return is not None and avg_return < 0 and (win_rate is None or win_rate < 0.48):
            return "Risk / Reduce", "Outflow pattern with negative forward-return behavior", notes
        return "Watch", "Outflow pattern did not behave as a clean reduce signal; review as confirmation only", notes

    baseline_candidate = (
        win_rate is not None
        and win_rate > 0.52
        and avg_return is not None
        and avg_return > 0
        and median_return is not None
        and median_return >= -0.002
        and ticker_count >= 5
        and (dominant_pct is None or dominant_pct <= 0.45)
    )
    stronger_candidate = (
        baseline_candidate
        and win_rate >= 0.55
        and median_return > 0
        and profit_factor is not None
        and profit_factor > 1.1
        and positive_horizon_count >= 2
    )
    if stronger_candidate:
        return "Candidate", "Strong multi-horizon buy/long candidate", notes
    if baseline_candidate:
        return "Candidate", "Baseline buy/long candidate", notes
    if win_rate is not None and win_rate > 0.5 and avg_return is not None and avg_return > 0:
        return "Watch", "Promising but below candidate guardrails", notes
    return "Rejected", "Does not meet positive behavior guardrails", notes


def review_candidates(summary: dict[str, Any], metrics: list[dict[str, Any]]) -> dict[str, Any]:
    _, context_by_key, context_summary = build_signal_context()
    positive_counts = same_signal_positive_horizons(metrics)
    reviewed: list[dict[str, Any]] = []
    for row in metrics:
        key = (row["signalGroup"], row["forwardHorizon"])
        context = context_by_key.get(key, {})
        bucket, reason, notes = classify(row, context, positive_counts.get(row["signalGroup"], 0))
        reviewed.append({
            "signalName": row["signalGroup"],
            "category": row["category"],
            "horizon": row["forwardHorizon"],
            "sampleSize": row["sampleSize"],
            "winRate": row["winRate"],
            "avgReturn": row["avgReturn"],
            "medianReturn": row["medianReturn"],
            "avgWinner": row["avgWinner"],
            "avgLoser": row["avgLoser"],
            "profitFactor": row["profitFactor"],
            "maxReturn": row["maxReturn"],
            "minReturn": row["minReturn"],
            "readyStatus": row["readyStatus"],
            "tickerCoverage": context.get("tickerCoverage", {}),
            "contributingTickerCount": context.get("contributingTickerCount", 0),
            "dominantTicker": context.get("dominantTicker"),
            "dominantTickerSamplePct": context.get("dominantTickerSamplePct"),
            "dateCoverage": context.get("dateCoverage", {}),
            "missingPriceRows": row["missingPriceRows"],
            "bucket": bucket,
            "selectionReason": reason,
            "notes": notes,
        })

    candidates = sorted(
        [row for row in reviewed if row["bucket"] == "Candidate"],
        key=lambda row: (row["winRate"] or 0, row["sampleSize"], row["avgReturn"] or -999),
        reverse=True,
    )
    watch = sorted(
        [row for row in reviewed if row["bucket"] == "Watch"],
        key=lambda row: (row["winRate"] or 0, row["sampleSize"], row["avgReturn"] or -999),
        reverse=True,
    )
    risk = sorted(
        [row for row in reviewed if row["bucket"] == "Risk / Reduce"],
        key=lambda row: (-(row["avgReturn"] or 0), row["sampleSize"]),
        reverse=True,
    )
    rejected = [row for row in reviewed if row["bucket"] in {"Rejected", "Not Ready"}]
    ticker_notes = ticker_diagnostics(reviewed)

    payload_summary = {
        "researchOnly": True,
        "productionRuleChanged": False,
        "version": VERSION,
        "inputVersion": summary.get("version"),
        "fixedTickers": summary.get("fixedTickers"),
        "moomooFlowRows": summary.get("moomooFlowRows"),
        "priceRows": summary.get("priceRows"),
        "forwardReturnRows": summary.get("forwardReturnRows"),
        "metricsCount": len(metrics),
        "candidateCount": len(candidates),
        "watchCount": len(watch),
        "riskSignalCount": len(risk),
        "rejectedCount": len(rejected),
        "readyStatusSummary": summary.get("readyStatusSummary"),
        "priceSourceCounts": summary.get("priceSourceCounts"),
        "contextSummary": context_summary,
        "recommendedNextStep": NEXT_STEP,
        "recommendedSimulationCandidates": candidates[:8],
        "topCandidates": candidates[:10],
        "topWatchSignals": watch[:10],
        "riskSignals": risk[:10],
        "tickerDiagnostics": ticker_notes,
        "signalDisagreementNotes": [
            "NVDA flow-only results should be reviewed separately from Entry/Position output; this report does not change Avoid/Exit production logic.",
            "Positive Moomoo flow can be a candidate confirmation layer, but current production action logic remains price/risk/scoring driven.",
        ],
        "limitations": [
            "Fixed List only.",
            "Price rows use the V1.9.9 fixed close price archive; current local run used YFINANCE_FALLBACK after Stooq returned no usable rows.",
            "No rule is promoted; V2.0.1 should run threshold simulation before any Risk Gate decision.",
        ],
    }
    return {
        "summary": payload_summary,
        "signals": reviewed,
    }


def ticker_diagnostics(reviewed: list[dict[str, Any]]) -> list[dict[str, Any]]:
    diagnostics: list[dict[str, Any]] = []
    for ticker in winrate.FIXED_LIST:
        rows = [
            row for row in reviewed
            if row.get("tickerCoverage", {}).get(ticker, 0) > 0
        ]
        scored = []
        for row in rows:
            count = row["tickerCoverage"][ticker]
            avg_by_ticker = None
            # Reconstruct approximate ticker note from aggregate signal behavior.
            score = (row.get("avgReturn") or 0) * count
            scored.append((score, row))
            avg_by_ticker = avg_by_ticker
        best = max(scored, key=lambda item: item[0])[1] if scored else None
        worst = min(scored, key=lambda item: item[0])[1] if scored else None
        role = "ETF / leveraged ETF" if ticker in {"SOXL", "SMH"} else "Higher-beta single name" if ticker in {"IONQ", "RKLB"} else "Mega-cap tech" if ticker in {"NVDA", "MSFT", "GOOGL", "ORCL"} else "Healthcare mega-cap"
        diagnostics.append({
            "ticker": ticker,
            "role": role,
            "signalSampleCount": sum(row.get("tickerCoverage", {}).get(ticker, 0) for row in reviewed),
            "bestSignalGroup": best["signalName"] if best else None,
            "bestSignalHorizon": best["horizon"] if best else None,
            "worstSignalGroup": worst["signalName"] if worst else None,
            "worstSignalHorizon": worst["horizon"] if worst else None,
            "notes": (
                "Review ETF/leveraged behavior separately from single-name signals."
                if ticker in {"SOXL", "SMH"}
                else "Review beta and event sensitivity before using flow as a standalone signal."
                if ticker in {"IONQ", "RKLB"}
                else "Flow may work better as confirmation than as a standalone production action trigger."
            ),
        })
    return diagnostics


def write_outputs(payload: dict[str, Any]) -> None:
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(payload, indent=2))

    signals = payload["signals"]
    with OUTPUT_CSV.open("w", newline="") as file:
        fieldnames = [
            "bucket",
            "signalName",
            "category",
            "horizon",
            "sampleSize",
            "winRate",
            "avgReturn",
            "medianReturn",
            "profitFactor",
            "readyStatus",
            "contributingTickerCount",
            "dominantTicker",
            "dominantTickerSamplePct",
            "missingPriceRows",
            "selectionReason",
            "notes",
        ]
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for row in signals:
            writer.writerow({key: row.get(key) for key in fieldnames})

    summary = payload["summary"]
    candidates = summary["topCandidates"]
    watch = summary["topWatchSignals"]
    risk = summary["riskSignals"]
    rejected = [
        row for row in signals
        if row["bucket"] in {"Rejected", "Not Ready"}
    ][:10]

    def table(rows: list[dict[str, Any]]) -> str:
        lines = [
            "| Bucket | Signal | Horizon | Samples | Win rate | Avg return | Median | PF | Tickers |",
            "|---|---|---:|---:|---:|---:|---:|---:|---:|",
        ]
        for row in rows:
            lines.append(
                f"| {row['bucket']} | {row['signalName']} | {row['horizon']} | {row['sampleSize']} | "
                f"{pct(row['winRate'])} | {pct(row['avgReturn'])} | {pct(row['medianReturn'])} | "
                f"{fmt(row['profitFactor'])} | {row['contributingTickerCount']} |"
            )
        return "\n".join(lines)

    md = f"""# Moomoo Flow Signal Candidates V2.0.0

Research only. No production rule changed. No automatic trading action.

## Executive Summary

- Candidate signals: {summary['candidateCount']}
- Watch signals: {summary['watchCount']}
- Risk / reduce signals: {summary['riskSignalCount']}
- Rejected / not ready signals: {summary['rejectedCount']}
- Recommended next step: {summary['recommendedNextStep']}

## Dataset Summary

- Moomoo flow rows: {summary['moomooFlowRows']}
- Price rows: {summary['priceRows']}
- Forward-return rows: {summary['forwardReturnRows']}
- Metrics reviewed: {summary['metricsCount']}
- Ready status summary: {summary['readyStatusSummary']}
- Price source summary: {summary['priceSourceCounts']}

## Top Candidate Buy / Long Signals

{table(candidates)}

## Watch / Confirmation Signals

{table(watch)}

## Risk / Reduce Signals

{table(risk)}

## Rejected / Not Ready Examples

{table(rejected)}

## Ticker-Level Notes

{json.dumps(summary['tickerDiagnostics'], indent=2)}

## Signal Disagreement Notes

- NVDA had prior flow/action disagreement; this report treats Moomoo flow as a research confirmation layer only.
- Existing Entry / Position actions remain unchanged and may remain more price/risk/momentum driven than flow-only metrics.

## Recommended Next Step For V2.0.1

Run Flow Threshold Simulation on the top candidate signals, with separate checks for ETFs (`SOXL`, `SMH`), mega-cap tech, healthcare, and higher-beta names. Do not promote to production before Risk Gate approval.

## Limitations

- Fixed List only.
- Uses V1.9.9 fixed close price archive. Current archive source is `{summary['priceSourceCounts']}`.
- Historical samples cover the imported Moomoo XLSX range and available close prices only.
- Research only. No production rule changed.
"""
    OUTPUT_MD.write_text(md)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=INPUT_JSON)
    args = parser.parse_args()
    summary, metrics = load_v199(Path(args.input))
    payload = review_candidates(summary, metrics)
    write_outputs(payload)
    print(json.dumps(payload["summary"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
