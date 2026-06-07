# Signal Direction Match Win Rate V2.0.2.3

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

## Signal Match for Fixed List

| Rank | Ticker | 1D | 3D | 5D | 10D | 20D | 5W | 6W | 9W | 12W |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| SUM | Fixed List Total | 6 / 9 = 66.7% | 20 / 27 = 74.1% | 35 / 45 = 77.8% | 63 / 90 = 70.0% | 122 / 180 = 67.8% | 154 / 225 = 68.4% | 188 / 270 = 69.6% | 262 / 405 = 64.7% | 345 / 540 = 63.9% |
| 1 | SOXL | 1 / 1 = 100.0% | 1 / 3 = 33.3% | 3 / 5 = 60.0% | 8 / 10 = 80.0% | 18 / 20 = 90.0% | 23 / 25 = 92.0% | 27 / 30 = 90.0% | 38 / 45 = 84.4% | 47 / 60 = 78.3% |
| 2 | SMH | 1 / 1 = 100.0% | 2 / 3 = 66.7% | 3 / 5 = 60.0% | 5 / 10 = 50.0% | 8 / 20 = 40.0% | 11 / 25 = 44.0% | 13 / 30 = 43.3% | 19 / 45 = 42.2% | 29 / 60 = 48.3% |
| 3 | NVDA | 1 / 1 = 100.0% | 3 / 3 = 100.0% | 4 / 5 = 80.0% | 8 / 10 = 80.0% | 15 / 20 = 75.0% | 19 / 25 = 76.0% | 24 / 30 = 80.0% | 30 / 45 = 66.7% | 40 / 60 = 66.7% |
| 4 | MSFT | 0 / 1 = 0.0% | 2 / 3 = 66.7% | 3 / 5 = 60.0% | 7 / 10 = 70.0% | 14 / 20 = 70.0% | 17 / 25 = 68.0% | 20 / 30 = 66.7% | 30 / 45 = 66.7% | 40 / 60 = 66.7% |
| 5 | GOOGL | 0 / 1 = 0.0% | 2 / 3 = 66.7% | 4 / 5 = 80.0% | 7 / 10 = 70.0% | 13 / 20 = 65.0% | 17 / 25 = 68.0% | 21 / 30 = 70.0% | 29 / 45 = 64.4% | 34 / 60 = 56.7% |
| 6 | ORCL | 1 / 1 = 100.0% | 3 / 3 = 100.0% | 5 / 5 = 100.0% | 7 / 10 = 70.0% | 12 / 20 = 60.0% | 16 / 25 = 64.0% | 21 / 30 = 70.0% | 30 / 45 = 66.7% | 42 / 60 = 70.0% |
| 7 | RKLB | 1 / 1 = 100.0% | 3 / 3 = 100.0% | 5 / 5 = 100.0% | 8 / 10 = 80.0% | 14 / 20 = 70.0% | 18 / 25 = 72.0% | 23 / 30 = 76.7% | 30 / 45 = 66.7% | 39 / 60 = 65.0% |
| 8 | LLY | 0 / 1 = 0.0% | 1 / 3 = 33.3% | 3 / 5 = 60.0% | 6 / 10 = 60.0% | 13 / 20 = 65.0% | 16 / 25 = 64.0% | 20 / 30 = 66.7% | 31 / 45 = 68.9% | 42 / 60 = 70.0% |
| 9 | IONQ | 1 / 1 = 100.0% | 3 / 3 = 100.0% | 5 / 5 = 100.0% | 7 / 10 = 70.0% | 15 / 20 = 75.0% | 17 / 25 = 68.0% | 19 / 30 = 63.3% | 25 / 45 = 55.6% | 32 / 60 = 53.3% |

## Latest-Day Flow State Details

| Ticker | Flow State / Signal Direction | Close Direction | Result |
|---|---|---|---|
| SOXL | Flow Reversal / Bearish | Down | Win |
| SMH | Persistent Outflow / Bearish | Down | Win |
| NVDA | Flow Reversal / Bearish | Down | Win |
| MSFT | Flow Reversal / Bullish | Down | Fail |
| GOOGL | Flow Reversal / Bullish | Down | Fail |
| ORCL | Strong Outflow / Bearish | Down | Win |
| RKLB | Flow Reversal / Bearish | Down | Win |
| LLY | Flow Reversal / Bearish | Up | Fail |
| IONQ | Strong Outflow / Bearish | Down | Win |

## Limitations

- Fixed List only.
- Uses Moomoo netFlow flow state when historical Entry / Position signals are unavailable.
- Same-day match rate is not forward-return research.
- Research only. No production rule changed.
