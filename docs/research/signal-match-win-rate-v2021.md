# Signal Direction Match Win Rate V2.0.2.1

Research only. No production rule changed. No automatic trading action.

Win = signal direction matches same-day close price direction. Fail = mismatch.
Neutral or missing signal/price directions are excluded.

1D is the latest common fixed-list trading day. 3D, 5D, 10D, and 20D are
averages of daily fixed-list match rates over those windows.

## Dataset

- Fixed tickers: SOXL, SMH, NVDA, MSFT, GOOGL, ORCL, RKLB, LLY, IONQ
- Latest date: 2026-06-05
- Moomoo flow rows: 762
- Price rows: 963
- Common dates: 97

## Signal Match Rates

| Category | 1D | 3D | 5D | 10D | 20D | Valid | Trend |
|---|---:|---:|---:|---:|---:|---:|---|
| Strong Inflow | 0.0% | 50.0% | 75.0% | 77.1% | 76.9% | 57 | Weakening |
| Persistent Inflow | 0.0% | 33.3% | 48.0% | 56.3% | 59.5% | 104 | Weakening |
| Strong Outflow | 100.0% | 86.7% | 85.3% | 80.7% | 70.9% | 46 | Improving |
| Persistent Outflow | 85.7% | 61.9% | 63.1% | 61.6% | 61.1% | 76 | Weakening |
| Flow Reversal | 50.0% | 70.0% | 74.0% | 64.7% | 67.2% | 87 | Stable |

## Latest-Day Flow State Details

| Ticker | Flow State / Signal Direction | Close Direction | Result |
|---|---|---|---|
| SOXL | Outflow / Bearish | Down | Win |
| SMH | Outflow / Bearish | Down | Win |
| NVDA | Outflow / Bearish | Down | Win |
| MSFT | Inflow / Bullish | Down | Fail |
| GOOGL | Inflow / Bullish | Down | Fail |
| ORCL | Outflow / Bearish | Down | Win |
| RKLB | Outflow / Bearish | Down | Win |
| LLY | Outflow / Bearish | Up | Fail |
| IONQ | Outflow / Bearish | Down | Win |

## Limitations

- Fixed List only.
- Uses Moomoo netFlow flow state when historical Entry / Position signals are unavailable.
- Same-day match rate is not forward-return research.
- Research only. No production rule changed.
