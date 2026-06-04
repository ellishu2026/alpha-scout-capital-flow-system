import "server-only";

import { FIXED_WATCHLIST_SYMBOLS } from "@/lib/marketUniverse";
import { getLatestSnapshot } from "@/lib/snapshotStore";
import type { SnapshotResponse, StockCandidate } from "@/types/stock";

const VERSION = "V1.8.9_REAL_FLOW_PROVIDER_DEEP_SEARCH";
const MAX_REAL_FLOW_SEARCH_TICKERS = 26;
const TOP_RANKED_LIMIT = 11;

const FIXED_WATCHLIST = FIXED_WATCHLIST_SYMBOLS;

type DataLevel =
  | "REAL_BUY_SELL_NET_FLOW"
  | "TRADE_DIRECTION_OR_ORDER_FLOW"
  | "ORDER_IMBALANCE"
  | "DEPTH_OR_QUOTE_PRESSURE"
  | "OHLCV_OR_INDICATOR_ONLY";

type AccessType =
  | "FREE"
  | "API_KEY"
  | "PAID_SUBSCRIPTION"
  | "EXCHANGE_FEED"
  | "UNKNOWN";

type Risk = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
type Difficulty = "LOW" | "MEDIUM" | "HIGH";

type BuildRealFlowProviderDeepSearchOptions = {
  limit?: number;
};

type SearchCandidate = StockCandidate & {
  rawItem?: Partial<StockCandidate>;
  raw_item?: Partial<StockCandidate>;
};

function envPresent(names: string[]) {
  return names.some((name) => Boolean(process.env[name]));
}

function providerMatrixItem({
  providerName,
  envVars,
  configuredInProject,
  likelyDataLevel,
  hasTrueBuyAmount = false,
  hasTrueSellAmount = false,
  hasNetFlow = false,
  hasTradeDirection = false,
  hasOrderImbalance = false,
  hasDepthBook = false,
  hasLargeOrderOrBlockFlow = false,
  hasOHLCV = false,
  historicalAvailability,
  intradayAvailability,
  estimatedAccessType,
  integrationDifficulty,
  quotaRisk,
  legalOrTermsRisk,
  notes,
}: {
  providerName: string;
  envVars: string[];
  configuredInProject: boolean;
  likelyDataLevel: DataLevel;
  hasTrueBuyAmount?: boolean;
  hasTrueSellAmount?: boolean;
  hasNetFlow?: boolean;
  hasTradeDirection?: boolean;
  hasOrderImbalance?: boolean;
  hasDepthBook?: boolean;
  hasLargeOrderOrBlockFlow?: boolean;
  hasOHLCV?: boolean;
  historicalAvailability: string;
  intradayAvailability: string;
  estimatedAccessType: AccessType;
  integrationDifficulty: Difficulty;
  quotaRisk: Risk;
  legalOrTermsRisk: Risk;
  notes: string;
}) {
  const envVarsPresent = envPresent(envVars);

  return {
    providerName,
    configuredInProject,
    envVarsPresent,
    liveTestPerformed: false,
    liveCallCount: 0,
    likelyDataLevel,
    hasTrueBuyAmount,
    hasTrueSellAmount,
    hasNetFlow,
    hasTradeDirection,
    hasOrderImbalance,
    hasDepthBook,
    hasLargeOrderOrBlockFlow,
    hasOHLCV,
    historicalAvailability,
    intradayAvailability,
    estimatedAccessType,
    integrationDifficulty,
    quotaRisk,
    legalOrTermsRisk,
    notes,
  };
}

function buildCandidateProviderMatrix() {
  return [
    providerMatrixItem({
      providerName: "Existing archive",
      envVars: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
      configuredInProject: true,
      likelyDataLevel: "OHLCV_OR_INDICATOR_ONLY",
      hasOHLCV: true,
      historicalAvailability: "Archived daily OHLCV payloads when prior refreshes stored provider data.",
      intradayAvailability: "None in current archive model.",
      estimatedAccessType: "API_KEY",
      integrationDifficulty: "LOW",
      quotaRisk: "LOW",
      legalOrTermsRisk: "LOW",
      notes:
        "Current archive is useful for OHLCV-derived proxies, but does not contain true buy amount, sell amount, active buy/sell, or net flow.",
    }),
    providerMatrixItem({
      providerName: "Existing OHLCV providers",
      envVars: ["ALPHA_VANTAGE_API_KEY", "TWELVE_DATA_API_KEY", "EODHD_API_KEY", "POLYGON_API_KEY"],
      configuredInProject: true,
      likelyDataLevel: "OHLCV_OR_INDICATOR_ONLY",
      hasOHLCV: true,
      historicalAvailability: "Daily OHLCV through current provider ladder and archive.",
      intradayAvailability: "Not currently integrated for flow research.",
      estimatedAccessType: "API_KEY",
      integrationDifficulty: "LOW",
      quotaRisk: "LOW",
      legalOrTermsRisk: "LOW",
      notes:
        "Current production provider ladder supports real OHLCV and derived indicators only; production data does not expose true buy/sell/net flow.",
    }),
    providerMatrixItem({
      providerName: "Moomoo OpenD get_capital_distribution",
      envVars: ["MOOMOO_CAPITAL_FLOW_ENABLED"],
      configuredInProject: true,
      likelyDataLevel: "REAL_BUY_SELL_NET_FLOW",
      hasTrueBuyAmount: true,
      hasTrueSellAmount: true,
      hasNetFlow: true,
      historicalAvailability:
        "Daily capital distribution can be archived from each successful scoped refresh; historical backfill depends on API support and is throttled.",
      intradayAvailability:
        "Quote-only OpenD capital distribution endpoint returns capital-in and capital-out buckets when OpenD is reachable.",
      estimatedAccessType: "API_KEY",
      integrationDifficulty: "LOW",
      quotaRisk: "LOW",
      legalOrTermsRisk: "LOW",
      notes:
        "V1.9.2 integrates quote/capital-flow access only via Moomoo OpenQuoteContext; no trading context or order endpoint is used.",
    }),
    providerMatrixItem({
      providerName: "Alpha Vantage",
      envVars: ["ALPHA_VANTAGE_API_KEY"],
      configuredInProject: true,
      likelyDataLevel: "OHLCV_OR_INDICATOR_ONLY",
      hasOHLCV: true,
      historicalAvailability: "Daily OHLCV and technical indicators through existing integration.",
      intradayAvailability: "Possible with API key, not currently used for real-flow research.",
      estimatedAccessType: "API_KEY",
      integrationDifficulty: "LOW",
      quotaRisk: "MEDIUM",
      legalOrTermsRisk: "LOW",
      notes:
        "Useful for OHLCV/indicator baselines such as MFI/AD/ADOSC/CMF-style features; not a direct buy/sell amount source.",
    }),
    providerMatrixItem({
      providerName: "Twelve Data",
      envVars: ["TWELVE_DATA_API_KEY"],
      configuredInProject: true,
      likelyDataLevel: "OHLCV_OR_INDICATOR_ONLY",
      hasOHLCV: true,
      historicalAvailability: "Daily OHLCV through existing integration.",
      intradayAvailability: "Possible with API key, not currently used for real-flow research.",
      estimatedAccessType: "API_KEY",
      integrationDifficulty: "LOW",
      quotaRisk: "MEDIUM",
      legalOrTermsRisk: "LOW",
      notes:
        "Supports OHLCV/indicator style inputs, but no configured true same-day buy amount or sell amount field.",
    }),
    providerMatrixItem({
      providerName: "EODHD",
      envVars: ["EODHD_API_KEY"],
      configuredInProject: true,
      likelyDataLevel: "OHLCV_OR_INDICATOR_ONLY",
      hasOHLCV: true,
      historicalAvailability: "Daily OHLCV through existing integration.",
      intradayAvailability: "Not currently integrated for real-flow research.",
      estimatedAccessType: "API_KEY",
      integrationDifficulty: "LOW",
      quotaRisk: "MEDIUM",
      legalOrTermsRisk: "LOW",
      notes:
        "Good archive/OHLCV source; no current configured field for true buy amount, sell amount, or active buy/sell flow.",
    }),
    providerMatrixItem({
      providerName: "Polygon",
      envVars: ["POLYGON_API_KEY"],
      configuredInProject: true,
      likelyDataLevel: "TRADE_DIRECTION_OR_ORDER_FLOW",
      hasTradeDirection: true,
      hasOHLCV: true,
      historicalAvailability: "Trades, quotes, aggregates, and snapshots depending on subscription.",
      intradayAvailability: "Trades and quotes can support aggressor-side inference with matching logic.",
      estimatedAccessType: "PAID_SUBSCRIPTION",
      integrationDifficulty: "MEDIUM",
      quotaRisk: "MEDIUM",
      legalOrTermsRisk: "LOW",
      notes:
        "Most promising configured provider for inferred trade direction from trade/quote matching, but not direct true buy amount/sell amount.",
    }),
    providerMatrixItem({
      providerName: "IEX TOPS / DEEP / DEEP+",
      envVars: ["IEX_API_KEY", "IEX_CLOUD_API_KEY"],
      configuredInProject: false,
      likelyDataLevel: "DEPTH_OR_QUOTE_PRESSURE",
      hasTradeDirection: true,
      hasDepthBook: true,
      hasOHLCV: true,
      historicalAvailability: "Depends on IEX data product and subscription.",
      intradayAvailability: "IEX exchange top-of-book, last-sale, and depth products.",
      estimatedAccessType: "PAID_SUBSCRIPTION",
      integrationDifficulty: "MEDIUM",
      quotaRisk: "MEDIUM",
      legalOrTermsRisk: "MEDIUM",
      notes:
        "Can improve quote/depth pressure and IEX-specific trade/depth signals, but is venue-specific rather than consolidated true buy/sell flow.",
    }),
    providerMatrixItem({
      providerName: "Nasdaq TotalView / NOII / DataStore",
      envVars: ["NASDAQ_API_KEY", "NASDAQ_DATA_LINK_API_KEY"],
      configuredInProject: false,
      likelyDataLevel: "ORDER_IMBALANCE",
      hasOrderImbalance: true,
      hasDepthBook: true,
      historicalAvailability: "Historical TotalView/ITCH and DataStore products may be available by subscription.",
      intradayAvailability: "TotalView provides full Nasdaq book depth and NOII auction imbalance messages.",
      estimatedAccessType: "EXCHANGE_FEED",
      integrationDifficulty: "HIGH",
      quotaRisk: "MEDIUM",
      legalOrTermsRisk: "MEDIUM",
      notes:
        "Strong candidate for opening/closing auction imbalance and depth signals. Likely requires paid exchange data licensing.",
    }),
    providerMatrixItem({
      providerName: "NYSE Order Imbalances",
      envVars: ["NYSE_API_KEY"],
      configuredInProject: false,
      likelyDataLevel: "ORDER_IMBALANCE",
      hasOrderImbalance: true,
      historicalAvailability: "Depends on NYSE data product licensing.",
      intradayAvailability: "Opening/closing imbalance style feeds may be available through exchange products.",
      estimatedAccessType: "EXCHANGE_FEED",
      integrationDifficulty: "HIGH",
      quotaRisk: "MEDIUM",
      legalOrTermsRisk: "MEDIUM",
      notes:
        "Useful for auction imbalance research, especially near open/close. Not a direct all-day buy/sell amount source.",
    }),
    providerMatrixItem({
      providerName: "Databento",
      envVars: ["DATABENTO_API_KEY"],
      configuredInProject: false,
      likelyDataLevel: "TRADE_DIRECTION_OR_ORDER_FLOW",
      hasTradeDirection: true,
      hasDepthBook: true,
      hasLargeOrderOrBlockFlow: true,
      hasOHLCV: true,
      historicalAvailability: "Historical trades, top-of-book, order book deltas/snapshots depending on dataset.",
      intradayAvailability: "Real-time/historical market microstructure feeds by subscription.",
      estimatedAccessType: "PAID_SUBSCRIPTION",
      integrationDifficulty: "MEDIUM",
      quotaRisk: "MEDIUM",
      legalOrTermsRisk: "LOW",
      notes:
        "Most promising vendor-style path for tick/order-book research and aggressor-side inference without browser scraping.",
    }),
    providerMatrixItem({
      providerName: "Intrinio",
      envVars: ["INTRINIO_API_KEY"],
      configuredInProject: false,
      likelyDataLevel: "TRADE_DIRECTION_OR_ORDER_FLOW",
      hasTradeDirection: true,
      hasLargeOrderOrBlockFlow: true,
      hasOHLCV: true,
      historicalAvailability: "Depends on selected real-time/historical equity feeds.",
      intradayAvailability: "May provide trades/quotes and specialized feeds by subscription.",
      estimatedAccessType: "PAID_SUBSCRIPTION",
      integrationDifficulty: "MEDIUM",
      quotaRisk: "MEDIUM",
      legalOrTermsRisk: "LOW",
      notes:
        "Feasible vendor candidate for paid tick/trade/quote datasets; direct true buy/sell amounts are not assumed without product validation.",
    }),
    providerMatrixItem({
      providerName: "Tiingo",
      envVars: ["TIINGO_API_KEY"],
      configuredInProject: false,
      likelyDataLevel: "OHLCV_OR_INDICATOR_ONLY",
      hasOHLCV: true,
      historicalAvailability: "Historical/intraday OHLCV depending on plan.",
      intradayAvailability: "Intraday data may be available by API key.",
      estimatedAccessType: "API_KEY",
      integrationDifficulty: "LOW",
      quotaRisk: "LOW",
      legalOrTermsRisk: "LOW",
      notes:
        "Likely useful as another OHLCV source, but not a primary path to true buy/sell/net flow.",
    }),
    providerMatrixItem({
      providerName: "Alpaca market data",
      envVars: ["ALPACA_API_KEY", "ALPACA_SECRET_KEY", "ALPACA_DATA_API_KEY"],
      configuredInProject: false,
      likelyDataLevel: "TRADE_DIRECTION_OR_ORDER_FLOW",
      hasTradeDirection: true,
      hasOHLCV: true,
      historicalAvailability: "Trades, quotes, and bars depending on plan/feed.",
      intradayAvailability: "Real-time trades/quotes/bars depending on feed subscription.",
      estimatedAccessType: "PAID_SUBSCRIPTION",
      integrationDifficulty: "MEDIUM",
      quotaRisk: "MEDIUM",
      legalOrTermsRisk: "LOW",
      notes:
        "Can support trade/quote matching and aggressor inference; not expected to return direct same-day buy and sell amount totals.",
    }),
    providerMatrixItem({
      providerName: "Tradier",
      envVars: ["TRADIER_API_KEY", "TRADIER_ACCESS_TOKEN"],
      configuredInProject: false,
      likelyDataLevel: "OHLCV_OR_INDICATOR_ONLY",
      hasOHLCV: true,
      historicalAvailability: "Market data depends on Tradier account/API access.",
      intradayAvailability: "Quotes and market data available by account/API terms.",
      estimatedAccessType: "API_KEY",
      integrationDifficulty: "MEDIUM",
      quotaRisk: "MEDIUM",
      legalOrTermsRisk: "LOW",
      notes:
        "Useful for brokerage-style quote data, but not recommended as first path for real buy/sell flow.",
    }),
    providerMatrixItem({
      providerName: "Nasdaq Data Link",
      envVars: ["NASDAQ_DATA_LINK_API_KEY"],
      configuredInProject: false,
      likelyDataLevel: "OHLCV_OR_INDICATOR_ONLY",
      hasOHLCV: true,
      historicalAvailability: "Depends on subscribed datasets.",
      intradayAvailability: "Dataset-specific.",
      estimatedAccessType: "PAID_SUBSCRIPTION",
      integrationDifficulty: "MEDIUM",
      quotaRisk: "LOW",
      legalOrTermsRisk: "LOW",
      notes:
        "Good dataset marketplace path, but true buy/sell flow depends on a specific licensed dataset, not generic Data Link access.",
    }),
    providerMatrixItem({
      providerName: "Market Chameleon / MOC imbalance style sources",
      envVars: ["MARKET_CHAMELEON_API_KEY"],
      configuredInProject: false,
      likelyDataLevel: "ORDER_IMBALANCE",
      hasOrderImbalance: true,
      hasLargeOrderOrBlockFlow: true,
      historicalAvailability: "Provider/product-specific.",
      intradayAvailability: "May expose closing/opening imbalance style datasets by subscription.",
      estimatedAccessType: "PAID_SUBSCRIPTION",
      integrationDifficulty: "MEDIUM",
      quotaRisk: "MEDIUM",
      legalOrTermsRisk: "MEDIUM",
      notes:
        "Potential source for MOC/imbalance-style research if a licensed API/data product is available. No scraping or broker-app bypassing should be used.",
    }),
  ];
}

function dedupeCandidates(...snapshots: Array<SnapshotResponse | null>) {
  const byTicker = new Map<string, SearchCandidate>();

  snapshots.forEach((snapshot) => {
    snapshot?.items.forEach((item) => {
      const ticker = item.ticker.toUpperCase();
      if (!byTicker.has(ticker)) {
        byTicker.set(ticker, item as SearchCandidate);
      }
    });
  });

  return byTicker;
}

function currentDataClass(candidate: SearchCandidate | undefined) {
  if (!candidate) return "UNAVAILABLE";
  if (candidate.providerUsed || candidate.archiveStatus || candidate.capitalFlowDataSource) {
    return "OHLCV_OR_INDICATOR_ONLY";
  }

  return "UNAVAILABLE";
}

function buildProviderPriority(matrix: ReturnType<typeof buildCandidateProviderMatrix>) {
  return [
    {
      priority: 1,
      dataLevel: "REAL_BUY_SELL_NET_FLOW",
      providers: matrix
        .filter((provider) => provider.likelyDataLevel === "REAL_BUY_SELL_NET_FLOW")
        .map((provider) => provider.providerName),
      rationale:
        "Use any licensed provider that exposes true buy amount, sell amount, active buy/sell, or net flow directly.",
    },
    {
      priority: 2,
      dataLevel: "ORDER_IMBALANCE",
      providers: ["Nasdaq TotalView / NOII / DataStore", "NYSE Order Imbalances", "Market Chameleon / MOC imbalance style sources"],
      rationale:
        "Auction imbalance feeds are the most actionable near-real flow substitute for opening/closing demand pressure.",
    },
    {
      priority: 3,
      dataLevel: "DEPTH_OR_QUOTE_PRESSURE",
      providers: ["IEX TOPS / DEEP / DEEP+", "Databento", "Nasdaq TotalView / NOII / DataStore"],
      rationale:
        "Depth and quote pressure can measure supply/demand imbalance without relying on OHLCV-only proxy values.",
    },
    {
      priority: 4,
      dataLevel: "TRADE_DIRECTION_OR_ORDER_FLOW",
      providers: ["Databento", "Polygon", "Alpaca market data", "Intrinio"],
      rationale:
        "Trade/quote matching can infer aggressor side and active buy/sell pressure, but requires tick-level processing.",
    },
    {
      priority: 5,
      dataLevel: "OHLCV_OR_INDICATOR_ONLY",
      providers: ["Alpha Vantage", "Twelve Data", "EODHD", "Tiingo", "Existing archive"],
      rationale:
        "Provider indicators improve proxy quality but remain lower-quality than order-flow or imbalance data.",
    },
    {
      priority: 6,
      dataLevel: "ENHANCED_OHLCV_PROXY",
      providers: ["V1.8.8.1 Enhanced Flow Proxy"],
      rationale:
        "Use enhanced OHLCV proxy only while real-flow, imbalance, depth, or tick-direction feeds remain unavailable.",
    },
  ];
}

function buildRows({
  tickers,
  candidateByTicker,
  topRankedTickers,
  fixedWatchlistTickers,
}: {
  tickers: string[];
  candidateByTicker: Map<string, SearchCandidate>;
  topRankedTickers: Set<string>;
  fixedWatchlistTickers: Set<string>;
}) {
  return tickers.map((ticker) => {
    const candidate = candidateByTicker.get(ticker);

    return {
      ticker,
      inTopRanked: topRankedTickers.has(ticker),
      inFixedWatchlist: fixedWatchlistTickers.has(ticker),
      currentProductionProvider:
        candidate?.providerUsed ?? candidate?.capitalFlowDataSource ?? "UNKNOWN",
      currentDataClass: currentDataClass(candidate),
      currentRealFlowAvailable: false,
      candidateRealFlowSources: [],
      candidateImbalanceSources: [
        "Nasdaq TotalView / NOII / DataStore",
        "NYSE Order Imbalances",
        "Market Chameleon / MOC imbalance style sources",
      ],
      candidateDepthSources: [
        "IEX TOPS / DEEP / DEEP+",
        "Databento",
        "Nasdaq TotalView / NOII / DataStore",
      ],
      recommendedNextProviderToTest: envPresent(["POLYGON_API_KEY"])
        ? "Polygon trade/quote aggressor inference"
        : "Databento equities trades/order book sample",
      providerPriority: envPresent(["POLYGON_API_KEY"]) ? 4 : 3,
      reason:
        "Current production row is OHLCV/indicator-only. Test a licensed tick/depth/imbalance source on the scoped ticker set before considering any production flow upgrade.",
      productionFlowChanged: false,
    };
  });
}

function summarizeProviderSearch(matrix: ReturnType<typeof buildCandidateProviderMatrix>) {
  const moomoo = matrix.find(
    (provider) => provider.providerName === "Moomoo OpenD get_capital_distribution",
  );

  return {
    trueBuySellNetFlowProviderCount: matrix.filter(
      (provider) => provider.likelyDataLevel === "REAL_BUY_SELL_NET_FLOW",
    ).length,
    tradeDirectionOrOrderFlowProviderCount: matrix.filter(
      (provider) => provider.likelyDataLevel === "TRADE_DIRECTION_OR_ORDER_FLOW",
    ).length,
    orderImbalanceProviderCount: matrix.filter(
      (provider) => provider.likelyDataLevel === "ORDER_IMBALANCE",
    ).length,
    depthOrQuotePressureProviderCount: matrix.filter(
      (provider) => provider.likelyDataLevel === "DEPTH_OR_QUOTE_PRESSURE",
    ).length,
    ohlcvOrIndicatorOnlyProviderCount: matrix.filter(
      (provider) => provider.likelyDataLevel === "OHLCV_OR_INDICATOR_ONLY",
    ).length,
    configuredProviderCount: matrix.filter((provider) => provider.configuredInProject).length,
    envConfiguredProviderCount: matrix.filter((provider) => provider.envVarsPresent).length,
    liveProviderCallCount: matrix.reduce((sum, provider) => sum + provider.liveCallCount, 0),
    currentProjectCanAccessTrueBuySellFlowToday: Boolean(moomoo?.envVarsPresent),
    likelyPaidOrExchangeFeedRequired: !moomoo?.envVarsPresent,
    mostPromisingNextProviders: [
      "Moomoo OpenD get_capital_distribution",
      "Databento",
      "Nasdaq TotalView / NOII / DataStore",
      "Polygon trade/quote aggressor inference",
      "IEX TOPS / DEEP / DEEP+",
    ],
  };
}

export async function buildRealFlowProviderDeepSearchReport(
  options: BuildRealFlowProviderDeepSearchOptions = {},
) {
  const requestedLimit = options.limit ?? MAX_REAL_FLOW_SEARCH_TICKERS;
  const limit = Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_REAL_FLOW_SEARCH_TICKERS);
  const [marketSnapshot, fixedSnapshot] = await Promise.all([
    getLatestSnapshot("MARKET_SCAN"),
    getLatestSnapshot("FIXED_WATCHLIST"),
  ]);
  const topRanked = (marketSnapshot?.items ?? []).slice(0, TOP_RANKED_LIMIT);
  const fixedItems = fixedSnapshot?.items ?? [];
  const topRankedTickers = new Set(topRanked.map((item) => item.ticker.toUpperCase()));
  const fixedWatchlistTickers = new Set(FIXED_WATCHLIST.map((ticker) => ticker.toUpperCase()));
  const candidateByTicker = dedupeCandidates(marketSnapshot, fixedSnapshot);
  const orderedTickerSet = new Set<string>();

  topRanked.forEach((item) => orderedTickerSet.add(item.ticker.toUpperCase()));
  FIXED_WATCHLIST.forEach((ticker) => orderedTickerSet.add(ticker));
  fixedItems.forEach((item) => orderedTickerSet.add(item.ticker.toUpperCase()));

  const realFlowProviderSearchTickerSet = Array.from(orderedTickerSet).slice(0, limit);
  const candidateProviderMatrix = buildCandidateProviderMatrix();
  const providerPriority = buildProviderPriority(candidateProviderMatrix);
  const rows = buildRows({
    tickers: realFlowProviderSearchTickerSet,
    candidateByTicker,
    topRankedTickers,
    fixedWatchlistTickers,
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    version: VERSION,
    realFlowProviderSearchTickerSet,
    realFlowSearchTickerCount: realFlowProviderSearchTickerSet.length,
    maxRealFlowSearchTickers: MAX_REAL_FLOW_SEARCH_TICKERS,
    searchScope: {
      topRankedTickerCount: topRankedTickers.size,
      fixedWatchlistTickerCount: FIXED_WATCHLIST.length,
      uniqueTickerCount: realFlowProviderSearchTickerSet.length,
      maxRealFlowSearchTickers: MAX_REAL_FLOW_SEARCH_TICKERS,
      fullUniverseSearchAllowed: false,
      liveProviderCallCount: 0,
      notes:
        "V1.8.9 is a feasibility classification only. It reads latest snapshots and environment configuration, performs no live market-data calls, and does not search the full universe.",
    },
    providerSearchSummary: summarizeProviderSearch(candidateProviderMatrix),
    providerPriority,
    candidateProviderMatrix,
    rows,
    recommendation:
      "V1.9.2 adds Moomoo OpenD get_capital_distribution as the lowest-friction direct capital-flow path for scoped tickers. Keep production flow and trading rules unchanged; continue evaluating Databento/Nasdaq/IEX for institutional-grade confirmation.",
    nextActions: [
      "Use Moomoo capital distribution only through quote/capital-flow access; do not use trading or order endpoints.",
      "Archive Moomoo direct flow daily for the scoped ticker set only, capped by the V1.9.2 quota guard.",
      "Request/sample Databento US equities trades and order-book data for the scoped ticker set only.",
      "Evaluate Nasdaq TotalView/NOII or NYSE imbalance feeds for opening/closing imbalance research.",
      "If using Polygon, prototype trade/quote matching for aggressor-side inference on one to three tickers before expanding to the 26-ticker cap.",
      "Do not promote any new flow source into production until a later Flow Data Quality Upgrade and Risk Gate review.",
    ],
    safetyWarnings: [
      "Provider discovery only: production flow, scoring, thresholds, and Entry / Position rules are unchanged.",
      "No broker app scraping, Webull scraping, authentication bypass, or unofficial endpoint use is implemented.",
      "No live provider calls are made by this endpoint.",
      "Full-universe real-flow search is disabled; scope is capped at Top 11 plus Fixed Watchlist, max 26 unique tickers.",
    ],
    flowDataQualityAvailable: true,
    flowDataQualityEndpoint: "/api/debug/flow-data-quality?limit=26",
    productionFlowChanged: false,
  };
}
