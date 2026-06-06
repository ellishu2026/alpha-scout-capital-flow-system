# Fixed List Moomoo Flow Win Rate Research V1.9.8

Research only. No production rule change. No automatic trading action.

## Dataset Summary

- Fixed tickers: SOXL, SMH, NVDA, MSFT, GOOGL, ORCL, RKLB, LLY, IONQ
- Moomoo flow rows: 753
- Price rows: 0
- Data source mode: LOCAL_XLSX_FLOW_ONLY
- Date range: 2026-01-16 -> 2026-06-04
- Usable signal rows: 753
- Metrics generated: 130
- Missing price rows by horizon: {'1D': 753, '3D': 753, '5D': 753, '10D': 753, '20D': 753}
- Data warning: SUPABASE_ENV_MISSING: price archive was unavailable locally; forward-return samples are Not Ready.

## Ticker Coverage

{
  "SOXL": {
    "flowRows": 96,
    "priceRows": 0,
    "flowDateMin": "2026-01-16",
    "flowDateMax": "2026-06-04"
  },
  "SMH": {
    "flowRows": 82,
    "priceRows": 0,
    "flowDateMin": "2026-02-06",
    "flowDateMax": "2026-06-04"
  },
  "NVDA": {
    "flowRows": 82,
    "priceRows": 0,
    "flowDateMin": "2026-02-06",
    "flowDateMax": "2026-06-04"
  },
  "MSFT": {
    "flowRows": 82,
    "priceRows": 0,
    "flowDateMin": "2026-02-06",
    "flowDateMax": "2026-06-04"
  },
  "GOOGL": {
    "flowRows": 82,
    "priceRows": 0,
    "flowDateMin": "2026-02-06",
    "flowDateMax": "2026-06-04"
  },
  "ORCL": {
    "flowRows": 82,
    "priceRows": 0,
    "flowDateMin": "2026-02-06",
    "flowDateMax": "2026-06-04"
  },
  "RKLB": {
    "flowRows": 82,
    "priceRows": 0,
    "flowDateMin": "2026-02-06",
    "flowDateMax": "2026-06-04"
  },
  "LLY": {
    "flowRows": 82,
    "priceRows": 0,
    "flowDateMin": "2026-02-06",
    "flowDateMax": "2026-06-04"
  },
  "IONQ": {
    "flowRows": 83,
    "priceRows": 0,
    "flowDateMin": "2026-02-05",
    "flowDateMax": "2026-06-04"
  }
}

## Top 10 Signal Groups By 5D Win Rate

| Signal group | Horizon | Samples | Win rate | Avg return | Ready |
|---|---:|---:|---:|---:|---|

## Top 10 Signal Groups By 10D Avg Return

| Signal group | Horizon | Samples | Win rate | Avg return | Ready |
|---|---:|---:|---:|---:|---|

## Outflow Risk Summary

| Signal group | Horizon | Samples | Win rate | Avg return | Ready |
|---|---:|---:|---:|---:|---|
| flow1D percentile <= 10 | 5D | 0 | N/A | N/A | Not Ready |
| flow1D percentile <= 10 | 10D | 0 | N/A | N/A | Not Ready |
| flow1D percentile <= 10 | 20D | 0 | N/A | N/A | Not Ready |
| flow5D percentile <= 10 | 5D | 0 | N/A | N/A | Not Ready |
| flow5D percentile <= 10 | 10D | 0 | N/A | N/A | Not Ready |
| flow5D percentile <= 10 | 20D | 0 | N/A | N/A | Not Ready |
| flow20D percentile <= 10 | 5D | 0 | N/A | N/A | Not Ready |
| flow20D percentile <= 10 | 10D | 0 | N/A | N/A | Not Ready |
| flow20D percentile <= 10 | 20D | 0 | N/A | N/A | Not Ready |
| flow1D < 0 and flow3D < 0 and flow5D < 0 | 5D | 0 | N/A | N/A | Not Ready |

## Signal Disagreement Notes

This research compares Moomoo flow conditions with forward returns only. It does not change the dashboard Entry Action, Position Action, scoring model, threshold simulation, rule promotion gate, A/B comparison, Risk Gate, or trading behavior.

## Limitations

- Fixed List only.
- Uses existing OHLCV archive close prices; missing signal/future prices are excluded per horizon.
- Recent dates lack longer forward-return horizons by definition.
- Moomoo XLSX rows provide net inflow only; daily collector rows may include buy/sell breakdown.
