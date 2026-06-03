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
- V1.7.8 Dashboard Action History + Calibration Simulation Foundation
- V1.7.9 Full Universe Scan Coverage
- V1.7.9.1 Universe Metadata Cleanup
- V1.7.9.2 Fixed Watchlist Update
- V1.8.0 Candidate Threshold Simulation Report

## Next Recommended Steps

- V1.8.1 Approved Rule Promotion Workflow
- V1.8.2 Old vs New Threshold A/B Comparison
- V1.8.3 Rolling-window Auto Recommendation without automatic production activation

## Later

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

V1.7.8 adds a compact Action History display and `/api/debug/action-history` so recent Entry and Position action changes can be compared against prior signal snapshots. It also adds a calibration simulation foundation to the win-rate report. Candidate threshold simulation is deferred until universe coverage is complete: production thresholds do not auto-change, and any future candidate rule must have sufficient sample size, improved win rate, improved average return, no material downside deterioration, and explicit review before production activation.

## Full Universe Scan Coverage

V1.7.9 was reprioritized ahead of candidate threshold simulation because incomplete universe coverage would bias win-rate optimization, threshold simulation, and future A/B tests. The release expands and diagnoses scan coverage across three logical pools: the preserved Fixed Watchlist 11, market cap $50B-$300B, and stock price above $800.

V1.7.9 uses a deterministic curated US liquid-equity seed universe as an interim full-universe foundation. The seed is light-filtered first with quote, price, and market-cap metadata, then merged and deduped with source bucket diagnostics. `/api/debug/universe` and `/api/cron/refresh` expose `universeCoverageSummary`, including deduped count, market-cap pool count, high-price pool count, overlap, missing quote fields, timeout skips, quota exhaustion, and proxy fallback tickers.

Provider quota protection is part of the release design. The expanded universe is not fully scored ticker by ticker. Light filtering determines membership first, then Margin / FCF / Capital Flow scoring runs only on the selected scan candidate subset. Existing archive-first behavior, provider budgets, timeout guard, and `YFINANCE_COMPOSITE_PROXY` fallback remain in force. Proxy-provider rows remain marked as proxy data and must not be treated as A-grade real-provider confirmation.

V1.7.9 does not change production Entry or Position action thresholds, scoring weights, provider ladder core logic, signal snapshot persistence, forward return tracking, win-rate calculation, calibration readiness, calibration simulation, or action history behavior.

Updated roadmap:

- V1.7.8 Dashboard Action History + Calibration Simulation Foundation
- V1.7.9 Full Universe Scan Coverage
- V1.7.9.1 Universe Metadata Cleanup
- V1.7.9.2 Fixed Watchlist Update
- V1.8.0 Candidate Threshold Simulation Report
- V1.8.1 Approved Rule Promotion Workflow
- V1.8.2 Old vs New Threshold A/B Comparison
- V1.8.3 Rolling-window Auto Recommendation without automatic production activation

## Universe Metadata Cleanup

V1.7.9.1 cleans up universe metadata without changing universe selection, scoring, provider ladder behavior, Entry / Position action rules, or production thresholds.

Rows that are present in the deterministic seed list but outside all V1.7.9 pools now report `sourceBucket: "OUTSIDE_V1_7_9_POOLS"` when `sourceBuckets` is empty. `MULTI_BUCKET` is reserved only for tickers that actually have more than one universe membership.

Ranked refresh items and their persisted `raw_item` payload now carry universe bucket metadata separately from the compatibility `sourceBucket` field. Existing `sourceBucket` values such as `MARKET_SCAN_TOP15` and `BOTH` remain unchanged, while `universeSourceBucket` and `universeSourceBuckets` expose the V1.7.9 membership labels.

## Fixed Watchlist Update

V1.7.9.2 updates the Fixed Watchlist 11 by removing `DXYZ` and adding `ORCL` in the same list position. The rest of the fixed watchlist order is unchanged.

This release does not change universe scan logic, scoring, provider ladder behavior, Entry / Position action rules, or production thresholds.

## Candidate Threshold Simulation Report

V1.8.0 adds `/api/debug/threshold-simulation?limit=500`, a safe candidate-threshold simulation report for stored signal snapshots and populated forward-return fields. It compares the current production Entry / Position action rules against multiple simulation-only candidate rule sets across 1D, 3D, 5D, 10D, and 20D forward-return windows.

The production baseline is read-only metadata: `V1.7.6_ENTRY_POSITION_ACTION_RULES`, `ACTIVE_PRODUCTION`, and `autoActivationAllowed: false`. Candidate rule sets also have `autoActivationAllowed: false`; they can be simulated and reported, but cannot auto-change production trading thresholds.

The report gates readiness with a default minimum of 30 forward-return samples. When samples are insufficient, it still returns `ok: true`, lists candidate rule sets, marks threshold simulation as Not Ready, sets `bestCandidate` to null, and recommends holding current production thresholds.

V1.8.0 does not change provider ladder logic, archive-first behavior, universe scan logic, Fixed Watchlist membership, Chaikin flow calculation, composite proxy calculation, normalized flow score, data quality scoring, current Entry / Position production rules, signal snapshot persistence, forward return calculation, action history, environment variables, or Supabase schema.

Future production threshold changes require a later explicit approval workflow / Risk Gate. The next roadmap items are V1.8.1 Approved Rule Promotion Workflow, V1.8.2 Old vs New Threshold A/B Comparison, and V1.8.3 Rolling-window Auto Recommendation without automatic production activation.
