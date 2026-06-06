# Moomoo Flow Signal Candidates V2.0.0

Research only. No production rule changed. No automatic trading action.

## Executive Summary

- Candidate signals: 82
- Watch signals: 45
- Risk / reduce signals: 0
- Rejected / not ready signals: 3
- Recommended next step: V2.0.1 Flow Threshold Simulation

## Dataset Summary

- Moomoo flow rows: 753
- Price rows: 963
- Forward-return rows: 3459
- Metrics reviewed: 130
- Ready status summary: {'Usable': 94, 'Watch': 33, 'Not Ready': 3}
- Price source summary: {'YFINANCE_FALLBACK': 963}

## Top Candidate Buy / Long Signals

| Bucket | Signal | Horizon | Samples | Win rate | Avg return | Median | PF | Tickers |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Candidate | flow3D > 0 and flow5D > 0 and flow10D > 0 | 20D | 125 | 77.60% | 34.97% | 16.25% | 16.7850 | 8 |
| Candidate | flow10D > 0 | 20D | 179 | 77.09% | 29.79% | 12.56% | 15.1437 | 8 |
| Candidate | flow5D percentile >= 70 | 20D | 122 | 74.59% | 24.53% | 11.28% | 15.6721 | 9 |
| Candidate | at least 7 positive days in latest 10D | 10D | 102 | 72.55% | 19.21% | 10.34% | 16.9596 | 8 |
| Candidate | flow3D > 0 and flow5D > 0 and flow10D > 0 | 10D | 180 | 71.11% | 14.05% | 6.84% | 9.3663 | 9 |
| Candidate | flow10D > 0 | 10D | 252 | 71.03% | 12.97% | 7.26% | 9.0529 | 9 |
| Candidate | flow5D percentile >= 80 | 10D | 123 | 70.73% | 11.74% | 7.69% | 10.5498 | 9 |
| Candidate | flow1D > 0 and flow3D > 0 and flow5D > 0 | 20D | 122 | 69.67% | 27.05% | 11.08% | 9.6796 | 9 |
| Candidate | at least 3 positive days in latest 5D | 20D | 200 | 69.00% | 25.24% | 10.89% | 9.5312 | 9 |
| Candidate | flow5D > 0 | 20D | 199 | 68.84% | 24.67% | 11.00% | 8.7804 | 9 |

## Watch / Confirmation Signals

| Bucket | Signal | Horizon | Samples | Win rate | Avg return | Median | PF | Tickers |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Watch | at least 7 positive days in latest 10D | 20D | 72 | 84.72% | 50.56% | 31.43% | 76.3990 | 7 |
| Watch | flow20D percentile >= 70 | 20D | 62 | 80.65% | 32.85% | 16.53% | 53.1476 | 9 |
| Watch | flow5D percentile >= 80 | 20D | 72 | 77.78% | 21.78% | 10.99% | 18.8800 | 9 |
| Watch | flow5D percentile >= 90 | 20D | 31 | 77.42% | 19.52% | 9.68% | 22.7981 | 8 |
| Watch | flow20D > 0 | 20D | 116 | 76.72% | 39.30% | 16.75% | 17.5218 | 8 |
| Watch | at least 4 positive days in latest 5D | 20D | 75 | 76.00% | 38.93% | 11.48% | 16.7641 | 8 |
| Watch | flow20D percentile <= 10 | 5D | 52 | 71.15% | 4.62% | 2.82% | 3.3618 | 9 |
| Watch | flow1D percentile >= 90 | 20D | 38 | 71.05% | 18.56% | 10.47% | 18.9668 | 9 |
| Watch | flow20D percentile <= 10 | 3D | 53 | 69.81% | 3.52% | 2.92% | 3.3122 | 9 |
| Watch | flow20D percentile <= 10 | 20D | 49 | 69.39% | 14.41% | 15.00% | 5.0988 | 8 |

## Risk / Reduce Signals

| Bucket | Signal | Horizon | Samples | Win rate | Avg return | Median | PF | Tickers |
|---|---|---:|---:|---:|---:|---:|---:|---:|

## Rejected / Not Ready Examples

| Bucket | Signal | Horizon | Samples | Win rate | Avg return | Median | PF | Tickers |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Not Ready | flow20D percentile >= 80 | 20D | 29 | 79.31% | 25.20% | 14.14% | 57.2698 | 5 |
| Not Ready | flow20D percentile >= 90 | 10D | 27 | 51.85% | 0.50% | 1.10% | 1.2072 | 7 |
| Not Ready | flow20D percentile >= 90 | 20D | 12 | 66.67% | 7.74% | 2.73% | 15.9949 | 4 |

## Ticker-Level Notes

[
  {
    "ticker": "SOXL",
    "role": "ETF / leveraged ETF",
    "signalSampleCount": 3990,
    "bestSignalGroup": "flow20D > 0",
    "bestSignalHorizon": "20D",
    "worstSignalGroup": "flow20D percentile >= 90",
    "worstSignalHorizon": "3D",
    "notes": "Review ETF/leveraged behavior separately from single-name signals."
  },
  {
    "ticker": "SMH",
    "role": "ETF / leveraged ETF",
    "signalSampleCount": 1863,
    "bestSignalGroup": "flow20D percentile >= 70",
    "bestSignalHorizon": "20D",
    "worstSignalGroup": "flow20D percentile >= 90",
    "worstSignalHorizon": "3D",
    "notes": "Review ETF/leveraged behavior separately from single-name signals."
  },
  {
    "ticker": "NVDA",
    "role": "Mega-cap tech",
    "signalSampleCount": 1559,
    "bestSignalGroup": "flow1D < 0 and flow3D < 0 and flow5D < 0",
    "bestSignalHorizon": "20D",
    "worstSignalGroup": "flow20D percentile >= 90",
    "worstSignalHorizon": "3D",
    "notes": "Flow may work better as confirmation than as a standalone production action trigger."
  },
  {
    "ticker": "MSFT",
    "role": "Mega-cap tech",
    "signalSampleCount": 2312,
    "bestSignalGroup": "flow10D > 0",
    "bestSignalHorizon": "20D",
    "worstSignalGroup": "flow20D percentile >= 90",
    "worstSignalHorizon": "3D",
    "notes": "Flow may work better as confirmation than as a standalone production action trigger."
  },
  {
    "ticker": "GOOGL",
    "role": "Mega-cap tech",
    "signalSampleCount": 2006,
    "bestSignalGroup": "flow1D > 0",
    "bestSignalHorizon": "20D",
    "worstSignalGroup": "flow20D percentile >= 90",
    "worstSignalHorizon": "3D",
    "notes": "Flow may work better as confirmation than as a standalone production action trigger."
  },
  {
    "ticker": "ORCL",
    "role": "Mega-cap tech",
    "signalSampleCount": 2461,
    "bestSignalGroup": "at least 3 positive days in latest 5D",
    "bestSignalHorizon": "20D",
    "worstSignalGroup": "flow20D percentile >= 90",
    "worstSignalHorizon": "3D",
    "notes": "Flow may work better as confirmation than as a standalone production action trigger."
  },
  {
    "ticker": "RKLB",
    "role": "Higher-beta single name",
    "signalSampleCount": 1767,
    "bestSignalGroup": "flow1D > 0",
    "bestSignalHorizon": "20D",
    "worstSignalGroup": "flow20D percentile >= 90",
    "worstSignalHorizon": "3D",
    "notes": "Review beta and event sensitivity before using flow as a standalone signal."
  },
  {
    "ticker": "LLY",
    "role": "Healthcare mega-cap",
    "signalSampleCount": 2023,
    "bestSignalGroup": "flow1D > 0",
    "bestSignalHorizon": "20D",
    "worstSignalGroup": "flow20D percentile >= 90",
    "worstSignalHorizon": "3D",
    "notes": "Flow may work better as confirmation than as a standalone production action trigger."
  },
  {
    "ticker": "IONQ",
    "role": "Higher-beta single name",
    "signalSampleCount": 2066,
    "bestSignalGroup": "flow1D > 0",
    "bestSignalHorizon": "20D",
    "worstSignalGroup": "flow20D percentile >= 90",
    "worstSignalHorizon": "3D",
    "notes": "Review beta and event sensitivity before using flow as a standalone signal."
  }
]

## Signal Disagreement Notes

- NVDA had prior flow/action disagreement; this report treats Moomoo flow as a research confirmation layer only.
- Existing Entry / Position actions remain unchanged and may remain more price/risk/momentum driven than flow-only metrics.

## Recommended Next Step For V2.0.1

Run Flow Threshold Simulation on the top candidate signals, with separate checks for ETFs (`SOXL`, `SMH`), mega-cap tech, healthcare, and higher-beta names. Do not promote to production before Risk Gate approval.

## Limitations

- Fixed List only.
- Uses V1.9.9 fixed close price archive. Current archive source is `{'YFINANCE_FALLBACK': 963}`.
- Historical samples cover the imported Moomoo XLSX range and available close prices only.
- Research only. No production rule changed.
