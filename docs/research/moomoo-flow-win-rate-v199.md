# Fixed List Moomoo Flow Win Rate Research V1.9.9

Research only. No production rule change. No automatic trading action.

## Dataset Summary

- Fixed tickers: SOXL, SMH, NVDA, MSFT, GOOGL, ORCL, RKLB, LLY, IONQ
- Moomoo flow rows: 753
- Price rows: 963
- Forward return rows: 3459
- Data source mode: LOCAL_XLSX_FLOW_FIXED_CLOSE_PRICE_ARCHIVE
- Date range: 2026-01-16 -> 2026-06-04
- Usable signal rows: 753
- Metrics generated: 130
- Ready status counts: {'Usable': 94, 'Watch': 33, 'Not Ready': 3}
- Missing price rows by horizon: {'1D': 0, '3D': 18, '5D': 36, '10D': 81, '20D': 171}
- Data warning: None

## Price Data Source Coverage

- Price date range: 2026-01-02 -> 2026-06-05
- Price source counts: {'YFINANCE_FALLBACK': 963}
- Price rows by ticker: {'SOXL': 107, 'SMH': 107, 'NVDA': 107, 'MSFT': 107, 'GOOGL': 107, 'ORCL': 107, 'RKLB': 107, 'LLY': 107, 'IONQ': 107}
- Missing forward price rows by horizon: {'1D': 0, '3D': 18, '5D': 36, '10D': 81, '20D': 171}

## Ticker Coverage

{
  "SOXL": {
    "flowRows": 96,
    "priceRows": 107,
    "flowDateMin": "2026-01-16",
    "flowDateMax": "2026-06-04"
  },
  "SMH": {
    "flowRows": 82,
    "priceRows": 107,
    "flowDateMin": "2026-02-06",
    "flowDateMax": "2026-06-04"
  },
  "NVDA": {
    "flowRows": 82,
    "priceRows": 107,
    "flowDateMin": "2026-02-06",
    "flowDateMax": "2026-06-04"
  },
  "MSFT": {
    "flowRows": 82,
    "priceRows": 107,
    "flowDateMin": "2026-02-06",
    "flowDateMax": "2026-06-04"
  },
  "GOOGL": {
    "flowRows": 82,
    "priceRows": 107,
    "flowDateMin": "2026-02-06",
    "flowDateMax": "2026-06-04"
  },
  "ORCL": {
    "flowRows": 82,
    "priceRows": 107,
    "flowDateMin": "2026-02-06",
    "flowDateMax": "2026-06-04"
  },
  "RKLB": {
    "flowRows": 82,
    "priceRows": 107,
    "flowDateMin": "2026-02-06",
    "flowDateMax": "2026-06-04"
  },
  "LLY": {
    "flowRows": 82,
    "priceRows": 107,
    "flowDateMin": "2026-02-06",
    "flowDateMax": "2026-06-04"
  },
  "IONQ": {
    "flowRows": 83,
    "priceRows": 107,
    "flowDateMin": "2026-02-05",
    "flowDateMax": "2026-06-04"
  }
}

## Top 10 Signal Groups By 5D Win Rate

| Signal group | Horizon | Samples | Win rate | Avg return | Ready |
|---|---:|---:|---:|---:|---|
| flow20D percentile <= 10 | 5D | 52 | 71.15% | 4.62% | Watch |
| flow1D > 0 after prior 3D flow < 0 | 5D | 147 | 67.35% | 4.63% | Usable |
| flow3D > 0 after prior 5D flow < 0 | 5D | 93 | 65.59% | 3.31% | Usable |
| flow1D percentile >= 80 | 5D | 146 | 65.07% | 4.33% | Usable |
| flow10D > 0 | 5D | 282 | 63.83% | 5.75% | Usable |
| at least 7 positive days in latest 10D | 5D | 119 | 62.18% | 8.38% | Usable |
| flow1D percentile >= 90 | 5D | 74 | 62.16% | 4.03% | Watch |
| flow3D > 0 and flow5D > 0 and flow10D > 0 | 5D | 199 | 60.30% | 5.44% | Usable |
| flow20D > 0 | 5D | 220 | 60.00% | 6.34% | Usable |
| flow1D percentile <= 10 | 5D | 65 | 60.00% | 5.33% | Watch |

## Top 10 Signal Groups By 10D Avg Return

| Signal group | Horizon | Samples | Win rate | Avg return | Ready |
|---|---:|---:|---:|---:|---|
| at least 7 positive days in latest 10D | 10D | 102 | 72.55% | 19.21% | Usable |
| flow3D > 0 and flow5D > 0 and flow10D > 0 | 10D | 180 | 71.11% | 14.05% | Usable |
| flow10D > 0 | 10D | 252 | 71.03% | 12.97% | Usable |
| flow20D > 0 | 10D | 186 | 64.52% | 12.90% | Usable |
| at least 4 positive days in latest 5D | 10D | 106 | 64.15% | 12.62% | Usable |
| flow5D percentile >= 80 | 10D | 123 | 70.73% | 11.74% | Usable |
| flow20D percentile >= 70 | 10D | 118 | 64.41% | 11.02% | Usable |
| flow1D > 0 and flow3D > 0 and flow5D > 0 | 10D | 166 | 60.84% | 10.90% | Usable |
| flow5D > 0 | 10D | 265 | 64.15% | 10.62% | Usable |
| at least 3 positive days in latest 5D | 10D | 259 | 63.71% | 10.58% | Usable |

## Outflow Risk Summary

| Signal group | Horizon | Samples | Win rate | Avg return | Ready |
|---|---:|---:|---:|---:|---|
| flow1D percentile <= 10 | 5D | 65 | 60.00% | 5.33% | Watch |
| flow1D percentile <= 10 | 10D | 57 | 64.91% | 8.93% | Watch |
| flow1D percentile <= 10 | 20D | 47 | 61.70% | 13.00% | Watch |
| flow5D percentile <= 10 | 5D | 61 | 49.18% | 2.37% | Watch |
| flow5D percentile <= 10 | 10D | 57 | 59.65% | 5.19% | Watch |
| flow5D percentile <= 10 | 20D | 51 | 60.78% | 11.00% | Watch |
| flow20D percentile <= 10 | 5D | 52 | 71.15% | 4.62% | Watch |
| flow20D percentile <= 10 | 10D | 49 | 63.27% | 6.15% | Watch |
| flow20D percentile <= 10 | 20D | 49 | 69.39% | 14.41% | Watch |
| flow1D < 0 and flow3D < 0 and flow5D < 0 | 5D | 245 | 55.10% | 2.87% | Usable |

## Signal Disagreement Notes

This research compares Moomoo flow conditions with forward returns only. It does not change the dashboard Entry Action, Position Action, scoring model, threshold simulation, rule promotion gate, A/B comparison, Risk Gate, or trading behavior.

## Limitations

- Fixed List only.
- Uses fixed-list archived daily close prices; missing signal/future prices are excluded per horizon.
- Recent dates lack longer forward-return horizons by definition.
- Moomoo XLSX rows provide net inflow only; daily collector rows may include buy/sell breakdown.
