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
- V1.7.4.1 Action Signal Rule Tuning
- V1.7.5 Dashboard Action Layout Refinement
- V1.7.6 Entry / Position Action Split
- V1.7.7 Action Signal Calibration with Forward Returns

## Next Recommended Steps

- V1.7.8 Dashboard Action History
- V1.7.9 Calibration Threshold Tuning when samples are sufficient

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

V1.7.4.1 tunes the action rules so `NO_FORWARD_RETURN_HISTORY` and `MARKET_SCAN_ONLY` are risk flags only, not hard Avoid triggers. `PROVIDER_ERRORS_PRESENT` only forces a strong downgrade when final data quality is weak or the final provider failed. A-grade real-provider positive signals should not become Avoid unless severe score, breadth, or multi-window flow deterioration exists.

V1.7.5 refines the dashboard action layout while keeping one ticker per row. Action and confidence are displayed before the raw signal, provider and financial data source are merged into `Source`, and the ticker remains sticky during horizontal scroll. Entry / Position action split is deferred to V1.7.6.

V1.7.6 splits the action layer into entry action for no-position / new-entry decision support and position action for existing-position management. The system does not know actual holdings, so these fields are separate trade-assist views of the same signal context. Explicit database columns may be added later if action analytics require them.

V1.7.7 adds calibration readiness metrics for action signal evaluation with forward returns. Win-rate summaries now group by Entry action, Position action, legacy action, entry confidence, position confidence, data quality, provider, source bucket, and score buckets. V1.7.7 does not change action thresholds while forward-return samples are insufficient; the recommended minimum for initial calibration is 30 observations per window or group. The top-right `Selected` status field was removed from the dashboard header.
