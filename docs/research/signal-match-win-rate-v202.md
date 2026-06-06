# Signal Direction Match Win Rate V2.0.2

Research only. No production rule changed. No automatic trading action.

Win = signal direction matches same-day close price direction. Fail = mismatch.
Neutral or missing signal/price directions are excluded.

1D is the latest common fixed-list trading day. 3D, 5D, 10D, and 20D are
averages of daily fixed-list match rates over those windows.

## Dataset

- Fixed tickers: SOXL, SMH, NVDA, MSFT, GOOGL, ORCL, RKLB, LLY, IONQ
- Latest date: 2026-06-04
- Moomoo flow rows: 753
- Price rows: 963
- Common dates: 96

## Signal Match Rates

| Category | 1D | 3D | 5D | 10D | 20D | Valid | Trend |
|---|---:|---:|---:|---:|---:|---:|---|
| Flow Direction | 88.9% | 77.8% | 77.8% | 71.1% | 67.8% | 180 | Stable |
| Strong Inflow | 100.0% | 100.0% | 91.7% | 89.6% | 79.6% | 60 | Improving |
| Persistent Inflow | 66.7% | 46.7% | 58.0% | 63.0% | 61.1% | 108 | Weakening |
| Flow Reversal | 100.0% | 80.0% | 74.0% | 67.7% | 68.5% | 85 | Stable |
| Outflow Risk | 100.0% | 83.8% | 81.3% | 67.6% | 63.8% | 70 | Improving |

## Latest-Day Flow Direction Details

| Ticker | Signal Direction | Close Direction | Result |
|---|---|---|---|
| SOXL | Bullish | Down | Fail |
| SMH | Bearish | Down | Win |
| NVDA | Bullish | Up | Win |
| MSFT | Bullish | Up | Win |
| GOOGL | Bullish | Up | Win |
| ORCL | Bullish | Up | Win |
| RKLB | Bullish | Up | Win |
| LLY | Bullish | Up | Win |
| IONQ | Bearish | Down | Win |

## Limitations

- Fixed List only.
- Uses Moomoo netFlow direction when historical Entry / Position signals are unavailable.
- Same-day match rate is not forward-return research.
- Research only. No production rule changed.
