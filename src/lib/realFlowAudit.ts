import "server-only";

import type { DailyFlowDetail } from "@/lib/capitalFlow";
import { getProviderBudgetSummary } from "@/lib/marketDataProviders";
import { getLatestSnapshot } from "@/lib/snapshotStore";
import { isSupabaseConfigured } from "@/lib/supabaseAdmin";
import type { ProviderUsed, SnapshotResponse, StockCandidate } from "@/types/stock";

const MAX_FLOW_RESEARCH_TICKERS = 26;
const TOP_RANKED_LIMIT = 11;

const FIXED_WATCHLIST = [
  "SOXL",
  "SMH",
  "NVDA",
  "AMD",
  "VRT",
  "MSFT",
  "GOOGL",
  "ORCL",
  "RKLB",
  "LLY",
  "IONQ",
] as const;

type DataClass =
  | "REAL_BUY_SELL_FLOW"
  | "ORDER_IMBALANCE_OR_QUOTE_FLOW"
  | "PROVIDER_MONEY_FLOW_INDICATOR"
  | "REAL_OHLCV_ONLY"
  | "UNAVAILABLE";

type Direction = "Positive" | "Negative" | "Neutral" | "Unknown";

type AuditCandidate = StockCandidate & {
  recentDailyFlow?: DailyFlowDetail[];
  rawItem?: Partial<StockCandidate> & { recentDailyFlow?: DailyFlowDetail[] };
  raw_item?: Partial<StockCandidate> & { recentDailyFlow?: DailyFlowDetail[] };
};

type BuildRealFlowAuditOptions = {
  limit?: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number | null, digits = 2) {
  if (!isFiniteNumber(value)) {
    return null;
  }

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function signedClip(value: number | null | undefined, maxAbs: number | null) {
  if (!isFiniteNumber(value)) {
    return null;
  }

  if (!isFiniteNumber(maxAbs) || maxAbs <= 0) {
    return value;
  }

  return clamp(value, -maxAbs, maxAbs);
}

function safeRatio(value: number | null | undefined, denominator: number | null | undefined) {
  if (!isFiniteNumber(value) || !isFiniteNumber(denominator) || denominator === 0) {
    return null;
  }

  return value / denominator;
}

function percentRatio(value: number | null | undefined, denominator: number | null | undefined) {
  const ratio = safeRatio(value, denominator);

  return isFiniteNumber(ratio) ? round(ratio * 100, 6) : null;
}

function getRecentDailyFlow(candidate: AuditCandidate) {
  return (
    candidate.recentDailyFlow ??
    candidate.rawItem?.recentDailyFlow ??
    candidate.raw_item?.recentDailyFlow ??
    []
  );
}

function getLatestDailyFlow(candidate: AuditCandidate) {
  return getRecentDailyFlow(candidate).at(-1) ?? null;
}

function getPreviousDailyFlow(candidate: AuditCandidate) {
  return getRecentDailyFlow(candidate).at(-2) ?? null;
}

function dollarVolume(row: DailyFlowDetail | null) {
  if (!row || !isFiniteNumber(row.close) || !isFiniteNumber(row.volume)) {
    return null;
  }

  return row.close * row.volume;
}

function closeLocationDollarFlow(row: DailyFlowDetail | null) {
  if (
    !row ||
    !isFiniteNumber(row.high) ||
    !isFiniteNumber(row.low) ||
    !isFiniteNumber(row.close) ||
    !isFiniteNumber(row.volume)
  ) {
    return null;
  }

  const range = row.high - row.low;
  const multiplier = range === 0 ? 0 : clamp((2 * row.close - row.high - row.low) / range, -1, 1);

  return row.close * row.volume * multiplier;
}

function latestPrice(candidate: AuditCandidate, latest: DailyFlowDetail | null) {
  if (isFiniteNumber(candidate.price)) {
    return candidate.price;
  }

  return isFiniteNumber(latest?.close) ? latest.close : null;
}

function direction(value: number | null | undefined): Direction {
  if (!isFiniteNumber(value)) return "Unknown";
  if (value > 0) return "Positive";
  if (value < 0) return "Negative";
  return "Neutral";
}

function getLegacyProxyFlow1D(candidate: AuditCandidate, latest: DailyFlowDetail | null) {
  return (
    candidate.capitalFlow1D ??
    candidate.chaikinDailyFlowLatest ??
    candidate.compositeDailyFlowLatest ??
    latest?.dailyFlowDollar ??
    latest?.chaikinDailyFlowDollar ??
    null
  );
}

function calculateEnhancedProxy(candidate: AuditCandidate) {
  const latest = getLatestDailyFlow(candidate);
  const previous = getPreviousDailyFlow(candidate);
  const latestDollarVolume = dollarVolume(latest);
  const maxComponent = latestDollarVolume;

  const chaikinDailyFlow = signedClip(
    latest?.chaikinDailyFlowDollar ?? latest?.dailyFlowDollar ?? candidate.chaikinDailyFlowLatest,
    maxComponent,
  );
  const priceChangeWeightedDollarFlow = signedClip(
    latest?.priceChangeWeightedFlow ?? candidate.priceChangeWeightedFlowLatest,
    maxComponent,
  );
  const mfiLikeFlow = signedClip(latest?.mfiLikeFlow ?? candidate.mfiLikeFlowLatest, maxComponent);
  const obvDirectionalFlow = signedClip(
    latest?.obvDirectionalFlow ?? candidate.obvDirectionalFlowLatest,
    maxComponent,
  );
  const closeLocationStrengthDollarFlow = signedClip(closeLocationDollarFlow(latest), maxComponent);

  const components = {
    chaikinDailyFlow,
    priceChangeWeightedDollarFlow,
    mfiLikeFlow,
    obvDirectionalFlow,
    closeLocationStrengthDollarFlow,
  };

  const availableComponents = Object.values(components).filter(isFiniteNumber);
  const enhancedProxyFlow1D =
    availableComponents.length > 0
      ? (components.chaikinDailyFlow ?? 0) * 0.35 +
        (components.priceChangeWeightedDollarFlow ?? 0) * 0.25 +
        (components.mfiLikeFlow ?? 0) * 0.2 +
        (components.obvDirectionalFlow ?? 0) * 0.1 +
        (components.closeLocationStrengthDollarFlow ?? 0) * 0.1
      : null;

  return {
    latest,
    previous,
    latestDollarVolume,
    enhancedProxyFlow1D,
    enhancedProxyComponents: {
      ...components,
      weights: {
        chaikinDailyFlow: 0.35,
        priceChangeWeightedDollarFlow: 0.25,
        mfiLikeFlow: 0.2,
        obvDirectionalFlow: 0.1,
        closeLocationStrengthDollarFlow: 0.1,
      },
      componentClipMaxAbs: maxComponent,
    },
  };
}

function bestDataClass(candidate: AuditCandidate, latest: DailyFlowDetail | null): DataClass {
  if (candidate.providerUsed || latest) {
    return "REAL_OHLCV_ONLY";
  }

  return "UNAVAILABLE";
}

function flowConfidence(candidate: AuditCandidate, dataClass: DataClass) {
  if (dataClass === "REAL_BUY_SELL_FLOW") return "High";
  if (dataClass === "ORDER_IMBALANCE_OR_QUOTE_FLOW") return "Medium";
  if (dataClass === "PROVIDER_MONEY_FLOW_INDICATOR") return "Medium";
  if (dataClass === "REAL_OHLCV_ONLY" && candidate.flowDataQualityGrade === "A") return "Medium";
  if (dataClass === "REAL_OHLCV_ONLY") return "Low";

  return "Low";
}

function providerBaseName(provider?: ProviderUsed) {
  if (!provider) return null;

  return provider.replace("_ARCHIVE", "");
}

function dedupeCandidates(...snapshots: Array<SnapshotResponse | null>) {
  const byTicker = new Map<string, AuditCandidate>();

  snapshots.forEach((snapshot) => {
    snapshot?.items.forEach((item) => {
      const ticker = item.ticker.toUpperCase();
      if (!byTicker.has(ticker)) {
        byTicker.set(ticker, item as AuditCandidate);
      }
    });
  });

  return byTicker;
}

function buildProviderAuditSummary(rows: ReturnType<typeof buildAuditRow>[]) {
  const budget = getProviderBudgetSummary();
  const archiveHitCount = rows.filter((row) => row.providersTried.some((provider) => provider.endsWith("_ARCHIVE"))).length;
  const ohlcvRows = rows.filter((row) => row.bestAvailableDataClass === "REAL_OHLCV_ONLY").length;

  return [
    {
      provider: "Existing archive",
      configured: isSupabaseConfigured(),
      tested: true,
      dataClass: archiveHitCount > 0 ? "REAL_OHLCV_ONLY" : "UNAVAILABLE",
      realBuySellFlowAvailable: false,
      indicatorAvailable: false,
      ohlcvAvailable: archiveHitCount > 0,
      quotaUsed: 0,
      quotaLimitIfKnown: null,
      notes:
        archiveHitCount > 0
          ? "Persisted OHLCV archive data is available for selected research tickers; no live provider calls were made by this audit."
          : "No archived OHLCV evidence was found in the latest selected snapshots.",
    },
    {
      provider: "Existing OHLCV providers",
      configured: true,
      tested: true,
      dataClass: ohlcvRows > 0 ? "REAL_OHLCV_ONLY" : "UNAVAILABLE",
      realBuySellFlowAvailable: false,
      indicatorAvailable: false,
      ohlcvAvailable: ohlcvRows > 0,
      quotaUsed: 0,
      quotaLimitIfKnown: null,
      notes:
        "Latest persisted snapshots expose OHLCV-derived flow components, but not true same-day buy amount and sell amount.",
    },
    {
      provider: "Alpha Vantage",
      configured: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      tested: false,
      dataClass: "REAL_OHLCV_ONLY",
      realBuySellFlowAvailable: false,
      indicatorAvailable: true,
      ohlcvAvailable: true,
      quotaUsed: budget.alphaVantage.callsUsed,
      quotaLimitIfKnown: budget.alphaVantage.limit,
      notes:
        "Current implementation supports OHLCV/archive usage. This audit did not consume Alpha Vantage quota and did not find true buy/sell amount fields in configured production data.",
    },
    {
      provider: "Twelve Data",
      configured: Boolean(process.env.TWELVE_DATA_API_KEY),
      tested: false,
      dataClass: "REAL_OHLCV_ONLY",
      realBuySellFlowAvailable: false,
      indicatorAvailable: true,
      ohlcvAvailable: true,
      quotaUsed: budget.twelveData.callsUsed,
      quotaLimitIfKnown: budget.twelveData.limit,
      notes:
        "Current implementation supports OHLCV/archive usage. This audit did not consume Twelve Data quota and did not find true buy/sell amount fields in configured production data.",
    },
    {
      provider: "EODHD",
      configured: Boolean(process.env.EODHD_API_KEY),
      tested: false,
      dataClass: "REAL_OHLCV_ONLY",
      realBuySellFlowAvailable: false,
      indicatorAvailable: true,
      ohlcvAvailable: true,
      quotaUsed: budget.eodhd.callsUsed,
      quotaLimitIfKnown: budget.eodhd.limit,
      notes:
        "Current implementation supports OHLCV/archive usage. This audit did not consume EODHD quota and did not find true buy/sell amount fields in configured production data.",
    },
    {
      provider: "Polygon",
      configured: Boolean(process.env.POLYGON_API_KEY),
      tested: false,
      dataClass: "REAL_OHLCV_ONLY",
      realBuySellFlowAvailable: false,
      indicatorAvailable: false,
      ohlcvAvailable: true,
      quotaUsed: budget.polygon.callsUsed,
      quotaLimitIfKnown: budget.polygon.limit,
      notes:
        "Current implementation supports OHLCV/archive usage. This audit did not consume Polygon quota and did not find true buy/sell amount fields in configured production data.",
    },
    {
      provider: "Finnhub",
      configured: Boolean(process.env.FINNHUB_API_KEY),
      tested: false,
      dataClass: "UNAVAILABLE",
      realBuySellFlowAvailable: false,
      indicatorAvailable: false,
      ohlcvAvailable: false,
      quotaUsed: 0,
      quotaLimitIfKnown: null,
      notes: "No Finnhub live audit was performed and no production flow integration currently uses it.",
    },
    {
      provider: "FMP",
      configured: Boolean(process.env.FMP_API_KEY),
      tested: false,
      dataClass: "UNAVAILABLE",
      realBuySellFlowAvailable: false,
      indicatorAvailable: false,
      ohlcvAvailable: false,
      quotaUsed: 0,
      quotaLimitIfKnown: null,
      notes: "No FMP live audit was performed and no production flow integration currently uses it.",
    },
  ];
}

function buildAuditRow(
  candidate: AuditCandidate,
  topRankedTickers: Set<string>,
  fixedWatchlistTickers: Set<string>,
) {
  const ticker = candidate.ticker.toUpperCase();
  const enhanced = calculateEnhancedProxy(candidate);
  const latest = enhanced.latest;
  const price = latestPrice(candidate, latest);
  const latestDollarVolume = enhanced.latestDollarVolume;
  const legacyProxyFlow1D = getLegacyProxyFlow1D(candidate, latest);
  const enhancedProxyFlow1D = enhanced.enhancedProxyFlow1D;
  const legacyProxyDirection = direction(legacyProxyFlow1D);
  const enhancedProxyDirection = direction(enhancedProxyFlow1D);
  const dataClass = bestDataClass(candidate, latest);
  const provider = providerBaseName(candidate.providerUsed);
  const avgDollarVolume20D = candidate.avgDollarVolume20D ?? null;
  const marketCap = candidate.marketCap ?? null;

  return {
    ticker,
    companyName: candidate.companyName ?? null,
    inTopRanked: topRankedTickers.has(ticker),
    inFixedWatchlist: fixedWatchlistTickers.has(ticker),
    providersTried: candidate.providerPriorityTried?.length
      ? candidate.providerPriorityTried
      : [candidate.providerUsed ?? candidate.capitalFlowDataSource ?? "NONE"],
    bestAvailableDataClass: dataClass,
    realFlowAvailable: false,
    realFlowSource: null,
    realBuyAmount: null,
    realSellAmount: null,
    realNetFlow: null,
    realFlowDate: null,
    realFlowCurrency: "USD",
    indicatorAvailable: false,
    indicatorSource: null,
    indicatorName: null,
    indicatorValue: null,
    ohlcvSource: provider,
    latestPrice: price,
    latestVolume: latest?.volume ?? null,
    latestDollarVolume,
    legacyProxyFlow1D,
    enhancedProxyFlow1D,
    enhancedProxyComponents: enhanced.enhancedProxyComponents,
    legacyProxyDirection,
    enhancedProxyDirection,
    directionChanged:
      legacyProxyDirection !== "Unknown" &&
      enhancedProxyDirection !== "Unknown" &&
      legacyProxyDirection !== enhancedProxyDirection,
    magnitudeRatio: round(safeRatio(enhancedProxyFlow1D, legacyProxyFlow1D), 6),
    flowConfidence: flowConfidence(candidate, dataClass),
    confidenceLevel: flowConfidence(candidate, dataClass),
    fallbackReason:
      "No configured production source exposes same-day buy amount and sell amount for this ticker; enhanced proxy is computed from persisted OHLCV flow components.",
    calibrationStatus: "RESEARCH_ONLY_NOT_PRODUCTION",
    providerErrors: candidate.providerErrors ?? [],
    enhancedProxyFlowToMarketCapPct: percentRatio(enhancedProxyFlow1D, marketCap),
    enhancedProxyFlowToAvgDollarVolume: round(safeRatio(enhancedProxyFlow1D, avgDollarVolume20D), 6),
    legacyProxyFlowToMarketCapPct: percentRatio(legacyProxyFlow1D, marketCap),
    legacyProxyFlowToAvgDollarVolume: round(safeRatio(legacyProxyFlow1D, avgDollarVolume20D), 6),
    avgDollarVolume20D,
    marketCap,
  };
}

export async function buildRealFlowAuditReport(options: BuildRealFlowAuditOptions = {}) {
  const requestedLimit = options.limit ?? MAX_FLOW_RESEARCH_TICKERS;
  const limit = Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_FLOW_RESEARCH_TICKERS);
  const [marketSnapshot, fixedSnapshot] = await Promise.all([
    getLatestSnapshot("MARKET_SCAN"),
    getLatestSnapshot("FIXED_WATCHLIST"),
  ]);

  const topRanked = (marketSnapshot?.items ?? []).slice(0, TOP_RANKED_LIMIT);
  const fixedItems = fixedSnapshot?.items ?? [];
  const topRankedTickers = new Set(topRanked.map((item) => item.ticker.toUpperCase()));
  const fixedWatchlistTickers = new Set(
    FIXED_WATCHLIST.map((ticker) => ticker.toUpperCase()),
  );
  const candidateByTicker = dedupeCandidates(marketSnapshot, fixedSnapshot);
  const orderedTickerSet = new Set<string>();

  topRanked.forEach((item) => orderedTickerSet.add(item.ticker.toUpperCase()));
  FIXED_WATCHLIST.forEach((ticker) => orderedTickerSet.add(ticker));
  fixedItems.forEach((item) => orderedTickerSet.add(item.ticker.toUpperCase()));

  const flowResearchTickerSet = Array.from(orderedTickerSet).slice(0, limit);
  const rows = flowResearchTickerSet
    .map((ticker) => candidateByTicker.get(ticker))
    .filter((candidate): candidate is AuditCandidate => candidate != null)
    .map((candidate) => buildAuditRow(candidate, topRankedTickers, fixedWatchlistTickers));
  const providerAuditSummary = buildProviderAuditSummary(rows);
  const archiveHitCount = rows.filter((row) =>
    row.providersTried.some((provider) => provider.endsWith("_ARCHIVE")),
  ).length;
  const liveProviderCallCount = 0;
  const skippedUniverseTickerCount = Math.max(
    0,
    (marketSnapshot?.universeCoverageSummary?.dedupedUniverseCount ??
      marketSnapshot?.scannedCount ??
      marketSnapshot?.count ??
      0) - flowResearchTickerSet.length,
  );

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    flowResearchTickerSet,
    flowResearchTickerCount: flowResearchTickerSet.length,
    topRankedTickerCount: topRankedTickers.size,
    fixedWatchlistTickerCount: FIXED_WATCHLIST.length,
    uniqueTickerCount: flowResearchTickerSet.length,
    maxFlowResearchTickers: MAX_FLOW_RESEARCH_TICKERS,
    skippedUniverseTickerCount,
    providerQuotaGuard: {
      enabled: true,
      maxFlowResearchTickers: MAX_FLOW_RESEARCH_TICKERS,
      fullUniverseAuditAllowed: false,
      providerQuotaExhausted: false,
      liveProviderCallCount,
      archiveHitCount,
      skippedDueToQuotaCount: 0,
      skippedFullUniverseCount: skippedUniverseTickerCount,
      notes:
        "V1.8.7 reads latest persisted snapshots only and does not perform live provider fetches.",
    },
    providerAuditSummary,
    rows,
    manualCalibration: {
      supported: false,
      futureFields: [
        "ticker",
        "date",
        "externalBuyAmount",
        "externalSellAmount",
        "externalNetFlow",
        "sourceName",
        "legacyProxyFlow",
        "enhancedProxyFlow",
        "directionMatch",
        "magnitudeErrorPct",
      ],
    },
    recommendation:
      "Real buy/sell flow is not available from the current production data layer. Continue using unchanged production flow while evaluating the enhanced OHLCV proxy against manually sourced flow samples.",
    safetyWarnings: [
      "Research endpoint only: production flow, scoring, thresholds, and Entry / Position rules are unchanged.",
      "Full-universe real-flow audit is disabled; ticker scope is capped at Top 11 plus Fixed Watchlist, max 26 unique tickers.",
      "No live provider calls are made by this audit endpoint.",
    ],
    enhancedFlowCalibrationAvailable: true,
    enhancedFlowCalibrationEndpoint: "/api/debug/enhanced-flow-calibration?limit=26",
    enhancedAlgorithmVersion: "V1.8.8.1_ENHANCED_FLOW_PROXY_OHLCV_SOURCE_FIX",
    productionFlowChanged: false,
  };
}
