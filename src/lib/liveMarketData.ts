import {
  getMockCandidateFallback,
  previousRankMap,
} from "@/data/mockSnapshot";
import {
  calculateCompositeScore,
  calculateRankChange,
  getRankChangeLabel,
  getRankChangeType,
  getSignal,
} from "@/lib/scoring";
import {
  calculateCapitalFlowChangeRatio,
  calculateCapitalFlowScore,
  calculateCapitalFlowsFromCandles,
  ARCHIVE_PROVIDER_FLOW_CALCULATION_VERSION,
  NORMALIZED_FLOW_CALCULATION_VERSION,
  type CapitalFlows,
  zeroCapitalFlows,
} from "@/lib/capitalFlow";
import {
  fetchProviderCandles,
  getProviderBudgetSummary,
} from "@/lib/marketDataProviders";
import { evaluateFlowDataQuality } from "@/lib/flowDataQuality";
import {
  buildSecFinancialSnapshot,
  getFinancialFallback,
  type FinancialSnapshot,
} from "@/lib/secFinancialData";
import {
  FIXED_WATCHLIST_SYMBOLS,
  MARKET_SCAN_SYMBOLS,
} from "@/lib/marketUniverse";
import type {
  SnapshotResponse,
  StockCandidate,
  StockPool,
  UniverseCoverageSummary,
  UniverseDebugRow,
  UniverseMembershipBucket,
  UniverseSourceBucket,
} from "@/types/stock";
import YahooFinance from "yahoo-finance2";

const MID_CAP_MIN = 50_000_000_000;
const MID_CAP_MAX = 300_000_000_000;
const HIGH_PRICE_MIN = 800;
export const TOP_CANDIDATE_LIMIT = 11;
export const COVERAGE_MARKET_SCAN_LIMIT = 15;
export const UNIVERSE_BUILD_VERSION = "V1.7.9_SEED_UNIVERSE_LIGHT_FILTER";
const QUOTE_CONCURRENCY = 8;
const CANDLE_CONCURRENCY = 4;
export const CRON_REFRESH_TIMEOUT_GUARD_MS = 45_000;
const CRON_REFRESH_NEW_WORK_BUFFER_MS = 5_000;

export type RefreshTimeoutGuard = {
  startedAt: number;
  maxElapsedMs: number;
  triggered: boolean;
  refreshWorkItemCount: number;
  processedWorkItemCount: number;
  skippedWorkItemCount: number;
  processedTickers: Set<string>;
  skippedTickers: Set<string>;
  fixedWatchlistTickers: Set<string>;
  marketScanTickers: Set<string>;
};

type LiveQuote = {
  symbol: string;
  companyName: string;
  price: number | null;
  marketCap: number | null;
  regularMarketVolume: number | null;
};

type HistoricalDailyCandle = {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

type ScanQuoteResult = {
  symbol: string;
  quote: LiveQuote | null;
  pool: StockPool | null;
  failed: boolean;
  row: UniverseDebugRow;
};

type DeepScoringCandidate = {
  symbol: string;
  quote: LiveQuote;
  pool: StockPool;
  failed: boolean;
  universeSourceBucket: UniverseSourceBucket;
  universeSourceBuckets: UniverseMembershipBucket[];
};

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});
const fixedWatchlistSymbolSet = new Set<string>(FIXED_WATCHLIST_SYMBOLS);

const fallbackCompanyNames: Record<string, string> = {
  SOXL: "Direxion Daily Semiconductor Bull 3X Shares",
  SMH: "VanEck Semiconductor ETF",
  NVDA: "NVIDIA Corporation",
  AMD: "Advanced Micro Devices, Inc.",
  VRT: "Vertiv Holdings Co",
  MSFT: "Microsoft Corporation",
  GOOGL: "Alphabet Inc.",
  DXYZ: "Destiny Tech100 Inc.",
  RKLB: "Rocket Lab USA, Inc.",
  LLY: "Eli Lilly and Company",
  IONQ: "IonQ, Inc.",
};

const zeroFlows = zeroCapitalFlows("MOCK", "MOCK");

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function createRefreshTimeoutGuard(
  maxElapsedMs = CRON_REFRESH_TIMEOUT_GUARD_MS,
): RefreshTimeoutGuard {
  return {
    startedAt: Date.now(),
    maxElapsedMs,
    triggered: false,
    refreshWorkItemCount: 0,
    processedWorkItemCount: 0,
    skippedWorkItemCount: 0,
    processedTickers: new Set<string>(),
    skippedTickers: new Set<string>(),
    fixedWatchlistTickers: new Set<string>(),
    marketScanTickers: new Set<string>(),
  };
}

export function getRefreshTimeoutSummary({
  guard,
  finalCoverageTickerCount,
  fixedWatchlistTickerCount,
  marketScanTickerCount,
  dedupedCoverageTickerCount,
}: {
  guard: RefreshTimeoutGuard;
  finalCoverageTickerCount: number;
  fixedWatchlistTickerCount: number;
  marketScanTickerCount: number;
  dedupedCoverageTickerCount: number;
}) {
  const skippedTickers = Array.from(guard.skippedTickers).sort();

  return {
    timeoutGuardTriggered: guard.triggered,
    elapsedMs: Date.now() - guard.startedAt,
    refreshWorkItemCount: guard.refreshWorkItemCount,
    processedWorkItemCount: guard.processedWorkItemCount,
    skippedWorkItemCount: guard.skippedWorkItemCount,
    finalCoverageTickerCount,
    fixedWatchlistTickerCount,
    marketScanTickerCount,
    dedupedCoverageTickerCount,
    processedTickerCount: guard.processedWorkItemCount,
    skippedTickerCount: guard.skippedWorkItemCount,
    skippedTickers,
    metricDefinitions: {
      timeoutGuardTriggered:
        "True when the cron refresh stopped starting new ticker work to return before the production timeout.",
      elapsedMs:
        "Wall-clock milliseconds spent in the cron refresh handler before returning JSON.",
      refreshWorkItemCount:
        "Total internal ticker work items considered across quote, capital-flow, and fixed-watchlist passes.",
      processedWorkItemCount:
        "Internal ticker work items actually started and completed before the timeout guard stopped new work.",
      skippedWorkItemCount:
        "Internal ticker work items not started because the timeout guard stopped new work.",
      finalCoverageTickerCount:
        "Final unique ticker count included in the returned snapshot and providerCoverageSummary.",
      fixedWatchlistTickerCount:
        "Fixed-watchlist ticker rows included or attempted in this refresh response.",
      marketScanTickerCount:
        "Market-scan ticker rows included or attempted in this refresh response.",
      dedupedCoverageTickerCount:
        "Unique ticker count after combining fixed-watchlist and market-scan coverage.",
      processedTickerCount:
        "Backward-compatible alias for processedWorkItemCount; prefer processedWorkItemCount.",
      skippedTickerCount:
        "Backward-compatible alias for skippedWorkItemCount; prefer skippedWorkItemCount.",
      skippedTickers:
        "Unique ticker symbols associated with work items skipped by the timeout guard.",
      providerCoverageSummary:
        "Final unique ticker provider coverage only; it does not count internal quote or scan work items.",
    },
  };
}

function canStartTickerWork(guard?: RefreshTimeoutGuard) {
  if (!guard) return true;

  if (
    Date.now() - guard.startedAt >=
    guard.maxElapsedMs - CRON_REFRESH_NEW_WORK_BUFFER_MS
  ) {
    guard.triggered = true;

    return false;
  }

  return true;
}

function markSkipped(
  guard: RefreshTimeoutGuard | undefined,
  symbols: readonly string[],
) {
  if (!guard) return;

  guard.triggered = true;
  for (const symbol of symbols) {
    if (symbol && !guard.processedTickers.has(symbol)) {
      guard.skippedTickers.add(symbol);
    }
  }
}

function markProcessed(guard: RefreshTimeoutGuard | undefined, symbol: string) {
  if (!guard) return;

  guard.processedTickers.add(symbol);
  guard.skippedTickers.delete(symbol);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
  options?: {
    guard?: RefreshTimeoutGuard;
    getTicker?: (item: T) => string;
    scope?: "FIXED_WATCHLIST" | "MARKET_SCAN";
  },
): Promise<R[]> {
  const results: R[] = [];
  if (options?.guard) {
    options.guard.refreshWorkItemCount += items.length;
    if (options.getTicker && options.scope) {
      const tickerSet =
        options.scope === "FIXED_WATCHLIST"
          ? options.guard.fixedWatchlistTickers
          : options.guard.marketScanTickers;

      for (const item of items) {
        const ticker = options.getTicker(item);
        if (ticker) tickerSet.add(ticker);
      }
    }
  }

  for (let index = 0; index < items.length; index += limit) {
    if (!canStartTickerWork(options?.guard)) {
      if (options?.guard) {
        options.guard.skippedWorkItemCount += items.length - index;
      }
      markSkipped(
        options?.guard,
        options?.getTicker
          ? items.slice(index).map((item) => options.getTicker?.(item) ?? "")
          : [],
      );
      break;
    }

    const batch = items.slice(index, index + limit);
    results.push(...(await Promise.all(batch.map((item) => mapper(item)))));
    if (options?.guard) {
      options.guard.processedWorkItemCount += batch.length;
    }
  }

  return results;
}

function fallbackFlows(symbol: string): CapitalFlows {
  const fallback = getMockCandidateFallback(symbol);

  if (!fallback) {
    return {
      ...zeroFlows,
      ...evaluateFlowDataQuality(zeroFlows),
    };
  }

  const flows: CapitalFlows = {
    capitalFlow3D: fallback.capitalFlow3D,
    capitalFlow5D: fallback.capitalFlow5D,
    capitalFlow9D: fallback.capitalFlow9D,
    capitalFlow3W: fallback.capitalFlow3W,
    capitalFlow5W: fallback.capitalFlow5W,
    legacyCapitalFlow3D: fallback.capitalFlow3D,
    legacyCapitalFlow5D: fallback.capitalFlow5D,
    legacyCapitalFlow9D: fallback.capitalFlow9D,
    legacyCapitalFlow3W: fallback.capitalFlow3W,
    legacyCapitalFlow5W: fallback.capitalFlow5W,
    flowCalculationVersion: NORMALIZED_FLOW_CALCULATION_VERSION,
    capitalFlowDataSource: "MOCK",
    capitalFlowQuality: "MOCK",
    providerUsed: "MOCK",
    providerPriorityTried: [],
    providerErrors: [],
    providerEndpointType: "MOCK",
    archiveLookupTried: false,
    archiveProviderChecked: [],
    archiveHitProvider: null,
    archiveStatus: "MOCK",
    rawProviderPayloadSummary: undefined,
    moneyFlowMultiplierLatest: null,
    chaikinDailyFlowLatest: null,
    flowDataUpdatedAt: undefined,
    avgDollarVolume20D: null,
    flow3DToMarketCapPct: null,
    flow5DToMarketCapPct: null,
    flow9DToMarketCapPct: null,
    flow3WToMarketCapPct: null,
    flow5WToMarketCapPct: null,
    flow3DToAvgDollarVolume: null,
    flow5DToAvgDollarVolume: null,
    flow9DToAvgDollarVolume: null,
    flow3WToAvgDollarVolume: null,
    flow5WToAvgDollarVolume: null,
    flowConsistency9D: 0,
    flowDirectionBreadth: 0,
    shortTermFlowAcceleration: null,
    normalizedFlowScore: 0,
    rawFlowScore: 0,
  };

  return {
    ...flows,
    ...evaluateFlowDataQuality(flows),
  };
}

async function resolveFinancials(symbol: string): Promise<FinancialSnapshot> {
  try {
    const secFinancials = await buildSecFinancialSnapshot(symbol);

    if (secFinancials) {
      return secFinancials;
    }

    return {
      ...(await getFinancialFallback(symbol)),
      financialError: "SEC_UNAVAILABLE",
    };
  } catch {
    // SEC data is best-effort; keep live market snapshots resilient.
  }

  return {
    ...(await getFinancialFallback(symbol)),
    financialError: "SEC_REQUEST_FAILED",
  };
}

export async function fetchLiveQuote(symbol: string): Promise<LiveQuote> {
  const quote = await yahooFinance.quote(symbol);

  return {
    symbol,
    companyName:
      typeof quote.longName === "string"
        ? quote.longName
        : typeof quote.shortName === "string"
          ? quote.shortName
          : fallbackCompanyNames[symbol] ?? symbol,
    price: numberOrNull(quote.regularMarketPrice),
    marketCap: numberOrNull(quote.marketCap),
    regularMarketVolume: numberOrNull(quote.regularMarketVolume),
  };
}

export async function fetchHistoricalDailyCandles(
  symbol: string,
  lookbackDays: number,
): Promise<HistoricalDailyCandle[]> {
  const period1 = new Date();
  period1.setUTCDate(period1.getUTCDate() - lookbackDays);

  const rows = await yahooFinance.historical(symbol, {
    period1,
    period2: new Date(),
    interval: "1d",
    events: "history",
    includeAdjustedClose: true,
  });

  return rows
    .filter(
      (row) =>
        row.date instanceof Date &&
        Number.isFinite(row.close) &&
        Number.isFinite(row.high) &&
        Number.isFinite(row.low) &&
        Number.isFinite(row.volume),
    )
    .map((row) => ({
      date: row.date,
      open: numberOrNull(row.open),
      high: numberOrNull(row.high),
      low: numberOrNull(row.low),
      close: numberOrNull(row.close),
      volume: numberOrNull(row.volume),
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export async function resolveCapitalFlows(
  symbol: string,
  marketCap?: number | null,
): Promise<CapitalFlows> {
  const providerCandles = await fetchProviderCandles(symbol);

  if (
    providerCandles.candles.length &&
    providerCandles.providerUsed &&
    providerCandles.dataSource &&
    providerCandles.quality
  ) {
    const flows = calculateCapitalFlowsFromCandles({
        candles: providerCandles.candles,
        dataSource: providerCandles.dataSource,
        quality: providerCandles.quality,
        marketCap,
      });

    const flowsWithProviderMetadata: CapitalFlows = {
      ...flows,
      flowCalculationVersion:
        providerCandles.archiveStatus === "ARCHIVE_HIT"
          ? ARCHIVE_PROVIDER_FLOW_CALCULATION_VERSION
          : flows.flowCalculationVersion,
      providerUsed: providerCandles.providerUsed,
      providerPriorityTried: providerCandles.providerPriorityTried,
      providerErrors: providerCandles.providerErrors,
      providerEndpointType: providerCandles.providerEndpointType,
      archiveLookupTried: providerCandles.archiveLookupTried,
      archiveProviderChecked: providerCandles.archiveProviderChecked,
      archiveHitProvider: providerCandles.archiveHitProvider,
      archiveStatus: providerCandles.archiveStatus,
      rawProviderPayloadSummary: providerCandles.rawProviderPayloadSummary,
    };

    return {
      ...flowsWithProviderMetadata,
      ...evaluateFlowDataQuality(flowsWithProviderMetadata),
    };
  }

  const candles = await fetchHistoricalDailyCandles(symbol, 45);

  const fallbackFlows: CapitalFlows = {
    ...calculateCapitalFlowsFromCandles({
      candles,
      dataSource: "YFINANCE_COMPOSITE_PROXY",
      quality: "LIVE_PROXY",
      marketCap,
    }),
    providerUsed: "YFINANCE_COMPOSITE_PROXY",
    providerPriorityTried: providerCandles.providerPriorityTried,
    providerErrors: providerCandles.providerErrors,
    providerEndpointType: "YFINANCE_HISTORICAL",
    archiveLookupTried: providerCandles.archiveLookupTried,
    archiveProviderChecked: providerCandles.archiveProviderChecked,
    archiveHitProvider: providerCandles.archiveHitProvider,
    archiveStatus: "PROXY_PROVIDER",
  };

  return {
    ...fallbackFlows,
    ...evaluateFlowDataQuality(fallbackFlows),
  };
}

function classifyPool(quote: LiveQuote): StockPool | null {
  const marketCap = quote.marketCap ?? 0;
  const price = quote.price ?? 0;
  const isMidCap = marketCap >= MID_CAP_MIN && marketCap <= MID_CAP_MAX;
  const isHighPrice = price > HIGH_PRICE_MIN;

  if (isMidCap && isHighPrice) {
    return "OVERLAP";
  }

  if (isMidCap) {
    return "MID_CAP";
  }

  if (isHighPrice) {
    return "HIGH_PRICE";
  }

  return null;
}

function universeSourceBuckets({
  symbol,
  quote,
}: {
  symbol: string;
  quote: LiveQuote | null;
}): UniverseMembershipBucket[] {
  const buckets: UniverseMembershipBucket[] = [];
  const marketCap = quote?.marketCap ?? null;
  const price = quote?.price ?? null;

  if (fixedWatchlistSymbolSet.has(symbol)) {
    buckets.push("FIXED_WATCHLIST");
  }

  if (
    typeof marketCap === "number" &&
    marketCap >= MID_CAP_MIN &&
    marketCap <= MID_CAP_MAX
  ) {
    buckets.push("MARKET_CAP_50B_300B");
  }

  if (typeof price === "number" && price > HIGH_PRICE_MIN) {
    buckets.push("HIGH_PRICE_OVER_800");
  }

  return buckets;
}

function universeSourceBucket(
  buckets: UniverseMembershipBucket[],
): UniverseDebugRow["sourceBucket"] {
  if (buckets.length > 1) return "MULTI_BUCKET";
  if (buckets.length === 0) return "OUTSIDE_V1_7_9_POOLS";

  return buckets[0];
}

function universeSourceBucketForCandidate({
  symbol,
  quote,
}: {
  symbol: string;
  quote: LiveQuote | null;
}) {
  return universeSourceBucket(universeSourceBuckets({ symbol, quote }));
}

function missingReason({
  quote,
  failed,
  buckets,
}: {
  quote: LiveQuote | null;
  failed: boolean;
  buckets: UniverseDebugRow["sourceBuckets"];
}) {
  if (failed) return "QUOTE_FAILED";
  if (buckets.length > 0) return undefined;

  const missing: string[] = [];
  if (!quote?.marketCap) missing.push("MISSING_MARKET_CAP");
  if (!quote?.price) missing.push("MISSING_PRICE");

  return missing.length > 0 ? missing.join(",") : "OUTSIDE_V1_7_9_POOLS";
}

function scanQuoteToDebugRow(result: {
  symbol: string;
  quote: LiveQuote | null;
  failed: boolean;
}): UniverseDebugRow {
  const buckets = universeSourceBuckets({
    symbol: result.symbol,
    quote: result.quote,
  });

  return {
    ticker: result.symbol,
    companyName: result.quote?.companyName ?? fallbackCompanyNames[result.symbol],
    price: result.quote?.price ?? null,
    marketCap: result.quote?.marketCap ?? null,
    sourceBucket: universeSourceBucket(buckets),
    sourceBuckets: buckets,
    includedByMarketCapRange: buckets.includes("MARKET_CAP_50B_300B"),
    includedByHighPrice: buckets.includes("HIGH_PRICE_OVER_800"),
    includedByFixedWatchlist: buckets.includes("FIXED_WATCHLIST"),
    quoteStatus: result.failed ? "FAILED" : "OK",
    missingReason: missingReason({
      quote: result.quote,
      failed: result.failed,
      buckets,
    }),
  };
}

function sortDeepScoringCandidates(
  candidates: DeepScoringCandidate[],
): DeepScoringCandidate[] {
  return [...candidates].sort((a, b) => {
    const aBucketCount = universeSourceBuckets({
      symbol: a.symbol,
      quote: a.quote,
    }).length;
    const bBucketCount = universeSourceBuckets({
      symbol: b.symbol,
      quote: b.quote,
    }).length;
    const bucketDiff = bBucketCount - aBucketCount;

    if (bucketDiff !== 0) return bucketDiff;

    const volumeDiff =
      (b.quote.regularMarketVolume ?? 0) - (a.quote.regularMarketVolume ?? 0);

    if (volumeDiff !== 0) return volumeDiff;

    return (b.quote.marketCap ?? 0) - (a.quote.marketCap ?? 0);
  });
}

function buildUniverseCoverageSummary({
  rows,
  deepScoringCandidateCount,
  finalRankedCount,
  topN,
  guard,
  providerQuotaExhaustedTickers = [],
  yfinanceProxyFallbackTickers = [],
}: {
  rows: UniverseDebugRow[];
  deepScoringCandidateCount: number;
  finalRankedCount: number;
  topN: number;
  guard?: RefreshTimeoutGuard;
  providerQuotaExhaustedTickers?: string[];
  yfinanceProxyFallbackTickers?: string[];
}): UniverseCoverageSummary {
  const includedRows = rows.filter((row) => row.sourceBuckets.length > 0);
  const marketCap50To300BTickers = includedRows
    .filter((row) => row.includedByMarketCapRange)
    .map((row) => row.ticker)
    .sort();
  const highPriceOver800Tickers = includedRows
    .filter((row) => row.includedByHighPrice)
    .map((row) => row.ticker)
    .sort();
  const overlappingTickers = includedRows
    .filter((row) => row.sourceBuckets.length > 1)
    .map((row) => row.ticker)
    .sort();
  const missingMarketCapTickers = rows
    .filter((row) => row.quoteStatus !== "FAILED" && row.marketCap == null)
    .map((row) => row.ticker)
    .sort();
  const missingPriceTickers = rows
    .filter((row) => row.quoteStatus !== "FAILED" && row.price == null)
    .map((row) => row.ticker)
    .sort();
  const failedQuoteTickers = rows
    .filter((row) => row.quoteStatus === "FAILED")
    .map((row) => row.ticker)
    .sort();
  const includedSourceBuckets = Array.from(
    new Set(includedRows.map((row) => row.sourceBucket)),
  ).sort() as UniverseCoverageSummary["includedSourceBuckets"];
  const skippedByTimeoutTickers = Array.from(guard?.skippedTickers ?? []).sort();

  return {
    fixedWatchlistCount: FIXED_WATCHLIST_SYMBOLS.length,
    marketCap50To300BPoolCount: marketCap50To300BTickers.length,
    highPriceOver800PoolCount: highPriceOver800Tickers.length,
    mergedUniverseCount:
      FIXED_WATCHLIST_SYMBOLS.length +
      marketCap50To300BTickers.length +
      highPriceOver800Tickers.length,
    dedupedUniverseCount: includedRows.length,
    lightFilterTickerCount: rows.length,
    deepScoringCandidateCount,
    deepScoringSkippedCount: Math.max(
      0,
      includedRows.length - deepScoringCandidateCount,
    ),
    scanCandidateCount: includedRows.length,
    finalRankedCount,
    topN,
    overlappingTickerCount: overlappingTickers.length,
    overlappingTickers,
    missingMarketCapCount: missingMarketCapTickers.length,
    missingMarketCapTickers,
    missingPriceCount: missingPriceTickers.length,
    missingPriceTickers,
    failedQuoteCount: failedQuoteTickers.length,
    failedQuoteTickers,
    skippedByTimeoutCount: skippedByTimeoutTickers.length,
    skippedByTimeoutTickers,
    providerQuotaExhaustedCount: providerQuotaExhaustedTickers.length,
    providerQuotaExhaustedTickers,
    yfinanceProxyFallbackCount: yfinanceProxyFallbackTickers.length,
    yfinanceProxyFallbackTickers,
    includedSourceBuckets,
    universeBuildVersion: UNIVERSE_BUILD_VERSION,
    marketCap50To300BTickers,
    highPriceOver800Tickers,
    dedupedUniverseSampleTickers: includedRows
      .map((row) => row.ticker)
      .sort()
      .slice(0, 40),
  };
}

async function buildCandidateFromParts({
  symbol,
  quote,
  flows,
  pool,
  usedMarketFallback,
  universeSourceBucket,
  candidateUniverseSourceBuckets,
}: {
  symbol: string;
  quote: LiveQuote | null;
  flows: CapitalFlows;
  pool: StockPool;
  usedMarketFallback: boolean;
  universeSourceBucket?: UniverseSourceBucket;
  candidateUniverseSourceBuckets?: UniverseMembershipBucket[];
}): Promise<StockCandidate> {
  const mockCandidate = getMockCandidateFallback(symbol);
  const financials = await resolveFinancials(symbol);
  const candidateFlows = { ...flows };
  delete candidateFlows.recentDailyFlow;
  const capitalFlowScore = calculateCapitalFlowScore(flows);
  const compositeScore = calculateCompositeScore(
    financials.marginScore,
    financials.fcfScore,
    capitalFlowScore,
  );

  return {
    rank: 0,
    ticker: symbol,
    companyName:
      quote?.companyName ??
      mockCandidate?.companyName ??
      fallbackCompanyNames[symbol] ??
      symbol,
    pool,
    marketCap: quote ? (quote.marketCap ?? 0) : (mockCandidate?.marketCap ?? 0),
    price: quote ? (quote.price ?? 0) : (mockCandidate?.price ?? 0),
    ...financials,
    ...candidateFlows,
    compositeScore,
    capitalFlowScore,
    capitalFlowChangeRatio: calculateCapitalFlowChangeRatio(flows),
    signal: getSignal(
      compositeScore,
      financials.marginScore,
      financials.fcfScore,
      capitalFlowScore,
    ),
    dataStatus: usedMarketFallback ? "PARTIAL_LIVE" : "LIVE_MARKET",
    universeSourceBucket:
      universeSourceBucket ??
      universeSourceBucketForCandidate({ symbol, quote }),
    universeSourceBuckets:
      candidateUniverseSourceBuckets ?? universeSourceBuckets({ symbol, quote }),
  };
}

async function buildFixedWatchlistCandidateWithMeta(
  symbol: string,
  guard?: RefreshTimeoutGuard,
): Promise<{
  candidate: StockCandidate;
  usedFallback: boolean;
}> {
  let usedFallback = false;

  let quote: LiveQuote | null = null;
  let flows: CapitalFlows | null = null;

  try {
    quote = await fetchLiveQuote(symbol);
  } catch {
    usedFallback = true;
  }

  try {
    flows = await resolveCapitalFlows(symbol, quote?.marketCap);

    if (flows.recentDailyFlow && flows.recentDailyFlow.length < 25) {
      usedFallback = true;
    }
  } catch {
    usedFallback = true;
  }

  if (!quote?.price || !quote?.marketCap) {
    usedFallback = true;
  }

  const result = {
    usedFallback,
    candidate: await buildCandidateFromParts({
      symbol,
      quote,
      flows: flows ?? fallbackFlows(symbol),
      pool: "WATCHLIST",
      usedMarketFallback: usedFallback,
    }),
  };

  markProcessed(guard, symbol);

  return result;
}

async function fetchQuoteForScan(symbol: string): Promise<{
  symbol: string;
  quote: LiveQuote | null;
  pool: StockPool | null;
  failed: boolean;
}> {
  try {
    const quote = await fetchLiveQuote(symbol);
    return {
      symbol,
      quote,
      pool: classifyPool(quote),
      failed: !quote.price || !quote.marketCap,
    };
  } catch {
    return {
      symbol,
      quote: null,
      pool: null,
      failed: true,
    };
  }
}

export async function buildUniverseLightScan({
  topN = COVERAGE_MARKET_SCAN_LIMIT,
  guard,
}: {
  topN?: number;
  guard?: RefreshTimeoutGuard;
} = {}): Promise<{
  rows: UniverseDebugRow[];
  deepScoringCandidates: DeepScoringCandidate[];
  universeCoverageSummary: UniverseCoverageSummary;
}> {
  const symbols = Array.from(new Set(MARKET_SCAN_SYMBOLS));
  const quoteResults = (await mapWithConcurrency(
    symbols,
    QUOTE_CONCURRENCY,
    async (symbol): Promise<ScanQuoteResult> => {
      const quoteResult = await fetchQuoteForScan(symbol);

      return {
        ...quoteResult,
        row: scanQuoteToDebugRow(quoteResult),
      };
    },
    {
      guard,
      getTicker: (symbol) => symbol,
      scope: "MARKET_SCAN",
    },
  )) satisfies ScanQuoteResult[];
  const allDeepScoringCandidates = quoteResults.filter(
    (
      result,
    ): result is ScanQuoteResult & {
      quote: LiveQuote;
      pool: StockPool;
    } =>
      result.quote != null &&
      result.pool != null &&
      result.row.sourceBuckets.length > 0,
  );
  const deepScoringCandidates = sortDeepScoringCandidates(
    allDeepScoringCandidates.map((result) => ({
      symbol: result.symbol,
      quote: result.quote,
      pool: result.pool,
      failed: result.failed,
      universeSourceBucket: result.row.sourceBucket,
      universeSourceBuckets: result.row.sourceBuckets,
    })),
  ).slice(0, topN);
  const rows = quoteResults.map((result) => result.row);

  return {
    rows,
    deepScoringCandidates,
    universeCoverageSummary: buildUniverseCoverageSummary({
      rows,
      deepScoringCandidateCount: deepScoringCandidates.length,
      finalRankedCount: 0,
      topN,
      guard,
    }),
  };
}

async function buildScanCandidateFromQuote({
  symbol,
  quote,
  pool,
  universeSourceBucket,
  universeSourceBuckets,
  guard,
}: {
  symbol: string;
  quote: LiveQuote;
  pool: StockPool;
  universeSourceBucket: UniverseSourceBucket;
  universeSourceBuckets: UniverseMembershipBucket[];
  guard?: RefreshTimeoutGuard;
}): Promise<{
  candidate: StockCandidate;
  usedFallback: boolean;
}> {
  let flows: CapitalFlows | null = null;
  let usedFallback = false;

  try {
    flows = await resolveCapitalFlows(symbol, quote.marketCap);

    if (flows.recentDailyFlow && flows.recentDailyFlow.length < 25) {
      usedFallback = true;
    }
  } catch {
    usedFallback = true;
  }

  const result = {
    usedFallback,
    candidate: await buildCandidateFromParts({
      symbol,
      quote,
      flows: flows ?? fallbackFlows(symbol),
      pool,
      usedMarketFallback: usedFallback,
      universeSourceBucket,
      candidateUniverseSourceBuckets: universeSourceBuckets,
    }),
  };

  markProcessed(guard, symbol);

  return result;
}

function rankCandidates(candidates: StockCandidate[], limit: number) {
  return candidates
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, limit)
    .map((candidate, index) => {
      const currentRank = index + 1;
      const previousRank = previousRankMap[candidate.ticker] ?? null;

      return {
        ...candidate,
        rank: currentRank,
        previousRank,
        rankChange: calculateRankChange(currentRank, previousRank),
        changeLabel: getRankChangeLabel(currentRank, previousRank),
        changeType: getRankChangeType(currentRank, previousRank),
      };
    });
}

function buildMovementSummary(candidates: StockCandidate[]) {
  return candidates.reduce(
    (summary, candidate) => {
      if (candidate.changeType === "NEW") summary.newCount += 1;
      if (candidate.changeType === "UP") summary.upCount += 1;
      if (candidate.changeType === "DOWN") summary.downCount += 1;
      if (candidate.changeType === "SAME") summary.sameCount += 1;

      return summary;
    },
    {
      newCount: 0,
      upCount: 0,
      downCount: 0,
      sameCount: 0,
    },
  );
}

export async function buildFixedWatchlistSnapshot(
  guard?: RefreshTimeoutGuard,
): Promise<SnapshotResponse> {
  const symbols = Array.from(new Set(FIXED_WATCHLIST_SYMBOLS));
  const results = await mapWithConcurrency(
    symbols,
    CANDLE_CONCURRENCY,
    (symbol) => buildFixedWatchlistCandidateWithMeta(symbol, guard),
    {
      guard,
      getTicker: (symbol) => symbol,
      scope: "FIXED_WATCHLIST",
    },
  );

  const liveCount = results.filter((result) => !result.usedFallback).length;

  if (liveCount === 0) {
    throw new Error("Live fixed watchlist ingestion failed for all symbols.");
  }

  const rankedCandidates = rankCandidates(
    results.map((result) => ({
      ...result.candidate,
      sourceBucket: "FIXED_WATCHLIST" as const,
    })),
    TOP_CANDIDATE_LIMIT,
  );

  return {
    updatedAt: new Date().toISOString(),
    dataMode: "Daily Close Snapshot",
    refreshMode: "Auto Daily Refresh",
    mode: "FIXED_WATCHLIST",
    status: "PARTIAL_LIVE",
    count: rankedCandidates.length,
    scannedCount: results.length,
    candidateCount: rankedCandidates.length,
    failedCount: results.filter((result) => result.usedFallback).length,
    movementSummary: buildMovementSummary(rankedCandidates),
    items: rankedCandidates,
  };
}

export async function buildMarketScanSnapshot(
  limit = TOP_CANDIDATE_LIMIT,
  guard?: RefreshTimeoutGuard,
): Promise<SnapshotResponse> {
  const universeLightScan = await buildUniverseLightScan({ topN: limit, guard });
  const quoteFilteredCandidates = universeLightScan.deepScoringCandidates;

  if (quoteFilteredCandidates.length === 0) {
    throw new Error("Market scan quote filter returned no candidates.");
  }

  const scanResults = await mapWithConcurrency(
    quoteFilteredCandidates,
    CANDLE_CONCURRENCY,
    (candidate) => buildScanCandidateFromQuote({ ...candidate, guard }),
    {
      guard,
      getTicker: (candidate) => candidate.symbol,
      scope: "MARKET_SCAN",
    },
  );

  const rankedCandidates = rankCandidates(
    scanResults.map((result) => ({
      ...result.candidate,
      sourceBucket: "MARKET_SCAN_TOP15" as const,
    })),
    limit,
  );

  if (rankedCandidates.length === 0) {
    throw new Error("Market scan returned no ranked candidates.");
  }

  const selectedTickers = new Set(
    rankedCandidates.map((candidate) => candidate.ticker),
  );
  const selectedResults = scanResults.filter((result) =>
    selectedTickers.has(result.candidate.ticker),
  );
  const quoteFailedCount =
    universeLightScan.universeCoverageSummary.failedQuoteCount;
  const candleFallbackCount = selectedResults.filter(
    (result) => result.usedFallback,
  ).length;
  const yfinanceProxyFallbackTickers = selectedResults
    .filter(
      (result) =>
        result.candidate.capitalFlowDataSource === "YFINANCE_COMPOSITE_PROXY",
    )
    .map((result) => result.candidate.ticker)
    .sort();
  const providerQuotaExhaustedTickers = selectedResults
    .filter((result) =>
      (result.candidate.providerErrors ?? []).some((error) =>
        error.includes("CALL_BUDGET_EXHAUSTED"),
      ),
    )
    .map((result) => result.candidate.ticker)
    .sort();
  const universeCoverageSummary = buildUniverseCoverageSummary({
    rows: universeLightScan.rows,
    deepScoringCandidateCount: quoteFilteredCandidates.length,
    finalRankedCount: rankedCandidates.length,
    topN: limit,
    guard,
    providerQuotaExhaustedTickers,
    yfinanceProxyFallbackTickers,
  });

  return {
    updatedAt: new Date().toISOString(),
    dataMode: "Daily Close Snapshot",
    refreshMode: "Auto Daily Refresh",
    mode: "MARKET_SCAN",
    status: "PARTIAL_LIVE",
    count: rankedCandidates.length,
    scannedCount: universeLightScan.rows.length,
    candidateCount: quoteFilteredCandidates.length,
    failedCount: quoteFailedCount + candleFallbackCount,
    universeCoverageSummary,
    movementSummary: buildMovementSummary(rankedCandidates),
    items: rankedCandidates,
  };
}

export async function buildLiveCandidate(
  symbol: string,
): Promise<StockCandidate> {
  const { candidate } = await buildFixedWatchlistCandidateWithMeta(symbol);

  return candidate;
}

export const buildLiveMarketSnapshot = buildFixedWatchlistSnapshot;

export async function buildCapitalFlowDebug(symbol: string) {
  let quote: LiveQuote | null = null;

  try {
    quote = await fetchLiveQuote(symbol);
  } catch {
    quote = null;
  }

  const flows = await resolveCapitalFlows(symbol, quote?.marketCap);
  const providerBudget = getProviderBudgetSummary();

  return {
    ticker: symbol,
    flowCalculationVersion: flows.flowCalculationVersion,
    capitalFlowDataSource: flows.capitalFlowDataSource,
    capitalFlowQuality: flows.capitalFlowQuality,
    capitalFlow1D: flows.capitalFlow1D,
    capitalFlow3D: flows.capitalFlow3D,
    capitalFlow5D: flows.capitalFlow5D,
    capitalFlow9D: flows.capitalFlow9D,
    capitalFlow10D: flows.capitalFlow10D,
    capitalFlow20D: flows.capitalFlow20D,
    capitalFlow4W: flows.capitalFlow4W,
    capitalFlow6W: flows.capitalFlow6W,
    capitalFlow9W: flows.capitalFlow9W,
    capitalFlow12W: flows.capitalFlow12W,
    flowWindowCoverage: flows.flowWindowCoverage,
    flowWindowDataSource: flows.flowWindowDataSource,
    flowWindowUpdatedAt: flows.flowWindowUpdatedAt,
    flowWindowProviderUsed: flows.flowWindowProviderUsed,
    flowWindowExtendedHistoryAvailable: flows.flowWindowExtendedHistoryAvailable,
    capitalFlow3W: flows.capitalFlow3W,
    capitalFlow5W: flows.capitalFlow5W,
    legacyCapitalFlow3D: flows.legacyCapitalFlow3D,
    legacyCapitalFlow5D: flows.legacyCapitalFlow5D,
    legacyCapitalFlow9D: flows.legacyCapitalFlow9D,
    legacyCapitalFlow3W: flows.legacyCapitalFlow3W,
    legacyCapitalFlow5W: flows.legacyCapitalFlow5W,
    avgDollarVolume20D: flows.avgDollarVolume20D,
    flow3DToMarketCapPct: flows.flow3DToMarketCapPct,
    flow5DToMarketCapPct: flows.flow5DToMarketCapPct,
    flow9DToMarketCapPct: flows.flow9DToMarketCapPct,
    flow3WToMarketCapPct: flows.flow3WToMarketCapPct,
    flow5WToMarketCapPct: flows.flow5WToMarketCapPct,
    flow3DToAvgDollarVolume: flows.flow3DToAvgDollarVolume,
    flow5DToAvgDollarVolume: flows.flow5DToAvgDollarVolume,
    flow9DToAvgDollarVolume: flows.flow9DToAvgDollarVolume,
    flow3WToAvgDollarVolume: flows.flow3WToAvgDollarVolume,
    flow5WToAvgDollarVolume: flows.flow5WToAvgDollarVolume,
    flowConsistency9D: flows.flowConsistency9D,
    flowDirectionBreadth: flows.flowDirectionBreadth,
    shortTermFlowAcceleration: flows.shortTermFlowAcceleration,
    normalizedFlowScore: flows.normalizedFlowScore,
    rawFlowScore: flows.rawFlowScore,
    flowDataQualityScore: flows.flowDataQualityScore,
    flowDataQualityGrade: flows.flowDataQualityGrade,
    flowDataQualityReasons: flows.flowDataQualityReasons,
    flowDataQualityInputs: flows.flowDataQualityInputs,
    compositeDailyFlowLatest: flows.compositeDailyFlowLatest,
    priceChangeWeightedFlowLatest: flows.priceChangeWeightedFlowLatest,
    mfiLikeFlowLatest: flows.mfiLikeFlowLatest,
    obvDirectionalFlowLatest: flows.obvDirectionalFlowLatest,
    compositeFlowWeights: flows.compositeFlowWeights,
    providerUsed: flows.providerUsed,
    providerPriorityTried: flows.providerPriorityTried,
    providerErrors: flows.providerErrors,
    providerEndpointType: flows.providerEndpointType,
    archiveLookupTried: flows.archiveLookupTried,
    archiveProviderChecked: flows.archiveProviderChecked,
    archiveHitProvider: flows.archiveHitProvider,
    archiveStatus: flows.archiveStatus,
    rawProviderPayloadSummary: flows.rawProviderPayloadSummary,
    moneyFlowMultiplierLatest: flows.moneyFlowMultiplierLatest,
    chaikinDailyFlowLatest: flows.chaikinDailyFlowLatest,
    capitalFlowScore: calculateCapitalFlowScore(flows),
    providerCallBudget: providerBudget,
    providerCallsUsed: {
      polygon: providerBudget.polygon.callsUsed,
      alphaVantage: providerBudget.alphaVantage.callsUsed,
      twelveData: providerBudget.twelveData.callsUsed,
      eodhd: providerBudget.eodhd.callsUsed,
    },
    providerCallsRemaining: {
      polygon: providerBudget.polygon.remaining,
      alphaVantage: providerBudget.alphaVantage.remaining,
      twelveData: providerBudget.twelveData.remaining,
      eodhd: providerBudget.eodhd.remaining,
    },
    recentDailyFlow: flows.recentDailyFlow ?? [],
  };
}
