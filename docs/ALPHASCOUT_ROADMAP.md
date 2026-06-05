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
- V1.8.1 Approved Rule Promotion Workflow
- V1.8.1.1 Threshold Control Panel UI Refinement
- V1.8.2 Old vs New Threshold A/B Comparison
- V1.8.3 Rolling-window Auto Recommendation without automatic production activation
- V1.8.4 Historical Win Rate Trend Chart
- V1.8.5 Trade Win Rate Leaderboard
- V1.8.5.1 Ranked Table Forward Window Columns
- V1.8.5.2 Ranked Table Flow Field Binding Fix
- V1.8.5.3 Replace 4W with 5W Window
- V1.8.6 Sticky Header & Sticky Columns
- V1.8.7 Real Buy/Sell Flow Source Audit & Proxy Calibration
- V1.8.8 Enhanced Flow Proxy Calibration
- V1.8.8.1 Enhanced Flow Calibration OHLCV Source Fix
- V1.8.9 Real Buy/Sell Flow Provider Deep Search
- V1.9.0 Flow Data Quality Upgrade
- V1.9.1 Flow Proxy Sanity Refresh / Est.Flow Only
- V1.9.1.1 Fixed Watchlist Refresh
- V1.9.1.2 Fixed Watchlist Page Mapping Fix
- V1.9.2 Moomoo Direct Capital Flow Provider
- V1.9.2.1 Moomoo Source Visibility & 1D Flow Binding Fix

## Next Recommended Steps

- Continue collecting forward return samples before threshold calibration review.

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
- V1.8.1.1 Threshold Control Panel UI Refinement
- V1.8.2 Old vs New Threshold A/B Comparison
- V1.8.3 Rolling-window Auto Recommendation without automatic production activation
- V1.8.4 Historical Win Rate Trend Chart
- V1.8.5 Trade Win Rate Leaderboard
- V1.8.5.1 Ranked Table Forward Window Columns
- V1.8.5.2 Ranked Table Flow Field Binding Fix
- V1.8.5.3 Replace 4W with 5W Window
- V1.8.6 Sticky Header & Sticky Columns
- V1.8.7 Real Buy/Sell Flow Source Audit & Proxy Calibration
- V1.8.8 Enhanced Flow Proxy Calibration
- V1.8.8.1 Enhanced Flow Calibration OHLCV Source Fix
- V1.8.9 Real Buy/Sell Flow Provider Deep Search
- V1.9.0 Flow Data Quality Upgrade

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

## Approved Rule Promotion Workflow

V1.8.1 adds `/api/debug/rule-promotion`, a read-only approval workflow foundation for future threshold rule changes. It defines the safe sequence `DRAFT -> SIMULATED -> RECOMMENDED -> APPROVED -> ACTIVE_PRODUCTION` and exposes an approval gate requiring explicit approval, risk review, sufficient samples, win-rate improvement, average-return improvement, and no material worst-return deterioration.

No candidate rule can become production automatically. `autoActivationAllowed` remains false for the current production rule and all candidate rule sets, and `autoPromotionAllowed` is false at the approval gate.

The current production rule remains `V1.7.6_ENTRY_POSITION_ACTION_RULES`. V1.8.1 does not change Entry / Position production rules, provider behavior, universe scan behavior, Fixed Watchlist membership, signal persistence, forward-return calculation, action history, environment variables, or Supabase schema.

Forward return samples are currently insufficient, so candidate promotion is not ready. Candidate rules remain blocked until the threshold simulation sample gate is satisfied and a later explicit Risk Gate approval workflow is completed.

Future roadmap:

- V1.8.4 Historical Win Rate Trend Chart

## Threshold Control Panel UI Refinement

V1.8.1.1 refines the expanded Win Rate / Threshold Simulation / Rule Promotion dashboard area into a compact threshold control panel. It adds pill-style display controls for candidate rule selection, A/B comparison, and approval workflow actions.

The panel shows Conservative, Balanced, Aggressive, DQ Strict, and Flow Strict candidate pills, a display-only Compare A/B pill, and promotion pills for Approve New Threshold, Reject Candidate, and Keep Current Rules. Approve New Threshold remains disabled until Risk Gate conditions are satisfied, including at least 30 forward return samples.

This is a UI-only change. It does not change production thresholds, candidate rule definitions, Entry / Position action rules, threshold simulation calculations, rule promotion backend logic, refresh logic, universe scan logic, provider logic, Supabase schema, or environment variables.

## Old vs New Threshold A/B Comparison

V1.8.2 adds `/api/debug/rule-ab?limit=500`, a reporting-only A/B comparison framework for threshold rule evaluation. Side A is the current production rule set, `V1.7.6_ENTRY_POSITION_ACTION_RULES`; Side B is a selected V1.8.0 candidate rule set, defaulting to Balanced Buy Candidate.

The report compares win rate, average return, median return, worst return, best return, sample count, and coverage across 1D, 3D, 5D, 10D, and 20D forward-return windows. It also documents valid-sample and win-rate definitions for Entry and Position action interpretation.

V1.8.2 does not switch production rules, auto-promote a candidate, change Entry / Position production action logic, or implement trading. Conclusions are blocked until enough forward return samples are available; the default minimum remains 30 samples.

## Rolling-window Auto Recommendation Without Automatic Production Activation

V1.8.3 adds `/api/debug/rolling-recommendation?limit=500`, a recommendation-only framework that evaluates recent signal performance across `last20Signals`, `last50Signals`, `last100Signals`, and `last250Signals`.

The system may recommend future candidate rule review when enough forward return samples exist and the candidate is supported by threshold simulation, A/B comparison, and rule promotion checks. It never auto-activates production thresholds, never auto-promotes candidates, and never executes trades.

Any future production rule change still requires sufficient forward return samples, threshold simulation, A/B comparison, rule promotion workflow, explicit approval, and Risk Gate review. V1.8.4 adds a Historical Win Rate Trend Chart for visualizing rolling win-rate over time.

## Historical Win Rate Trend Chart

V1.8.4 adds `/api/debug/win-rate-trend?limit=500`, a reporting-only endpoint for historical win-rate trend analysis. It visualizes current production rule performance and selected candidate rule performance over time using stored signal snapshots and populated forward-return fields.

The default comparison is Current Production vs Balanced Candidate on `forward5D` with a Rolling 20 window for Entry Buy Candidate signals. The endpoint supports forward windows 1D, 3D, 5D, 10D, and 20D, rolling windows 20, 50, and 100, and candidate selection across Conservative, Balanced, Aggressive, Data Quality Strict, and Flow Momentum Strict.

The dashboard adds a compact Historical Win Rate Trend section inside the Win Rate / Threshold Control Panel with rule, forward-window, and rolling-window pills. When forward-return samples are insufficient, the chart shows a Not Ready empty state and reports samples against the 30-sample minimum.

This release is visualization only. It does not change production thresholds, activate candidate rules, auto-promote candidates, alter Entry / Position action logic, or execute trades. Production threshold changes still require sufficient samples, threshold simulation, A/B comparison, rolling recommendation, rule promotion workflow, explicit approval, and Risk Gate review.

## Trade Win Rate Leaderboard

V1.8.5 restructures the expanded Win Rate panel into two clear sections: Rule Control Center and Trade Win Rate Leaderboard. Rule Control Center keeps production rule status, candidate threshold selection, A/B comparison, promotion gate, and rolling recommendation controls in a compact pill-style layout.

V1.8.5 adds `/api/debug/trade-win-rate-leaderboard?limit=500`, a reporting-only leaderboard with at least 10 model and threshold combinations. Rows include Current Production V1.7.6, Conservative Buy Candidate, Balanced Buy Candidate, Aggressive Buy Candidate, Data Quality Strict, Flow Momentum Strict, Balanced + Data Quality A, Balanced + Flow Momentum, Conservative + Low Drawdown, and Aggressive + High Coverage.

The leaderboard displays win-rate columns for 1D, 3D, 5D, 10D, 20D, 5W, 6W, 9W, and 12W and ranks rows by Composite Trade Rate Score when enough samples exist. Extended 5W, 6W, 9W, and 12W windows show N/A until forward-return fields are available.

Trade win-rate definitions are documented in the endpoint and dashboard: Buy Candidate and Hold win on positive forward return, while Avoid, Reduce, Sell Candidate, and Exit win on non-positive forward return. Valid samples require a populated forward-return field, and Win Rate is winCount divided by validSampleCount.

This release does not change production thresholds, Entry / Position production action logic, provider behavior, universe scan logic, signal snapshot persistence, forward-return calculation, Supabase schema, or environment variables.

## Ranked Table Forward Window Columns

V1.8.5.1 changes the main Ranked Candidates table capital-flow window columns from `Flow 3D`, `Flow 5D`, `Flow 9D`, `Flow 3W`, and `Flow 5W` to `1D`, `3D`, `5D`, `10D`, `20D`, `4W`, `6W`, `9W`, and `12W`.

These are capital-flow window values, not win-rate values. `1D` is the latest daily flow, `3D`, `5D`, `10D`, and `20D` are summed daily-flow windows, `4W` maps to approximately 20 trading days, `6W` to 30 trading days, `9W` to 45 trading days, and `12W` to 60 trading days.

Long windows show `N/A` when there is insufficient daily flow history. No fake long-window values are generated.

Display-window diagnostics are scoped to the current Top 11 ranked candidates plus the Fixed Watchlist 11, about 22 unique tickers. The release does not run a broad universe extended-window provider fetch, does not increase deep scoring coverage, and preserves provider quota protection and archive-first behavior.

V1.8.5.1 does not change production thresholds, Entry / Position action rules, provider ladder behavior, universe scan logic, Fixed Watchlist membership, signal snapshot persistence, forward-return calculation, Supabase schema, or environment variables.

## Ranked Table Flow Field Binding Fix

V1.8.5.2 fixes the frontend field mapping for the Ranked Candidates table flow-window columns. Backend refresh responses already included `capitalFlow1D`, `capitalFlow10D`, `capitalFlow20D`, `capitalFlow4W`, `capitalFlow6W`, `capitalFlow9W`, and `capitalFlow12W`; the table now reads those values correctly.

The table binding supports camelCase fields, snake_case fields, and `rawItem` / `raw_item` fallback payloads. Zero remains a valid displayed value, while null, undefined, and NaN still render as `N/A`.

This is a UI binding fix only. It does not change provider behavior, archive-first behavior, universe scan logic, scoring, Entry / Position action rules, production thresholds, Fixed Watchlist membership, Supabase schema, environment variables, or provider quota usage.

## Replace 4W with 5W Window

V1.8.5.3 replaces the visible 4W window with 5W in both the Ranked Candidates table and Trade Win Rate Leaderboard. The change avoids overlap between 4W and 20 trading days / 20D.

The visible window set is now 1D, 3D, 5D, 10D, 20D, 5W, 6W, 9W, and 12W. The ranked table maps 5W to the existing `capitalFlow5W` field, while `capitalFlow4W` remains available for backward compatibility and is not removed.

Trade Win Rate Leaderboard score weights now use 5W at 10% instead of 4W. If 5W forward-return data is unavailable, the leaderboard continues to show N/A rather than fake data.

Provider quota protection remains unchanged. Extended display-window calculations remain limited to the current Top 11 ranked candidates plus Fixed Watchlist 11 unique tickers. This release does not change production thresholds, Entry / Position action rules, scoring, provider behavior, universe scan logic, Fixed Watchlist membership, Supabase schema, or environment variables.

## Sticky Header & Sticky Columns

V1.8.6 improves table usability by making the Ranked Candidates table header sticky during vertical scrolling and keeping Rank, Chg, and Ticker sticky during horizontal scrolling.

The Trade Win Rate Leaderboard also gets a sticky header plus sticky Rank and Model + Threshold Combo columns. This keeps key identifiers visible on desktop and mobile while preserving horizontal scroll, compact row height, and one row per ticker.

This is a UI-only change. It does not change production thresholds, Entry / Position action rules, scoring, provider behavior, universe scan logic, Fixed Watchlist membership, Supabase schema, environment variables, or data fetching.

## Real Buy/Sell Flow Source Audit & Proxy Calibration

V1.8.7 adds `/api/debug/real-flow-audit?limit=26`, a research-only audit for whether true same-day buy amount and sell amount can be obtained for the limited display universe. The highest-quality target remains `realNetFlow = sameDayBuyAmount - sameDaySellAmount`, because data quality directly determines model quality.

The audit prioritizes real buy/sell or order-flow data first, classifies configured providers by available flow-data class, and reports when only OHLCV-derived data is available. If true buy/sell flow is unavailable, the endpoint computes an enhanced proxy from persisted OHLCV flow components: Chaikin daily flow, price-change weighted dollar flow, MFI-like flow, OBV directional flow, and close-location strength dollar flow.

Ticker scope is strictly capped to the current Top 11 ranked candidates plus the Fixed Watchlist 11, with a hard maximum of 26 unique tickers. The audit does not run against the full universe, does not consume live provider quota, and preserves archive-first/provider-quota protection.

This version does not change production flow values, scoring, Entry / Position action rules, production thresholds, provider ladder behavior, universe scan logic, Fixed Watchlist membership, Supabase schema, environment variables, or real trading behavior.

## Enhanced Flow Proxy Calibration

V1.8.8 adds `/api/debug/enhanced-flow-calibration?limit=26`, a research-only calibration endpoint for improving the simulated flow algorithm while true buy/sell/net flow remains unavailable. The true target remains `sameDayNetFlow = sameDayBuyAmount - sameDaySellAmount`.

The V1.8.8 proxy reduces over-reliance on Chaikin by using a weighted OHLCV component model: Chaikin flow, price-change weighted dollar flow, MFI-like flow, OBV directional flow, close-location flow, and gap-adjusted flow. Each component is clipped against average dollar volume or latest dollar volume, and the final weighted result is capped for magnitude sanity.

Rows include component breakdowns, clipped/raw values, direction confidence, component agreement, direction conflict flags, and comparisons against both legacy 1D flow and the V1.8.7 enhanced proxy.

Scope remains strictly limited to the current Top 11 ranked candidates plus Fixed Watchlist 11, with a hard maximum of 26 unique tickers. The endpoint reads persisted snapshots only, performs no live provider calls, and does not calculate enhanced calibration for the full universe.

Production flow, scoring, Entry / Position action rules, production thresholds, provider ladder behavior, universe scan logic, Fixed Watchlist membership, Supabase schema, environment variables, and real trading behavior are unchanged.

## Enhanced Flow Calibration OHLCV Source Fix

V1.8.8.1 fixes the V1.8.8 calibration issue where V188 components returned null because raw OHLCV inputs were not available in the endpoint row context. The calibration endpoint now reads OHLCV from embedded snapshot flow rows when present and falls back to existing archived OHLCV payloads.

Rows now report whether OHLCV input is available, the OHLCV source, rows used, missing fields, latest OHLCV values, previous close, and a clear unavailable reason when V188 cannot be computed.

The fix keeps production flow unchanged and remains scoped to the current Top 11 ranked candidates plus Fixed Watchlist 11, max 26 unique tickers. It performs no full-universe calculation and no live provider calls.

This release does not change production thresholds, scoring, Entry / Position actions, provider ladder behavior, universe scan logic, Fixed Watchlist membership, Supabase schema, environment variables, or real trading behavior.

## Real Buy/Sell Flow Provider Deep Search

V1.8.9 adds `/api/debug/real-flow-provider-deep-search?limit=26`, a provider-discovery and feasibility classification endpoint for finding whether any source can provide true or near-real buy amount, sell amount, net flow, active buy/sell, trade direction, order imbalance, large-order flow, auction imbalance, or depth-of-book pressure.

The core target remains `realNetFlow = sameDayBuyAmount - sameDaySellAmount`. Current production providers still do not expose true buy/sell/net flow, so V1.8.9 classifies current and potential providers across real flow, trade/order flow, order imbalance, depth/quote pressure, and OHLCV/indicator-only levels.

The discovery matrix includes current providers plus IEX, Nasdaq TotalView/NOII, NYSE imbalances, Databento, Intrinio, Tiingo, Alpaca, Tradier, Nasdaq Data Link, and Market Chameleon/MOC-style sources. It does not perform questionable scraping, broker-app bypassing, Webull scraping, or broad live data pulls.

Scope remains strictly limited to the current Top 11 ranked candidates plus Fixed Watchlist 11, max 26 unique tickers. V1.8.9 performs no live provider calls by default and makes no production flow, scoring, Entry / Position action, threshold, provider ladder, universe scan, Fixed Watchlist, Supabase schema, environment variable, or trading changes.

The findings guide V1.9.0 Flow Data Quality Upgrade.

## Flow Data Quality Upgrade

V1.9.0 formalizes flow data quality tiers from A through H/U. The highest-quality target remains `realNetFlow = sameDayBuyAmount - sameDaySellAmount`, but the current system still does not have true buy/sell/net flow access.

The tier model distinguishes real buy/sell net flow, trade direction/order flow, order imbalance, depth/quote pressure, provider money-flow indicators, enhanced OHLCV proxy, legacy OHLCV proxy, fallback proxy, and unknown/unavailable data. Ranked refresh rows and the new `/api/debug/flow-data-quality?limit=26` endpoint expose tier, label, confidence, real-flow availability, enhanced proxy availability, current production source, and recommended upgrade source metadata.

V1.8.8.1 enhanced proxy remains a research/calibration layer. Production flow values, scoring, Entry / Position action rules, and thresholds are unchanged; `productionFlowChanged` remains false.

Scope remains limited to the current Top 11 ranked candidates plus Fixed Watchlist 11, max 26 unique tickers. V1.9.0 performs no live provider calls, no full-universe flow quality calculation, no provider promotion, and no production trading-rule changes.

## Flow Proxy Sanity Refresh / Est.Flow Only

V1.9.1 refreshes displayed estimated flow values for the scoped dashboard ticker set using the Enhanced OHLCV Composite Proxy. The visible table wording changes from Flow to Est.Flow to make clear that these values are estimated from OHLCV proxy logic, not real buy amount minus sell amount.

The V1.9.1 display proxy uses 45% Chaikin Flow, 25% Price Change Weighted Flow, 20% MFI-like Flow, and 10% OBV Directional Flow, with high/low, invalid-volume, insufficient-history, and extreme-value caps. If scoped archive data is insufficient, the display reports insufficient proxy data rather than producing misleading values.

Scope remains capped at the current Top 11 ranked candidates plus Fixed Watchlist 11, max 26 unique tickers. V1.9.1 performs no live provider calls, no full-universe proxy refresh, no scoring changes, no Entry / Position rule changes, no threshold changes, and no production flow promotion. `productionFlowChanged` remains false.

## Fixed Watchlist Refresh

V1.9.1.1 removes `AMD` and `VRT` from the Fixed Watchlist only. The fixed watchlist order is now `SOXL`, `SMH`, `NVDA`, `MSFT`, `GOOGL`, `ORCL`, `RKLB`, `LLY`, and `IONQ`.

This is a composition update only. Est.Flow logic, Enhanced OHLCV Proxy logic, Entry / Position action rules, scoring, threshold simulation, rule promotion, A/B comparison, win-rate logic, forward returns, Risk Gate behavior, provider ladder, and universe scan rules are unchanged.

## Fixed Watchlist Page Mapping Fix

V1.9.1.2 fixes stale Fixed List membership on the page and API by recalculating saved snapshot Fixed Watchlist membership from the current source of truth. The effective Fixed Watchlist remains `SOXL`, `SMH`, `NVDA`, `MSFT`, `GOOGL`, `ORCL`, `RKLB`, `LLY`, and `IONQ`; `AMD` and `VRT` are no longer counted or labeled as Fixed List members.

This is a mapping fix only. It does not remove `AMD` or `VRT` from other organic universe pools, and it does not change Est.Flow, Enhanced OHLCV Proxy, scoring, Entry / Position actions, provider logic, or production thresholds.

## Moomoo Direct Capital Flow Provider

V1.9.2 adds `MOOMOO_CAPITAL_DISTRIBUTION` as an optional archive-first direct capital-flow provider for the scoped dashboard ticker set. It uses Moomoo OpenD quote/capital distribution data only, calculating buy amount from `capital_in_super`, `capital_in_big`, `capital_in_mid`, and `capital_in_small`, sell amount from `capital_out_super`, `capital_out_big`, `capital_out_mid`, and `capital_out_small`, and net flow as buy minus sell.

The provider is guarded to max 20 symbols per run, 25 requests per run, 1200ms request spacing, and one retry. Backfill remains throttled to max 5 symbols and 3 days per run if historical capital distribution is supported. If Moomoo is unavailable, rows fall back to the existing Enhanced OHLCV Proxy display path.

No trading API, order placement, account trading, position trading, production scoring change, Entry / Position rule change, threshold change, Risk Gate change, or universe expansion is introduced. `productionFlowChanged` remains false.

## Moomoo Source Visibility & 1D Flow Binding Fix

V1.9.2.1 makes Moomoo visible in the Provider Quota / Source Status UI even when production cannot reach local OpenD. The diagnostics now show Moomoo status, source label, scoped request guard, and the fallback message: Moomoo Direct Flow unavailable; using Enhanced OHLCV Proxy fallback.

The main Ranked Candidates 1D cell now explicitly prioritizes `moomooNetFlow` when `moomooFlowAvailable=true`; otherwise it uses the existing Enhanced OHLCV Proxy Est.Flow fallback and exposes `flow1DSource` / `oneDayFlowSource` metadata. Entry / Position actions, scoring, thresholds, provider ladder scope, fixed watchlist, and Risk Gate logic remain unchanged.
