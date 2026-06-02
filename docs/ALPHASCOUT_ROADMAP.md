# AlphaScout Roadmap

## Completed

- V1.6.1 Chaikin Flow
- V1.6.2 Normalized Flow Score
- V1.6.3.1 Alpha Vantage Real Provider + Archive
- V1.6.4 Archive Reuse
- V1.6.4.1 Archive-first before provider calls
- V1.6.5 Fixed 11 + Market Scan Top15 Provider Coverage Manager
- V1.6.5.1 Refresh coverage and dashboard alignment
- V1.6.6 Composite Proxy fallback
- V1.6.7 Provider Ladder Expansion
- V1.6.7.1 Cron Refresh Timeout Guard
- V1.6.7.2 Refresh Metrics Cleanup
- V1.6.8 Provider Data Quality Scoring
- V1.6.9 Flow Data Dashboard Diagnostics
- V1.6.9.1 Diagnostics Collapse & Quota Label Cleanup
- V1.6.9.2 Scoring Label, Diagnostics Summary Wording & Sticky Ticker Column
- V1.7.1 Signal Snapshot Table
- V1.7.1.1 Signal Snapshot Coverage Alignment
- V1.7.1.2 Fixed Watchlist Signal Snapshot Persistence
- V1.7.2 Forward Return Tracking
- V1.7.3 Win Rate & Signal Quality Report
- V1.7.4 Buy / Watch / Avoid Signal Upgrade

## Next Recommended Steps

- V1.7.5 Action Signal Calibration with Forward Returns
- V1.7.6 Dashboard Action History

## Later

- V1.5.1 Expand market universe
- V1.5.2 Scan performance optimization

## Signal Snapshot Foundation

V1.7.1 stores daily signal records in `alpha_scout_signal_snapshots`, one row per ticker, refresh date, mode, and source bucket. These rows preserve rank, scores, signal labels, provider metadata, and flow data quality diagnostics at the time of refresh.

V1.7.1.1 aligned signal snapshot persistence to save both Fixed Watchlist and Market Scan Top15 rows. Overlapping tickers are intentionally saved separately when mode and source bucket differ.

Forward return fields were added as placeholders in V1.7.1 and are populated by the V1.7.2 update job when enough future trading-day data is available. This table is the base for future win-rate and signal-quality analysis in V1.7.3 and signal upgrade work in V1.7.4.

## Forward Return Tracking

V1.7.2 calculates future returns for saved signal snapshots using trading-day windows: 1D, 3D, 5D, 10D, and 20D. Forward return fields are updated only when enough future trading-day data is available; otherwise they remain null until a later update run.

Forward return price lookup uses the conservative ladder `ARCHIVE -> ALPHA_VANTAGE -> TWELVE_DATA -> EODHD -> YFINANCE`, preferring archived OHLCV before consuming live provider calls. V1.7.3 will use these populated fields to calculate win rate and signal quality.

## Win Rate & Signal Quality Report

V1.7.3 summarizes stored signal outcomes using populated forward return fields in `alpha_scout_signal_snapshots`. Null forward returns are excluded from win-rate and return calculations instead of being treated as losses.

The report groups performance by signal, mode, source bucket, data quality grade, provider, capital flow score bucket, and composite score bucket. It becomes more meaningful as more signal dates and forward return samples accumulate.

## Action Signal Layer

V1.7.4 creates a final decision-support action layer: Buy Candidate, Watch, Avoid, or Insufficient Data. This is not auto-trading; it is a trade-assist signal derived from the existing raw signal, score inputs, provider metadata, data quality, source bucket, and risk controls.

Data quality and provider type can downgrade raw accumulation signals. `YFINANCE_COMPOSITE_PROXY` signals should not become Buy Candidate until validated, and B/C quality signals are downgraded to Watch unless risk controls require Avoid. Future versions may use V1.7.3 win-rate statistics to further calibrate action thresholds.
