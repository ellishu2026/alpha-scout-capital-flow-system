# AlphaScout Capital Flow System - Change Log

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
