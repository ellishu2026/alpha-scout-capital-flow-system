# AlphaScout Capital Flow System - Change Log

## V1.6.9.1 Diagnostics Collapse & Quota Label Cleanup

- Collapsed Flow Data Diagnostics by default behind a compact dashboard toggle.
- Added a one-line diagnostics summary beside the scoring controls.
- Updated provider quota labels to `Used X / Left Y`.
- Updated dashboard title to V1.6.9.1.

## V1.6.9 Flow Data Dashboard Diagnostics

- Added a compact dashboard diagnostics section for refresh health, provider coverage, data quality, provider quota, and source ticker lists.
- Added provider short labels and flow-version hints to ticker rows.
- Added mobile ticker cards with signal, composite score, data quality, and provider source.
- Updated dashboard title to V1.6.9.

## V1.6.8 Provider Data Quality Scoring

- Added flow data quality scoring, grades, reasons, and transparent input diagnostics to ticker items and debug flow responses.
- Added provider coverage data quality summary with grade counts, average quality score, proxy tickers, stale tickers, and low-quality tickers.
- Added compact dashboard data quality display per ticker and an average data quality summary card.
- Updated real provider and composite proxy flow labels to V1.6.8.

## V1.6.7.2 Refresh Metrics Cleanup

- Added explicit cron refresh metric fields separating internal work-item counts from final unique ticker coverage.
- Kept `processedTickerCount` and `skippedTickerCount` as backward-compatible aliases for work-item counts.
- Added `metricDefinitions` to explain refresh metrics in the `/api/cron/refresh` JSON response.
- Updated dashboard and flow labels to V1.6.7.2.

## V1.6.7.1 Cron Refresh Timeout Guard

- Added a cron refresh elapsed-time guard that stops starting new ticker batches as the request approaches the production timeout.
- Added partial refresh response diagnostics: `timeoutGuardTriggered`, `processedTickerCount`, `skippedTickerCount`, `skippedTickers`, and `elapsedMs`.
- Preserved the V1.6.7 provider ladder and archive-first behavior.
- Updated dashboard and flow labels to V1.6.7.1.

## V1.6.7 Provider Ladder Expansion

- Added archive lookup support for `TWELVE_DATA` and `EODHD` after existing `POLYGON` and `ALPHA_VANTAGE` archive checks.
- Added live provider ladder order `ALPHA_VANTAGE` -> `TWELVE_DATA` -> `EODHD` -> `YFINANCE_COMPOSITE_PROXY`.
- Added Twelve Data and EODHD daily call budgets, coverage summary counters, ticker lists, and debug usage output.
- Updated real provider labels to `V1.6.7_PROVIDER_LADDER_CHAIKIN` and fallback labels to `V1.6.7_COMPOSITE_PROXY`.

## V1.6.6 Composite Capital Flow Proxy

- Replaced YFINANCE fallback flow with a composite proxy while keeping real provider and archive logic unchanged.
- Composite daily flow combines Chaikin flow, price-change-weighted flow, MFI-like flow, and OBV directional flow.
- Added composite proxy diagnostics for latest component flows and composite weights.
- Preserved `chaikinDailyFlowLatest` and legacy signed-dollar-volume diagnostics for comparison.
- Updated YFINANCE fallback labels to `V1.6.6_COMPOSITE_PROXY` and `YFINANCE_COMPOSITE_PROXY`.
- Added `compositeProxyFallbackCount` and `compositeProxyFallbackTickers` to provider coverage summary.
- Validation remains lint/build only; no localhost validation was used.

## V1.6.5.1 Polygon Live Call Guard

- Disabled Polygon live calls by default.
- Added `POLYGON_LIVE_ENABLED` flag; Polygon live calls only run when set to `true`.
- Polygon archive lookup remains enabled and does not count as a provider call.
- Alpha Vantage remains the primary live provider after archive miss.
- YFINANCE_CHAIKIN remains fallback when archive and Alpha Vantage are unavailable.
- Prevented wasted Polygon HTTP_401 attempts from refresh coverage runs.
- Added `polygonLiveEnabled` to provider coverage summary.
- Validation remains lint/build only; no localhost validation was used.

## V1.6.5 Provider Coverage Manager

- Added Provider Coverage Manager for daily refresh.
- Daily refresh now covers Fixed List 11 plus Market Scan Top 15 candidates.
- Added `refreshCoverageUniverse` behavior through deduped fixed-list and market-scan coverage metadata.
- Added `providerCoverageSummary` with archive hits, live provider hits, YFINANCE fallbacks, provider errors, and provider call budget fields.
- Archive hits do not consume provider quota.
- Alpha Vantage live calls remain capped by configured provider limits.
- YFINANCE_CHAIKIN remains fallback when archive and real provider data are unavailable.
- Added compact dashboard provider coverage diagnostics.
- Validation remains lint/build only; no localhost validation was used.

## V1.6.4.1 True Archive-First Provider Lookup

- Added true archive-first provider lookup before any Polygon or Alpha Vantage network calls.
- Reuses same-day archived OHLCV before external provider calls.
- Checks Polygon archive, then Alpha Vantage archive, before live provider priority begins.
- Prevents unnecessary Polygon 401 attempts when an Alpha Vantage archive row already exists.
- Reduces Alpha Vantage quota usage on repeated same-day requests.
- Added archive debug fields: `archiveLookupTried`, `archiveProviderChecked`, and `archiveHitProvider`.
- Added archive-specific flow version `V1.6.4.1_ARCHIVE_PROVIDER_CHAIKIN`.
- Validation remains lint/build only; no localhost validation was used.

## V1.6.4 Archive-First Provider Fetch

- Added archive-first lookup in `public.alpha_scout_market_data_archive` before external provider calls.
- Archive lookups use `ticker`, provider, and current UTC `data_date`.
- Polygon archive hits report `providerUsed = POLYGON_ARCHIVE`, `capitalFlowDataSource = POLYGON`, `capitalFlowQuality = REAL_PROVIDER`, and `archiveStatus = ARCHIVE_HIT`.
- Alpha Vantage archive hits report `providerUsed = ALPHA_VANTAGE_ARCHIVE`, `capitalFlowDataSource = ALPHA_VANTAGE`, `capitalFlowQuality = REAL_PROVIDER`, and `archiveStatus = ARCHIVE_HIT`.
- Archive hits do not consume provider call budget or increase provider call counters.
- Archive misses still call Polygon / Alpha Vantage within configured budget and archive successful responses.
- YFINANCE_CHAIKIN remains fallback when provider archive and live provider data are unavailable.
- Validation remains lint/build only; no localhost validation was used.

## V1.6.3.1 Provider Endpoint Fix

- Updated Polygon to use the REST aggregates daily endpoint with `limit=5000`.
- Updated Alpha Vantage to use the free `TIME_SERIES_DAILY` endpoint instead of `TIME_SERIES_DAILY_ADJUSTED`.
- Fixed Alpha Vantage daily volume parsing for the free endpoint.
- Updated flow version labels to `V1.6.3.1_REAL_PROVIDER_CHAIKIN` and `V1.6.3.1_YFINANCE_CHAIKIN`.
- Added `providerEndpointType` to flow diagnostics and persisted snapshot items.
- Validation remains lint/build only; no localhost validation was used.

## V1.6.3 Real Provider Data Archive

- Added Polygon and Alpha Vantage real OHLCV provider fetching ahead of the YFINANCE_CHAIKIN fallback.
- Added provider priority diagnostics and safe env-configurable call budgets.
- Normalized provider OHLCV responses into the existing Chaikin and normalized flow scoring pipeline.
- Added optional Supabase market data archive upsert support for real provider payloads.
- Real provider data now sets `capitalFlowQuality` to `REAL_PROVIDER`; YFINANCE_CHAIKIN remains the live proxy fallback.
- Added provider errors, archive status, provider-used metadata, and raw payload summaries to flow diagnostics.
- Added SQL documentation at `docs/alpha_scout_market_data_archive.sql`.
- Validation remains lint/build only; no localhost validation was used.

## V1.6.2 Normalized Capital Flow Scoring

- Added capital flow normalization while preserving raw Chaikin dollar flow values in the dashboard table.
- Added flow-to-market-cap metrics for 3D, 5D, 9D, 3W, and 5W windows.
- Added flow-to-average-dollar-volume metrics using latest 20 trading days of dollar volume.
- Added 9D flow consistency, direction breadth, and short-term flow acceleration.
- Updated `capitalFlowScore` to use `normalizedFlowScore` so ranking is less dominated by mega-cap raw dollar flow.
- Preserved `rawFlowScore` for diagnostics and continued storing legacy signed-dollar-volume fields.
- Validation remains lint/build only; no localhost validation was used.

## V1.6.1 Chaikin Capital Flow Proxy

- Changed capital flow calculation to Chaikin-style money flow using the daily high-low-close range.
- Replaced simple up/down signed dollar volume with `close * volume * moneyFlowMultiplier` for displayed flow windows.
- Preserved legacy signed dollar volume fields for diagnostics and persisted snapshots.
- Added provider framework for Polygon and Alpha Vantage with conservative daily call limits.
- Added YFINANCE_CHAIKIN fallback behavior when real-provider API keys or call budget are unavailable.
- Added CRON_SECRET-protected `/api/debug/flow?ticker=...` endpoint for capital flow diagnostics.
- Prepared optional market data archive writes for real provider data when the Supabase table exists.
- Validation remains lint/build only; no localhost validation was used.

## V1.3.10 LLY FY Minus Q3 FCF Recovery

- Fixed FY-minus-Q3-YTD OCF and CapEx tag matching for previous-quarter FCF recovery.
- Fixed LLY previous-quarter FCF recovery by matching OCF facts against OCF facts and CapEx facts against CapEx facts.
- Prevented OCF tags from being used to search or reject CapEx candidates.
- Preserved MSFT YTD-diff and GOOGL FY-minus-Q3-YTD behavior.
- Validation remains lint/build only; no localhost validation was used.

## V1.3.9 LLY FCF QoQ Recovery

- Fixed LLY previous-quarter FCF recovery diagnostics for SEC-derived QoQ calculations.
- Improved FY-minus-Q3-YTD previous Q4 recovery with explicit fiscal-year and Q3 YTD matching.
- Added candidate diagnostics for FY and Q3 YTD OCF/CapEx matching and rejection reasons.
- Preserved MSFT YTD-diff and GOOGL FY-minus-Q3-YTD behavior.
- Validation remains lint/build only; no localhost validation was used.

## V1.3.8 FCF QoQ Previous Quarter Recovery

- Improved previous-quarter FCF recovery for SEC-derived QoQ calculations.
- Added explicit FY-minus-Q3-YTD recovery for prior Q4 when current period is Q1.
- Restored safe YTD-diff recovery for previous quarters when current FCF is YTD-normalized.
- Added `previousQuarterSearch` and `previousQuarterSelectedPeriods` diagnostics to SEC debug output.
- Validation remains lint/build only; no localhost validation was used.

## V1.3.7 SEC Previous Quarter Selection

- Fixed SEC previous-quarter FCF selection so Q1 compares against prior fiscal-year Q4 instead of older Q3 periods.
- Added FY-minus-Q3-YTD derivation for Q4 FCF when direct Q4 quarter facts are unavailable.
- Added `previousQuarterMethod` diagnostics for direct quarter, FY minus Q3 YTD, YTD diff, or unavailable cases.
- Prevented unrelated older SEC cash-flow periods from being used as the previous quarter.
- Validation remains lint/build only; no localhost validation was used.

## V1.3.6 LLY SEC CapEx Extraction Diagnostics

- Investigated the LLY SEC FCF extraction gap where fresh OCF was available but fixed CapEx tags were stale or missing.
- Expanded CapEx tag coverage for common SEC/XBRL property, equipment, productive asset, and capital expenditure names.
- Added dynamic CapEx tag discovery across `us-gaap` facts with preference for cash-flow payment and purchase tags.
- Added SEC debug diagnostics for CapEx candidate tags and per-tag freshness.
- Improved reporting when OCF is fresh but no fresh CapEx-like tag can be matched.
- Validation remains lint/build only; no localhost validation was used.

## V1.3.5 Financial Score Stabilization

- Added financial score stabilization for SEC-derived FCF and margin scores.
- Extreme FCF QoQ is capped to -100%/+100% for scoring while preserving raw display values.
- Added low-base FCF protection for prior-quarter FCF below $100M.
- Added conservative handling for negative-to-positive FCF turnarounds.
- Margin change is capped to -20/+20 percentage points for scoring while preserving raw margin change.
- Added score input metadata for debug output and persisted snapshots.
- Validation remains lint/build only; no localhost validation was used.

## V1.3.4 SEC Quarterly FCF Normalization

- Added SEC quarterly FCF normalization for operating cash flow and CapEx facts.
- SEC facts are now classified by date duration as quarterly, YTD-normalized, annual, or unknown instead of relying only on `fp`.
- YTD cash-flow facts are differenced against prior YTD facts to estimate single-quarter FCF where reliable.
- Annual facts can estimate Q4 from FY minus Q3 YTD, or fall back to conservative annual scoring when no reliable quarterly normalization exists.
- Avoided using cumulative cash-flow facts directly as quarterly FCF.
- Financial debug output now includes selected period classifications and normalization notes.
- Validation remains lint/build only; no localhost validation was used.

## V1.3.3 SEC Latest Period Selection

- Fixed SEC financial period selection to collect all valid tag entries and prefer the latest 10-Q/10-K USD periods.
- Added a 24-month stale-data guard so old SEC facts, such as outdated MSFT 2011 values, are not used for current scoring.
- FCF now matches fresh operating cash flow and CapEx periods exactly or within a 45-day window instead of mixing unrelated periods.
- Current FCF can still be used when prior comparable QoQ data is unavailable.
- SEC debug output now includes selected period diagnostics and stale-data rejection status.
- Validation remains lint/build only; no localhost validation was used.

## V1.3.2 SEC CIK Mapping Fallback

- Added a static CIK fallback map for key market universe and fixed-list operating companies.
- Static CIK lookup now runs before the SEC ticker map request, avoiding `company_tickers.json` 403 failures for covered symbols.
- Improved SEC User-Agent default for both ticker map and CompanyFacts requests.
- MSFT, CRWD, GOOGL, ADBE, SHOP, URI, and other covered symbols should now reach CompanyFacts directly.
- SEC debug output now reports whether CompanyFacts was fetched.
- Validation remains lint/build only; no localhost validation was used.

## V1.3.1 SEC Financial Enrichment Coverage

- Fixed SEC enrichment coverage for both Market Scan and Fixed List candidate construction.
- Improved SEC CompanyFacts tag extraction for revenue, income, operating cash flow, and CapEx variants.
- Current FCF can now be used even when QoQ FCF is unavailable.
- Added a CRON_SECRET-protected `/api/debug/sec-financial?ticker=...` endpoint for production SEC diagnostics.
- Clarified compact financial data labels: `SEC`, `Fallback`, and `N/A`.
- Validation remains lint/build only; no localhost validation was used.

## V1.3 SEC Financial Data Integration

- Added SEC CompanyFacts financial data integration for normal operating companies.
- Introduced FCF calculation from operating cash flow minus absolute CapEx.
- Introduced margin calculation using operating income over revenue, with net income fallback.
- SEC-derived FCF, FCF QoQ, margin change, margin score, and FCF score replace financial fallback when reliable data is available.
- Financial fallback is preserved when SEC data is unavailable or unreliable.
- ETF-like tickers such as SOXL and SMH remain `N/A` for financial data.
- Snapshot persistence from V1.4.1 is retained.
- Validation remains lint/build only; no localhost validation was used.

## V1.4.1 Supabase Persistence Diagnostics

- Added structured Supabase persistence error reporting for snapshot upserts.
- Refresh responses now include persistence error message, code, and details when persistence fails.
- Added a CRON_SECRET-protected `/api/debug/persistence` endpoint for production-safe write/read diagnostics.
- Improved Supabase admin configuration reporting without exposing secret values.
- Dashboard now shows compact `Snapshot: Failed` status when persistence fails.
- Validation remains lint/build only; no localhost validation was used.

## V1.4 Snapshot Persistence and Real Rank Movement

- Added Supabase-backed snapshot persistence through `public.alpha_scout_snapshots`.
- Introduced server-only Supabase admin access using `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Market Scan and Fixed List snapshots are saved separately by mode.
- Latest snapshot reads prefer the latest saved `MARKET_SCAN` snapshot when Supabase is configured.
- Real rank movement now compares current rows against the previous saved snapshot by ticker.
- Dropped symbols are recorded when previous snapshot tickers no longer appear in the current Top 11.
- Dashboard shows compact snapshot persistence status and dropped symbols near movement summary.
- Validation remains lint/build only; no localhost validation was used.

## V1.2.2 Independent Fixed List View

- Latest snapshot response now includes an optional independent `fixedSnapshot` alongside the main market scan snapshot.
- `Fixed List` displays the fixed-watchlist snapshot rows for SOXL, SMH, NVDA, AMD, VRT, MSFT, GOOGL, DXYZ, RKLB, LLY, and IONQ.
- `All` remains the V1.2 market scan Top 11 and is still the default active tab.
- `Market Cap $50B-$300B`, `Price > $800`, and `Overlap` continue filtering only within All.
- All and Fixed List are independent views and may overlap by ticker.
- Validation remains lint/build only; no localhost validation was used.

## V1.2.1 Dashboard Tab Behavior

- Made dashboard tabs clickable while keeping the compact layout.
- `All` remains the default view and shows the final Top 11 from the V1.2 market scan.
- `Fixed List` now uses an independent fixed-watchlist live snapshot instead of reusing or filtering the market scan result.
- `Market Cap $50B-$300B` and `Price > $800` filter only within the current All Top 11 result.
- `Overlap` filters only within All for symbols satisfying two or more of fixed-list membership, mid-cap range, and high-price rules.
- Header now shows the active view and displayed row count.
- Validation remains lint/build only; no localhost API validation.

## V1.2 Market Universe Scan

- Introduced Market Universe Scan as the default live yahoo-finance2 snapshot mode.
- Added a maintainable seed universe instead of true full-market discovery for V1.2.
- Quote data is fetched first, then the market cap `$50B-$300B` and price `> $800` rules are applied before candle requests.
- Candidate pools now classify as `MID_CAP`, `HIGH_PRICE`, or `OVERLAP`, then merge, deduplicate, score, sort, and return the Top 11.
- Daily candles remain the source for the signed dollar volume capital flow proxy.
- Fixed watchlist live snapshot is retained as a fallback if market scan fails completely.
- Mock snapshot remains the final fallback if live market scan and fixed watchlist both fail.
- Financial data still uses fallback values while financial statement parsing remains unimplemented.
- Validation must use `npm run lint`, `npm run build`, and the production URL. Do not use localhost API validation or `curl http://localhost:3000`.

## V1.1.1 Data Quality Display Cleanup

- Updated compact numeric display for V1.1.1 without changing ingestion, scoring, API routes, or refresh behavior.
- Market cap now displays `N/A` when the value is missing, zero, or otherwise unavailable instead of showing `$0B`.
- Large currency values use compact one-decimal formatting, including clean negative flow output such as `-$13.2B`.
- Financial fallback zeros now display as `N/A` for FCF and FCF QoQ when the existing fallback shape reports both values as zero.
- `PARTIAL_LIVE` remains labeled as `Partial Live` with the description `Live market data with financial fallback`.
- Validation should use `npm run lint`, `npm run build`, and the production URL. Do not use localhost API validation because it can trigger Mac security popups.

## V1.1 Fixed Watchlist Live Market Snapshot

- Enabled yahoo-finance2 live quote and daily candle ingestion for the production snapshot.
- Switched V1.1 production mode to a fixed 11-symbol watchlist: SOXL, SMH, NVDA, AMD, VRT, MSFT, GOOGL, DXYZ, RKLB, LLY, IONQ.
- Capital flow proxy is calculated from signed dollar volume using daily candle direction and volume.
- Financial data still uses fallback values while financial statement parsing remains unimplemented.
- Legacy full-market scan labels remain visible only as inactive UI context; Fixed List is the active mode.
- Validation should use lint/build and the production URL. Do not use `curl http://localhost:3000` or localhost API validation due to Mac security popups.

## 2026-05-30

### Initial Setup

- Created new Next.js project.
- Confirmed official project name: AlphaScout Capital Flow System V1.0.
- Archived project charter into docs/01_PROJECT_CHARTER.md.
- Prepared project documentation structure.
