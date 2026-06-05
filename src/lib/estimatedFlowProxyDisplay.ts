import "server-only";

import type { OhlcvCandle } from "@/lib/capitalFlow";
import { FIXED_WATCHLIST_SYMBOLS } from "@/lib/marketUniverse";
import { getArchivedMarketDataForTicker } from "@/lib/marketDataProviders";
import {
  MOOMOO_FLOW_QUALITY_SCORE,
  MOOMOO_FLOW_TIER,
  MOOMOO_FLOW_TIER_LABEL,
  MOOMOO_FLOW_VERSION,
  MOOMOO_PROVIDER,
  fetchScopedMoomooCapitalFlows,
  type MoomooCapitalDistribution,
} from "@/lib/moomooCapitalFlow";
import type { SnapshotResponse, StockCandidate } from "@/types/stock";

export const ESTIMATED_FLOW_PROXY_VERSION = "V1.9.1_EST_FLOW_DISPLAY_PROXY";
export const ESTIMATED_FLOW_PROXY_METHOD = "V188_COMPOSITE_OHLCV_PROXY";

const MAX_ESTIMATED_FLOW_TICKERS = 26;
const TOP_RANKED_LIMIT = 11;
const COMPONENT_WEIGHTS = {
  chaikinFlow: 0.45,
  priceChangeWeightedFlow: 0.25,
  mfiLikeFlow: 0.2,
  obvDirectionalFlow: 0.1,
} as const;

type DailyEstimatedFlow = {
  date: string;
  value: number;
};

type EstimatedFlowOverlay = {
  capitalFlow1D: number | null;
  capitalFlow3D: number | null;
  capitalFlow5D: number | null;
  capitalFlow10D: number | null;
  capitalFlow20D: number | null;
  capitalFlow5W: number | null;
  capitalFlow6W: number | null;
  capitalFlow9W: number | null;
  capitalFlow12W: number | null;
  enhancedProxyFlow1D_V188: number | null;
  enhancedProxyDirection_V188: StockCandidate["enhancedProxyDirection_V188"];
  estimatedFlowProxyAvailable: boolean;
  estimatedFlowProxyStatus: string;
  estimatedFlowProxyUnavailableReason: string | null;
  estimatedFlowProxyRowsUsed: number;
  estimatedFlowProxySource: string | null;
  estimatedFlowProxyUpdatedAt: string | null;
  flow1DSource: string;
  providerUsed?: StockCandidate["providerUsed"];
  flowDataTier?: StockCandidate["flowDataTier"];
  flowDataTierLabel?: string;
  flowDataQualityScore?: number;
  flowDataConfidence?: StockCandidate["flowDataConfidence"];
  realFlowAvailable?: boolean;
  directBuyAmount?: number | null;
  directSellAmount?: number | null;
  directNetFlow?: number | null;
  moomooFlow?: MoomooCapitalDistribution | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function sortedValidCandles(candles: OhlcvCandle[]) {
  return candles
    .filter(
      (candle) =>
        candle.date instanceof Date &&
        Number.isFinite(candle.date.getTime()) &&
        isFiniteNumber(candle.open) &&
        isFiniteNumber(candle.high) &&
        isFiniteNumber(candle.low) &&
        isFiniteNumber(candle.close) &&
        isFiniteNumber(candle.volume) &&
        candle.volume > 0,
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function typicalPrice(candle: OhlcvCandle) {
  return ((candle.high ?? 0) + (candle.low ?? 0) + (candle.close ?? 0)) / 3;
}

function closeLocation(candle: OhlcvCandle) {
  if (!isFiniteNumber(candle.high) || !isFiniteNumber(candle.low) || !isFiniteNumber(candle.close)) {
    return null;
  }

  const range = candle.high - candle.low;
  if (range === 0) return 0;

  return clamp((2 * candle.close - candle.high - candle.low) / range, -1, 1);
}

function sumLastIfAvailable(values: DailyEstimatedFlow[], count: number) {
  if (values.length < count) return null;

  return values
    .slice(-count)
    .reduce((sum, row) => sum + row.value, 0);
}

function sumLastMoomooIfAvailable(values: MoomooCapitalDistribution[], count: number) {
  if (values.length < count) return null;

  return values.slice(-count).reduce((sum, row) => sum + row.netFlow, 0);
}

function direction(value: number | null): StockCandidate["enhancedProxyDirection_V188"] {
  if (!isFiniteNumber(value)) return "Unknown";
  if (value > 0) return "Positive";
  if (value < 0) return "Negative";
  return "Neutral";
}

function calculateDailyEstimatedFlows(candles: OhlcvCandle[]) {
  const validCandles = sortedValidCandles(candles);

  if (validCandles.length < 2) {
    return {
      rows: [],
      unavailableReason: "Insufficient OHLCV archive: at least two valid trading days are required.",
    };
  }

  const rows: DailyEstimatedFlow[] = [];

  validCandles.forEach((candle, index) => {
    if (index === 0) return;

    const previous = validCandles[index - 1];
    const latestDollarVolume = candle.close! * candle.volume!;
    const previousClose = previous.close;

    if (!isFiniteNumber(latestDollarVolume) || latestDollarVolume <= 0) {
      return;
    }

    const chaikinFlow = latestDollarVolume * (closeLocation(candle) ?? 0);
    const dailyReturn =
      isFiniteNumber(previousClose) && previousClose > 0
        ? (candle.close! - previousClose) / previousClose
        : 0;
    const priceChangeWeightedFlow = latestDollarVolume * clamp(dailyReturn, -0.08, 0.08);
    const previousTypical = typicalPrice(previous);
    const currentTypical = typicalPrice(candle);
    const typicalMove =
      isFiniteNumber(previousTypical) && previousTypical > 0
        ? (currentTypical - previousTypical) / previousTypical
        : 0;
    const mfiLikeFlow =
      Math.sign(typicalMove) * latestDollarVolume * Math.abs(clamp(typicalMove, -0.08, 0.08));
    const obvDirectionalFlow = Math.sign(dailyReturn) * latestDollarVolume * 0.15;

    const rawComposite =
      chaikinFlow * COMPONENT_WEIGHTS.chaikinFlow +
      priceChangeWeightedFlow * COMPONENT_WEIGHTS.priceChangeWeightedFlow +
      mfiLikeFlow * COMPONENT_WEIGHTS.mfiLikeFlow +
      obvDirectionalFlow * COMPONENT_WEIGHTS.obvDirectionalFlow;
    const cappedComposite = clamp(rawComposite, -latestDollarVolume, latestDollarVolume);

    rows.push({
      date: candle.date.toISOString().slice(0, 10),
      value: cappedComposite,
    });
  });

  return {
    rows,
    unavailableReason: rows.length === 0
      ? "Insufficient proxy data after OHLCV sanity guards."
      : null,
  };
}

function buildOverlayFromCandles(
  candles: OhlcvCandle[],
  source: string | null,
): EstimatedFlowOverlay {
  const { rows, unavailableReason } = calculateDailyEstimatedFlows(candles);
  const latest = rows.at(-1) ?? null;
  const available = rows.length >= 1 && !unavailableReason;

  return {
    capitalFlow1D: sumLastIfAvailable(rows, 1),
    capitalFlow3D: sumLastIfAvailable(rows, 3),
    capitalFlow5D: sumLastIfAvailable(rows, 5),
    capitalFlow10D: sumLastIfAvailable(rows, 10),
    capitalFlow20D: sumLastIfAvailable(rows, 20),
    capitalFlow5W: sumLastIfAvailable(rows, 25),
    capitalFlow6W: sumLastIfAvailable(rows, 30),
    capitalFlow9W: sumLastIfAvailable(rows, 45),
    capitalFlow12W: sumLastIfAvailable(rows, 60),
    enhancedProxyFlow1D_V188: latest?.value ?? null,
    enhancedProxyDirection_V188: direction(latest?.value ?? null),
    estimatedFlowProxyAvailable: available,
    estimatedFlowProxyStatus: available ? "AVAILABLE" : "INSUFFICIENT_PROXY_DATA",
    estimatedFlowProxyUnavailableReason: unavailableReason,
    estimatedFlowProxyRowsUsed: rows.length,
    estimatedFlowProxySource: source,
    estimatedFlowProxyUpdatedAt: latest?.date ?? null,
    flow1DSource: available ? "Enhanced OHLCV Proxy" : "Unavailable",
  };
}

function buildOverlayFromMoomooRows(rows: MoomooCapitalDistribution[]): EstimatedFlowOverlay {
  const sortedRows = rows.slice().sort((a, b) => a.flowDate.localeCompare(b.flowDate));
  const latest = sortedRows.at(-1) ?? null;

  if (!latest) {
    return insufficientOverlay("No Moomoo capital distribution rows available.");
  }

  return {
    capitalFlow1D: sumLastMoomooIfAvailable(sortedRows, 1),
    capitalFlow3D: sumLastMoomooIfAvailable(sortedRows, 3),
    capitalFlow5D: sumLastMoomooIfAvailable(sortedRows, 5),
    capitalFlow10D: sumLastMoomooIfAvailable(sortedRows, 10),
    capitalFlow20D: sumLastMoomooIfAvailable(sortedRows, 20),
    capitalFlow5W: sumLastMoomooIfAvailable(sortedRows, 25),
    capitalFlow6W: sumLastMoomooIfAvailable(sortedRows, 30),
    capitalFlow9W: sumLastMoomooIfAvailable(sortedRows, 45),
    capitalFlow12W: sumLastMoomooIfAvailable(sortedRows, 60),
    enhancedProxyFlow1D_V188: null,
    enhancedProxyDirection_V188: direction(latest.netFlow),
    estimatedFlowProxyAvailable: true,
    estimatedFlowProxyStatus: "MOOMOO_DIRECT_FLOW_AVAILABLE",
    estimatedFlowProxyUnavailableReason: null,
    estimatedFlowProxyRowsUsed: sortedRows.length,
    estimatedFlowProxySource:
      latest.source === "ARCHIVE"
        ? "MOOMOO_CAPITAL_DISTRIBUTION_ARCHIVE"
        : "MOOMOO_CAPITAL_DISTRIBUTION",
    estimatedFlowProxyUpdatedAt: latest.flowDate,
    flow1DSource: "Moomoo Direct Flow",
    providerUsed:
      latest.source === "ARCHIVE"
        ? "MOOMOO_CAPITAL_DISTRIBUTION_ARCHIVE"
        : "MOOMOO_CAPITAL_DISTRIBUTION",
    flowDataTier: MOOMOO_FLOW_TIER,
    flowDataTierLabel: MOOMOO_FLOW_TIER_LABEL,
    flowDataQualityScore: MOOMOO_FLOW_QUALITY_SCORE,
    flowDataConfidence: "High",
    realFlowAvailable: true,
    directBuyAmount: latest.buyAmount,
    directSellAmount: latest.sellAmount,
    directNetFlow: latest.netFlow,
    moomooFlow: latest,
  };
}

function insufficientOverlay(reason: string): EstimatedFlowOverlay {
  return {
    capitalFlow1D: null,
    capitalFlow3D: null,
    capitalFlow5D: null,
    capitalFlow10D: null,
    capitalFlow20D: null,
    capitalFlow5W: null,
    capitalFlow6W: null,
    capitalFlow9W: null,
    capitalFlow12W: null,
    enhancedProxyFlow1D_V188: null,
    enhancedProxyDirection_V188: "Unknown",
    estimatedFlowProxyAvailable: false,
    estimatedFlowProxyStatus: "INSUFFICIENT_PROXY_DATA",
    estimatedFlowProxyUnavailableReason: reason,
    estimatedFlowProxyRowsUsed: 0,
    estimatedFlowProxySource: null,
    estimatedFlowProxyUpdatedAt: null,
    flow1DSource: "Unavailable",
  };
}

function scopedTickerSet(snapshot: SnapshotResponse, fixedSnapshot?: SnapshotResponse | null) {
  const tickers = new Set<string>();

  snapshot.items.slice(0, TOP_RANKED_LIMIT).forEach((item) => {
    tickers.add(item.ticker.toUpperCase());
  });
  FIXED_WATCHLIST_SYMBOLS.forEach((ticker) => tickers.add(ticker.toUpperCase()));
  fixedSnapshot?.items.forEach((item) => tickers.add(item.ticker.toUpperCase()));

  return Array.from(tickers).slice(0, MAX_ESTIMATED_FLOW_TICKERS);
}

async function buildOverlayMap(tickers: string[]) {
  const entries = await Promise.all(
    tickers.map(async (ticker) => {
      const archived = await getArchivedMarketDataForTicker(ticker);

      if (!archived) {
        return [
          ticker,
          insufficientOverlay("No existing archived OHLCV data available for scoped Est.Flow refresh."),
        ] as const;
      }

      return [
        ticker,
        buildOverlayFromCandles(archived.candles, `${archived.provider}_ARCHIVE`),
      ] as const;
    }),
  );

  const overlayMap = new Map(entries);
  const moomooResult = await fetchScopedMoomooCapitalFlows(tickers);

  moomooResult.history.forEach((rows, ticker) => {
    overlayMap.set(ticker, buildOverlayFromMoomooRows(rows));
  });

  return {
    overlayMap,
    moomooSummary: moomooResult.guard,
    moomooErrors: moomooResult.errors,
    moomooHistory: moomooResult.history,
  };
}

function buildMoomooDateCoverage(history: Map<string, MoomooCapitalDistribution[]>) {
  const coverage: Record<string, number> = {};

  history.forEach((rows) => {
    rows.forEach((row) => {
      coverage[row.flowDate] = (coverage[row.flowDate] ?? 0) + 1;
    });
  });

  return coverage;
}

function applyOverlayToItem(candidate: StockCandidate, overlay?: EstimatedFlowOverlay) {
  if (!overlay) return candidate;
  const fallbackProvider =
    candidate.providerUsed ??
    candidate.flowWindowProviderUsed ??
    candidate.capitalFlowDataSource ??
    candidate.estimatedFlowProxySource ??
    "UNKNOWN";
  const fallbackSource =
    String(fallbackProvider).includes("ARCHIVE") || candidate.archiveStatus === "ARCHIVE_HIT"
      ? "Archive Proxy"
      : candidate.flowDataTier === "ENHANCED_OHLCV_PROXY" ||
          candidate.flowDataTierLabel === "Enhanced OHLCV Proxy" ||
          candidate.proxyMethod === ESTIMATED_FLOW_PROXY_METHOD
        ? "Enhanced OHLCV Proxy"
        : fallbackProvider === "UNKNOWN"
          ? "Unavailable"
          : String(fallbackProvider);
  const hasMoomooDirectFlow =
    overlay.flowDataTier === MOOMOO_FLOW_TIER && isFiniteNumber(overlay.directNetFlow);
  const useProxyOverlay = overlay.estimatedFlowProxyAvailable && !hasMoomooDirectFlow;
  const flow1DSource = hasMoomooDirectFlow
    ? "Moomoo Direct Flow"
    : useProxyOverlay
      ? overlay.flow1DSource
      : fallbackSource;
  const optionalFlow = (
    overlayValue: number | null,
    candidateValue: number | null | undefined,
  ) => (useProxyOverlay && isFiniteNumber(overlayValue) ? overlayValue : candidateValue);
  const requiredFlow = (overlayValue: number | null, candidateValue: number) =>
    useProxyOverlay && isFiniteNumber(overlayValue) ? overlayValue : candidateValue;

  return {
    ...candidate,
    capitalFlow1D: hasMoomooDirectFlow
      ? overlay.directNetFlow
      : optionalFlow(overlay.capitalFlow1D, candidate.capitalFlow1D),
    capitalFlow3D: requiredFlow(overlay.capitalFlow3D, candidate.capitalFlow3D),
    capitalFlow5D: requiredFlow(overlay.capitalFlow5D, candidate.capitalFlow5D),
    capitalFlow10D: optionalFlow(overlay.capitalFlow10D, candidate.capitalFlow10D),
    capitalFlow20D: optionalFlow(overlay.capitalFlow20D, candidate.capitalFlow20D),
    capitalFlow5W: requiredFlow(overlay.capitalFlow5W, candidate.capitalFlow5W),
    capitalFlow6W: optionalFlow(overlay.capitalFlow6W, candidate.capitalFlow6W),
    capitalFlow9W: optionalFlow(overlay.capitalFlow9W, candidate.capitalFlow9W),
    capitalFlow12W: optionalFlow(overlay.capitalFlow12W, candidate.capitalFlow12W),
    flowDataTier: hasMoomooDirectFlow
      ? MOOMOO_FLOW_TIER
      : useProxyOverlay
        ? ("ENHANCED_OHLCV_PROXY" as const)
        : candidate.flowDataTier,
    flowDataTierLabel: hasMoomooDirectFlow
      ? MOOMOO_FLOW_TIER_LABEL
      : useProxyOverlay
        ? "Enhanced OHLCV Proxy"
        : candidate.flowDataTierLabel,
    flowDataQualityScore: hasMoomooDirectFlow
      ? MOOMOO_FLOW_QUALITY_SCORE
      : useProxyOverlay
        ? 45
        : candidate.flowDataQualityScore,
    flowDataConfidence:
      hasMoomooDirectFlow
        ? "High"
        : useProxyOverlay
          ? ("Medium" as const)
          : candidate.flowDataConfidence,
    realFlowAvailable: hasMoomooDirectFlow ? true : candidate.realFlowAvailable ?? false,
    realBuyAmount: hasMoomooDirectFlow
      ? overlay.directBuyAmount ?? null
      : candidate.realBuyAmount ?? null,
    realSellAmount: hasMoomooDirectFlow
      ? overlay.directSellAmount ?? null
      : candidate.realSellAmount ?? null,
    realNetFlow: hasMoomooDirectFlow
      ? overlay.directNetFlow ?? null
      : candidate.realNetFlow ?? null,
    moomooFlowAvailable: hasMoomooDirectFlow,
    moomooBuyAmount: hasMoomooDirectFlow ? overlay.directBuyAmount ?? null : null,
    moomooSellAmount: hasMoomooDirectFlow ? overlay.directSellAmount ?? null : null,
    moomooNetFlow: hasMoomooDirectFlow ? overlay.directNetFlow ?? null : null,
    moomooFlowDate: overlay.moomooFlow?.flowDate ?? null,
    moomooFlowSource: overlay.estimatedFlowProxySource,
    moomooFlowArchiveHit: overlay.moomooFlow?.source === "ARCHIVE",
    moomooFlowStatus: hasMoomooDirectFlow ? "AVAILABLE" : "FALLBACK_PROXY",
    flow1DSource,
    oneDayFlowSource: flow1DSource,
    fallbackProviderUsed: hasMoomooDirectFlow ? null : String(fallbackProvider),
    enhancedProxyAvailable: hasMoomooDirectFlow
      ? candidate.enhancedProxyAvailable ?? true
      : useProxyOverlay
        ? true
        : candidate.enhancedProxyAvailable,
    enhancedProxyAlgorithmVersion:
      hasMoomooDirectFlow
        ? MOOMOO_FLOW_VERSION
        : useProxyOverlay
          ? ESTIMATED_FLOW_PROXY_VERSION
          : candidate.enhancedProxyAlgorithmVersion,
    enhancedProxyFlow1D_V188: useProxyOverlay
      ? overlay.enhancedProxyFlow1D_V188
      : candidate.enhancedProxyFlow1D_V188,
    enhancedProxyDirection_V188: useProxyOverlay
      ? overlay.enhancedProxyDirection_V188
      : candidate.enhancedProxyDirection_V188,
    proxyMethod: hasMoomooDirectFlow
      ? MOOMOO_PROVIDER
      : useProxyOverlay
        ? ESTIMATED_FLOW_PROXY_METHOD
        : candidate.proxyMethod,
    estimatedFlowProxyAvailable: useProxyOverlay || candidate.estimatedFlowProxyAvailable,
    estimatedFlowProxyStatus: useProxyOverlay
      ? overlay.estimatedFlowProxyStatus
      : candidate.estimatedFlowProxyStatus ?? overlay.estimatedFlowProxyStatus,
    estimatedFlowProxyUnavailableReason: useProxyOverlay
      ? overlay.estimatedFlowProxyUnavailableReason
      : candidate.estimatedFlowProxyUnavailableReason ??
        overlay.estimatedFlowProxyUnavailableReason,
    estimatedFlowProxyRowsUsed: useProxyOverlay
      ? overlay.estimatedFlowProxyRowsUsed
      : candidate.estimatedFlowProxyRowsUsed,
    estimatedFlowProxySource: useProxyOverlay
      ? overlay.estimatedFlowProxySource
      : candidate.estimatedFlowProxySource,
    estimatedFlowProxyUpdatedAt: useProxyOverlay
      ? overlay.estimatedFlowProxyUpdatedAt
      : candidate.estimatedFlowProxyUpdatedAt,
    providerUsed: hasMoomooDirectFlow ? overlay.providerUsed : candidate.providerUsed,
    capitalFlowDataSource:
      hasMoomooDirectFlow
        ? MOOMOO_PROVIDER
        : candidate.capitalFlowDataSource,
    capitalFlowQuality:
      hasMoomooDirectFlow
        ? ("REAL_PROVIDER" as const)
        : candidate.capitalFlowQuality,
    currentProductionFlowSource:
      hasMoomooDirectFlow
        ? MOOMOO_PROVIDER
        : candidate.currentProductionFlowSource,
    currentProductionFlowSourceClass:
      hasMoomooDirectFlow
        ? "DIRECT_CAPITAL_DISTRIBUTION"
        : candidate.currentProductionFlowSourceClass,
    recommendedFlowUpgradeSource:
      hasMoomooDirectFlow
        ? "Accumulate Moomoo Direct Capital Flow archive; evaluate Databento/Nasdaq/IEX for institutional-grade confirmation."
        : candidate.recommendedFlowUpgradeSource,
    recommendedFlowUpgradeReason:
      hasMoomooDirectFlow
        ? "Moomoo get_capital_distribution exposes direct capital-in and capital-out fields for scoped tickers without using trading APIs."
        : candidate.recommendedFlowUpgradeReason,
    productionFlowChanged: false,
  };
}

export async function applyEstimatedFlowProxyDisplayToSnapshot(
  snapshot: SnapshotResponse,
): Promise<SnapshotResponse> {
  const fixedSnapshot = snapshot.fixedSnapshot ?? null;
  const tickers = scopedTickerSet(snapshot, fixedSnapshot);
  const { overlayMap, moomooSummary, moomooErrors, moomooHistory } =
    await buildOverlayMap(tickers);
  const apply = (item: StockCandidate) =>
    applyOverlayToItem(item, overlayMap.get(item.ticker.toUpperCase()));
  const moomooArchiveTickerCount = moomooHistory.size;
  const moomooArchiveDateCoverage = buildMoomooDateCoverage(moomooHistory);

  return {
    ...snapshot,
    items: snapshot.items.map(apply),
    fixedSnapshot: fixedSnapshot
      ? {
          ...fixedSnapshot,
          items: fixedSnapshot.items.map(apply),
        }
      : undefined,
    estimatedFlowProxyDisplaySummary: {
      version: ESTIMATED_FLOW_PROXY_VERSION,
      proxyMethod: ESTIMATED_FLOW_PROXY_METHOD,
      scopedTickerCount: tickers.length,
      maxScopedTickers: MAX_ESTIMATED_FLOW_TICKERS,
      availableCount: Array.from(overlayMap.values()).filter(
        (overlay) => overlay.estimatedFlowProxyAvailable,
      ).length,
      insufficientCount: Array.from(overlayMap.values()).filter(
        (overlay) => !overlay.estimatedFlowProxyAvailable,
      ).length,
      liveProviderCallCount: 0,
      moomooCapitalDistributionAvailable: true,
      moomooProvider: MOOMOO_PROVIDER,
      moomooFlowTier: MOOMOO_FLOW_TIER,
      moomooFlowTierLabel: MOOMOO_FLOW_TIER_LABEL,
      moomooQuotaGuard: moomooSummary,
      moomooArchiveTickerCount,
      moomooArchiveDateCoverage,
      moomooDirectFlowAvailableCount: moomooArchiveTickerCount,
      moomooFallbackCount: Math.max(tickers.length - moomooArchiveTickerCount, 0),
      maxSymbolsPerRun: moomooSummary.maxSymbolsPerRun,
      moomooErrors,
      productionFlowChanged: false,
    },
  };
}
