import "server-only";

import type { OhlcvCandle } from "@/lib/capitalFlow";
import { FIXED_WATCHLIST_SYMBOLS } from "@/lib/marketUniverse";
import { getArchivedMarketDataForTicker } from "@/lib/marketDataProviders";
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

  return new Map(entries);
}

function applyOverlayToItem(candidate: StockCandidate, overlay?: EstimatedFlowOverlay) {
  if (!overlay) return candidate;
  const requiredDisplayNumber = (value: number | null) =>
    isFiniteNumber(value) ? value : Number.NaN;

  return {
    ...candidate,
    capitalFlow1D: overlay.capitalFlow1D,
    capitalFlow3D: requiredDisplayNumber(overlay.capitalFlow3D),
    capitalFlow5D: requiredDisplayNumber(overlay.capitalFlow5D),
    capitalFlow10D: overlay.capitalFlow10D,
    capitalFlow20D: overlay.capitalFlow20D,
    capitalFlow5W: requiredDisplayNumber(overlay.capitalFlow5W),
    capitalFlow6W: overlay.capitalFlow6W,
    capitalFlow9W: overlay.capitalFlow9W,
    capitalFlow12W: overlay.capitalFlow12W,
    flowDataTier: "ENHANCED_OHLCV_PROXY" as const,
    flowDataTierLabel: "Enhanced OHLCV Proxy",
    flowDataQualityScore: 45,
    flowDataConfidence: overlay.estimatedFlowProxyAvailable ? ("Medium" as const) : ("Low" as const),
    realFlowAvailable: false,
    realBuyAmount: null,
    realSellAmount: null,
    realNetFlow: null,
    enhancedProxyAvailable: overlay.estimatedFlowProxyAvailable,
    enhancedProxyAlgorithmVersion: ESTIMATED_FLOW_PROXY_VERSION,
    enhancedProxyFlow1D_V188: overlay.enhancedProxyFlow1D_V188,
    enhancedProxyDirection_V188: overlay.enhancedProxyDirection_V188,
    proxyMethod: ESTIMATED_FLOW_PROXY_METHOD,
    estimatedFlowProxyAvailable: overlay.estimatedFlowProxyAvailable,
    estimatedFlowProxyStatus: overlay.estimatedFlowProxyStatus,
    estimatedFlowProxyUnavailableReason: overlay.estimatedFlowProxyUnavailableReason,
    estimatedFlowProxyRowsUsed: overlay.estimatedFlowProxyRowsUsed,
    estimatedFlowProxySource: overlay.estimatedFlowProxySource,
    estimatedFlowProxyUpdatedAt: overlay.estimatedFlowProxyUpdatedAt,
    productionFlowChanged: false,
  };
}

export async function applyEstimatedFlowProxyDisplayToSnapshot(
  snapshot: SnapshotResponse,
): Promise<SnapshotResponse> {
  const fixedSnapshot = snapshot.fixedSnapshot ?? null;
  const tickers = scopedTickerSet(snapshot, fixedSnapshot);
  const overlayMap = await buildOverlayMap(tickers);
  const apply = (item: StockCandidate) =>
    applyOverlayToItem(item, overlayMap.get(item.ticker.toUpperCase()));

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
      productionFlowChanged: false,
    },
  };
}
