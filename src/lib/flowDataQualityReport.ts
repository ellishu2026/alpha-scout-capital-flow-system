import "server-only";

import { buildEnhancedFlowCalibrationReport } from "@/lib/enhancedFlowCalibration";
import {
  FLOW_DATA_QUALITY_ENDPOINT,
  FLOW_DATA_QUALITY_VERSION,
  FLOW_TIER_DEFINITIONS,
  applyFlowDataQualityMetadataToItem,
  currentProductionFlowSource,
  currentProductionFlowSourceClass,
  recommendedFlowUpgradeReason,
  recommendedFlowUpgradeSource,
} from "@/lib/flowDataQualityTiers";
import { FIXED_WATCHLIST_SYMBOLS } from "@/lib/marketUniverse";
import { getLatestSnapshot } from "@/lib/snapshotStore";
import type { SnapshotResponse, StockCandidate } from "@/types/stock";

const VERSION = "V1.9.0_FLOW_DATA_QUALITY_UPGRADE";
const MAX_FLOW_DATA_QUALITY_TICKERS = 26;
const TOP_RANKED_LIMIT = 11;

const FIXED_WATCHLIST = FIXED_WATCHLIST_SYMBOLS;

type BuildFlowDataQualityReportOptions = {
  limit?: number;
};

type CalibrationRow = {
  ticker: string;
  inTopRanked?: boolean;
  inFixedWatchlist?: boolean;
  enhancedProxyFlow1D_V188?: number | null;
  enhancedProxyDirection_V188?: string | null;
  flowConfidence?: string | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function dedupeCandidates(...snapshots: Array<SnapshotResponse | null>) {
  const byTicker = new Map<string, StockCandidate>();

  snapshots.forEach((snapshot) => {
    snapshot?.items.forEach((item) => {
      const ticker = item.ticker.toUpperCase();
      if (!byTicker.has(ticker)) {
        byTicker.set(ticker, item);
      }
    });
  });

  return byTicker;
}

function average(values: number[]) {
  if (values.length === 0) return null;

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function summarizeRows(rows: ReturnType<typeof buildReportRow>[]) {
  const tierCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const tier = row.flowDataTier ?? "UNKNOWN_OR_UNAVAILABLE";
    counts[tier] = (counts[tier] ?? 0) + 1;
    return counts;
  }, {});
  const recommendedUpgradeSourceCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const source = row.recommendedFlowUpgradeSource ?? "UNKNOWN";
    counts[source] = (counts[source] ?? 0) + 1;
    return counts;
  }, {});

  return {
    rowCount: rows.length,
    tierCounts,
    realFlowAvailableCount: rows.filter((row) => row.realFlowAvailable).length,
    enhancedProxyAvailableCount: rows.filter((row) => row.enhancedProxyAvailable).length,
    legacyOnlyCount: rows.filter((row) => row.flowDataTier === "LEGACY_OHLCV_PROXY").length,
    fallbackCount: rows.filter((row) => row.flowDataTier === "YFINANCE_OR_FALLBACK_PROXY").length,
    unknownCount: rows.filter((row) => row.flowDataTier === "UNKNOWN_OR_UNAVAILABLE").length,
    averageFlowDataQualityScore: average(rows.map((row) => row.flowDataQualityScore)),
    recommendedUpgradeSourceCounts,
    productionFlowChanged: false,
  };
}

function buildReportRow({
  candidate,
  calibrationRow,
}: {
  candidate: StockCandidate;
  calibrationRow?: CalibrationRow;
}) {
  const enhancedProxyAvailable = isFiniteNumber(calibrationRow?.enhancedProxyFlow1D_V188);
  const item = applyFlowDataQualityMetadataToItem(candidate, {
    enhancedProxyAvailable,
    enhancedProxyConfidence: calibrationRow?.flowConfidence ?? null,
    enhancedProxyFlow1D_V188: calibrationRow?.enhancedProxyFlow1D_V188 ?? null,
    enhancedProxyDirection_V188: calibrationRow?.enhancedProxyDirection_V188 ?? null,
  });

  return {
    ticker: item.ticker,
    inTopRanked: calibrationRow?.inTopRanked ?? false,
    inFixedWatchlist: calibrationRow?.inFixedWatchlist ?? false,
    providerUsed: item.providerUsed ?? null,
    currentProductionFlowSource: item.currentProductionFlowSource ?? currentProductionFlowSource(candidate),
    currentProductionFlowSourceClass:
      item.currentProductionFlowSourceClass ?? currentProductionFlowSourceClass(),
    flowDataTier: item.flowDataTier,
    flowDataTierLabel: item.flowDataTierLabel,
    flowDataQualityScore: item.flowDataQualityScore ?? 0,
    flowDataConfidence: item.flowDataConfidence,
    realFlowAvailable: item.realFlowAvailable ?? false,
    realBuyAmount: item.realBuyAmount ?? null,
    realSellAmount: item.realSellAmount ?? null,
    realNetFlow: item.realNetFlow ?? null,
    moomooFlowAvailable: item.moomooFlowAvailable ?? false,
    moomooBuyAmount: item.moomooBuyAmount ?? null,
    moomooSellAmount: item.moomooSellAmount ?? null,
    moomooNetFlow: item.moomooNetFlow ?? null,
    moomooFlowDate: item.moomooFlowDate ?? null,
    moomooFlowSource: item.moomooFlowSource ?? null,
    enhancedProxyAvailable: item.enhancedProxyAvailable ?? false,
    enhancedProxyFlow1D_V188: item.enhancedProxyFlow1D_V188 ?? null,
    enhancedProxyDirection_V188: item.enhancedProxyDirection_V188 ?? null,
    enhancedProxyConfidence: calibrationRow?.flowConfidence ?? null,
    currentProductionFlow1D: candidate.capitalFlow1D ?? null,
    productionFlowChanged: false,
    recommendedFlowUpgradeSource:
      item.recommendedFlowUpgradeSource ?? recommendedFlowUpgradeSource(),
    recommendedFlowUpgradeReason:
      item.recommendedFlowUpgradeReason ?? recommendedFlowUpgradeReason(),
    nextProviderToTest:
      item.flowDataTier === "MOOMOO_DIRECT_CAPITAL_FLOW"
        ? "Databento/Nasdaq/IEX institutional confirmation"
        : "Polygon trade/quote aggressor inference",
  };
}

export async function buildFlowDataQualityReport(
  options: BuildFlowDataQualityReportOptions = {},
) {
  const requestedLimit = options.limit ?? MAX_FLOW_DATA_QUALITY_TICKERS;
  const limit = Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_FLOW_DATA_QUALITY_TICKERS);
  const [marketSnapshot, fixedSnapshot, calibrationReport] = await Promise.all([
    getLatestSnapshot("MARKET_SCAN"),
    getLatestSnapshot("FIXED_WATCHLIST"),
    buildEnhancedFlowCalibrationReport({ limit }),
  ]);
  const topRanked = (marketSnapshot?.items ?? []).slice(0, TOP_RANKED_LIMIT);
  const fixedItems = fixedSnapshot?.items ?? [];
  const candidateByTicker = dedupeCandidates(marketSnapshot, fixedSnapshot);
  const topRankedTickers = new Set(topRanked.map((item) => item.ticker.toUpperCase()));
  const fixedWatchlistTickers = new Set(FIXED_WATCHLIST.map((ticker) => ticker.toUpperCase()));
  const calibrationRows = (calibrationReport.rows ?? []) as CalibrationRow[];
  const calibrationByTicker = new Map(
    calibrationRows.map((row) => [row.ticker.toUpperCase(), row]),
  );
  const orderedTickerSet = new Set<string>();

  topRanked.forEach((item) => orderedTickerSet.add(item.ticker.toUpperCase()));
  FIXED_WATCHLIST.forEach((ticker) => orderedTickerSet.add(ticker));
  fixedItems.forEach((item) => orderedTickerSet.add(item.ticker.toUpperCase()));

  const scopedTickers = Array.from(orderedTickerSet).slice(0, limit);
  const rows = scopedTickers
    .map((ticker) => {
      const candidate = candidateByTicker.get(ticker);
      if (!candidate) return null;

      const calibrationRow = calibrationByTicker.get(ticker);
      return buildReportRow({
        candidate,
        calibrationRow: calibrationRow
          ? {
              ...calibrationRow,
              inTopRanked: topRankedTickers.has(ticker),
              inFixedWatchlist: fixedWatchlistTickers.has(ticker),
            }
          : undefined,
      });
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    version: VERSION,
    flowDataQualityVersion: FLOW_DATA_QUALITY_VERSION,
    productionFlowChanged: false,
    scope: {
      topRankedTickerCount: topRankedTickers.size,
      fixedWatchlistTickerCount: FIXED_WATCHLIST.length,
      uniqueTickerCount: scopedTickers.length,
      maxFlowDataQualityTickers: MAX_FLOW_DATA_QUALITY_TICKERS,
      fullUniverseQualityCalculationAllowed: false,
      liveProviderCallCount: 0,
      sourceEndpoints: {
        enhancedFlowCalibration: "/api/debug/enhanced-flow-calibration?limit=26",
        realFlowProviderDeepSearch: "/api/debug/real-flow-provider-deep-search?limit=26",
        flowDataQuality: FLOW_DATA_QUALITY_ENDPOINT,
      },
    },
    tierDefinitions: FLOW_TIER_DEFINITIONS,
    summary: summarizeRows(rows),
    rows,
    recommendation:
      "Keep production flow unchanged. Treat current rows as enhanced or legacy OHLCV proxy quality until a licensed real-flow, imbalance, depth, or trade-direction source is validated.",
    safetyWarnings: [
      "Diagnostic metadata only: production flow values, scoring, thresholds, and Entry / Position rules are unchanged.",
      "No live provider calls are made by this endpoint.",
      "Full-universe flow quality calculation is disabled; scope is capped at Top 11 plus Fixed Watchlist, max 26 unique tickers.",
    ],
  };
}
