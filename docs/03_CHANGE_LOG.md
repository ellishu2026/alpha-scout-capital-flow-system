# AlphaScout Capital Flow System - Change Log

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
