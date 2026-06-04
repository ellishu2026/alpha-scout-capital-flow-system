import "server-only";

import type { DailyFlowDetail, OhlcvCandle } from "@/lib/capitalFlow";
import { getArchivedMarketDataForTicker } from "@/lib/marketDataProviders";
import { getLatestSnapshot } from "@/lib/snapshotStore";
import type { SnapshotResponse, StockCandidate } from "@/types/stock";

const MAX_FLOW_CALIBRATION_TICKERS = 26;
const TOP_RANKED_LIMIT = 11;
const ALGORITHM_VERSION = "V1.8.8.1_ENHANCED_FLOW_PROXY_OHLCV_SOURCE_FIX";

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

const COMPONENT_WEIGHTS = {
  chaikinComponent: 0.25,
  priceChangeWeightedComponent: 0.25,
  mfiLikeComponent: 0.2,
  obvDirectionalComponent: 0.1,
  closeLocationComponent: 0.15,
  gapAdjustedComponent: 0.05,
} as const;

type Direction = "Positive" | "Negative" | "Neutral" | "Unknown";
type Confidence = "High" | "Medium" | "Low";

type CalibrationCandidate = StockCandidate & {
  recentDailyFlow?: DailyFlowDetail[];
  rawItem?: Partial<StockCandidate> & { recentDailyFlow?: DailyFlowDetail[] };
  raw_item?: Partial<StockCandidate> & { recentDailyFlow?: DailyFlowDetail[] };
};

type ComponentValue = {
  raw: number | null;
  clipped: number | null;
  direction: Direction;
  wasClipped: boolean;
};

type EnhancedFlowComponents = {
  chaikinComponent: ComponentValue;
  priceChangeWeightedComponent: ComponentValue;
  mfiLikeComponent: ComponentValue;
  obvDirectionalComponent: ComponentValue;
  closeLocationComponent: ComponentValue;
  gapAdjustedComponent: ComponentValue;
};

type BuildEnhancedFlowCalibrationOptions = {
  limit?: number;
};

type OhlcvInput = {
  rows: DailyFlowDetail[];
  source: string | null;
  archiveHit: boolean;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function round(value: number | null, digits = 2) {
  if (!isFiniteNumber(value)) return null;

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeRatio(value: number | null | undefined, denominator: number | null | undefined) {
  if (!isFiniteNumber(value) || !isFiniteNumber(denominator) || denominator === 0) {
    return null;
  }

  return value / denominator;
}

function getRecentDailyFlow(candidate: CalibrationCandidate) {
  return (
    candidate.recentDailyFlow ??
    candidate.rawItem?.recentDailyFlow ??
    candidate.raw_item?.recentDailyFlow ??
    []
  );
}

function toDailyFlowDetails(candles: OhlcvCandle[]) {
  return candles
    .filter(
      (candle) =>
        candle.date instanceof Date &&
        Number.isFinite(candle.date.getTime()) &&
        isFiniteNumber(candle.open) &&
        isFiniteNumber(candle.high) &&
        isFiniteNumber(candle.low) &&
        isFiniteNumber(candle.close) &&
        isFiniteNumber(candle.volume),
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map<DailyFlowDetail>((candle, index, rows) => {
      const previous = rows[index - 1] ?? null;
      const previousClose = previous?.close ?? null;
      const dollarVolumeValue = candle.close! * candle.volume!;
      const range = candle.high! - candle.low!;
      const closeLocation = range === 0
        ? 0
        : clamp(((candle.close! - candle.low!) / range - 0.5) * 2, -1, 1);
      const dailyReturn =
        isFiniteNumber(previousClose) && previousClose !== 0
          ? (candle.close! - previousClose) / previousClose
          : 0;
      const typical = (candle.high! + candle.low! + candle.close!) / 3;
      const previousTypical =
        previous &&
        isFiniteNumber(previous.high) &&
        isFiniteNumber(previous.low) &&
        isFiniteNumber(previous.close)
          ? (previous.high + previous.low + previous.close) / 3
          : null;
      const typicalMove =
        isFiniteNumber(previousTypical) && previousTypical !== 0
          ? (typical - previousTypical) / previousTypical
          : 0;

      return {
        date: candle.date.toISOString().slice(0, 10),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        moneyFlowMultiplier: closeLocation,
        dailyFlowDollar: dollarVolumeValue * closeLocation,
        chaikinDailyFlowDollar: dollarVolumeValue * closeLocation,
        priceChangeWeightedFlow: dollarVolumeValue * clamp(dailyReturn, -0.08, 0.08),
        mfiLikeFlow:
          Math.sign(typicalMove) * dollarVolumeValue * Math.abs(clamp(typicalMove, -0.08, 0.08)),
        obvDirectionalFlow: Math.sign(dailyReturn) * dollarVolumeValue * 0.15,
      };
    });
}

async function resolveOhlcvInput(candidate: CalibrationCandidate): Promise<OhlcvInput> {
  const snapshotRows = getRecentDailyFlow(candidate).filter(
    (row) =>
      isFiniteNumber(row.open) &&
      isFiniteNumber(row.high) &&
      isFiniteNumber(row.low) &&
      isFiniteNumber(row.close) &&
      isFiniteNumber(row.volume),
  );

  if (snapshotRows.length >= 2) {
    return {
      rows: snapshotRows,
      source: "SNAPSHOT_RECENT_DAILY_FLOW",
      archiveHit: false,
    };
  }

  const archived = await getArchivedMarketDataForTicker(candidate.ticker.toUpperCase());

  if (archived?.candles.length) {
    return {
      rows: toDailyFlowDetails(archived.candles),
      source: `${archived.provider}_ARCHIVE`,
      archiveHit: true,
    };
  }

  return {
    rows: snapshotRows,
    source: snapshotRows.length > 0 ? "SNAPSHOT_RECENT_DAILY_FLOW_PARTIAL" : null,
    archiveHit: false,
  };
}

function latestDailyFlow(candidate: CalibrationCandidate) {
  return getRecentDailyFlow(candidate).at(-1) ?? null;
}

function previousDailyFlow(candidate: CalibrationCandidate) {
  return getRecentDailyFlow(candidate).at(-2) ?? null;
}

function averageDollarVolume(rows: DailyFlowDetail[]) {
  const values = rows
    .slice(-20)
    .map((row) => dollarVolume(row))
    .filter(isFiniteNumber);

  if (values.length === 0) return null;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function missingOhlcvFields(rows: DailyFlowDetail[]) {
  const latest = rows.at(-1) ?? null;
  const previous = rows.at(-2) ?? null;
  const missing: string[] = [];

  if (!latest) {
    return [
      "latestOpen",
      "latestHigh",
      "latestLow",
      "latestClose",
      "latestVolume",
      "previousClose",
      "previousTypicalPrice",
    ];
  }

  if (!isFiniteNumber(latest.open)) missing.push("latestOpen");
  if (!isFiniteNumber(latest.high)) missing.push("latestHigh");
  if (!isFiniteNumber(latest.low)) missing.push("latestLow");
  if (!isFiniteNumber(latest.close)) missing.push("latestClose");
  if (!isFiniteNumber(latest.volume)) missing.push("latestVolume");
  if (!isFiniteNumber(previous?.close)) missing.push("previousClose");

  const previousTypical = typicalPrice(previous);
  if (!isFiniteNumber(previousTypical)) missing.push("previousTypicalPrice");

  return missing;
}

function dollarVolume(row: DailyFlowDetail | null) {
  if (!row || !isFiniteNumber(row.close) || !isFiniteNumber(row.volume)) {
    return null;
  }

  return row.close * row.volume;
}

function direction(value: number | null | undefined): Direction {
  if (!isFiniteNumber(value)) return "Unknown";
  if (value > 0) return "Positive";
  if (value < 0) return "Negative";
  return "Neutral";
}

function meaningfulDirection(value: number | null, neutralThreshold: number) {
  if (!isFiniteNumber(value)) return "Unknown";
  if (Math.abs(value) <= neutralThreshold) return "Neutral";

  return direction(value);
}

function typicalPrice(row: DailyFlowDetail | null) {
  if (
    !row ||
    !isFiniteNumber(row.high) ||
    !isFiniteNumber(row.low) ||
    !isFiniteNumber(row.close)
  ) {
    return null;
  }

  return (row.high + row.low + row.close) / 3;
}

function closeLocationValue(row: DailyFlowDetail | null) {
  if (
    !row ||
    !isFiniteNumber(row.high) ||
    !isFiniteNumber(row.low) ||
    !isFiniteNumber(row.close)
  ) {
    return null;
  }

  const range = row.high - row.low;
  if (range === 0) return 0;

  return clamp(((row.close - row.low) / range - 0.5) * 2, -1, 1);
}

function clipComponent(raw: number | null, maxAllowedMagnitude: number | null): ComponentValue {
  if (!isFiniteNumber(raw)) {
    return {
      raw: null,
      clipped: null,
      direction: "Unknown",
      wasClipped: false,
    };
  }

  if (!isFiniteNumber(maxAllowedMagnitude) || maxAllowedMagnitude <= 0) {
    return {
      raw,
      clipped: raw,
      direction: direction(raw),
      wasClipped: false,
    };
  }

  const clipped = clamp(raw, -maxAllowedMagnitude, maxAllowedMagnitude);

  return {
    raw,
    clipped,
    direction: direction(clipped),
    wasClipped: clipped !== raw,
  };
}

function getLegacyProxyFlow1D(candidate: CalibrationCandidate, latest: DailyFlowDetail | null) {
  return (
    candidate.capitalFlow1D ??
    candidate.chaikinDailyFlowLatest ??
    candidate.compositeDailyFlowLatest ??
    latest?.dailyFlowDollar ??
    latest?.chaikinDailyFlowDollar ??
    null
  );
}

function calculateV187EnhancedProxy(candidate: CalibrationCandidate) {
  const latest = latestDailyFlow(candidate);
  const latestDollarVolume = dollarVolume(latest);
  const maxComponent = latestDollarVolume;
  const closeLocationDollarFlow =
    isFiniteNumber(latestDollarVolume) && isFiniteNumber(closeLocationValue(latest))
      ? latestDollarVolume * closeLocationValue(latest)!
      : null;

  const chaikin = clipComponent(
    latest?.chaikinDailyFlowDollar ?? latest?.dailyFlowDollar ?? candidate.chaikinDailyFlowLatest ?? null,
    maxComponent,
  ).clipped;
  const priceChange = clipComponent(
    latest?.priceChangeWeightedFlow ?? candidate.priceChangeWeightedFlowLatest ?? null,
    maxComponent,
  ).clipped;
  const mfiLike = clipComponent(latest?.mfiLikeFlow ?? candidate.mfiLikeFlowLatest ?? null, maxComponent).clipped;
  const obv = clipComponent(
    latest?.obvDirectionalFlow ?? candidate.obvDirectionalFlowLatest ?? null,
    maxComponent,
  ).clipped;
  const closeLocation = clipComponent(closeLocationDollarFlow, maxComponent).clipped;
  const values = [chaikin, priceChange, mfiLike, obv, closeLocation].filter(isFiniteNumber);

  if (values.length === 0) return null;

  return (
    (chaikin ?? 0) * 0.35 +
    (priceChange ?? 0) * 0.25 +
    (mfiLike ?? 0) * 0.2 +
    (obv ?? 0) * 0.1 +
    (closeLocation ?? 0) * 0.1
  );
}

function calculateV188EnhancedProxy(candidate: CalibrationCandidate) {
  const latest = latestDailyFlow(candidate);
  const previous = previousDailyFlow(candidate);
  const latestDollarVolume = dollarVolume(latest);
  const avgDollarVolume20D = candidate.avgDollarVolume20D ?? null;
  const componentClipMagnitude =
    isFiniteNumber(avgDollarVolume20D) && avgDollarVolume20D > 0
      ? avgDollarVolume20D
      : latestDollarVolume;
  const finalClipMagnitude =
    isFiniteNumber(componentClipMagnitude) && componentClipMagnitude > 0
      ? componentClipMagnitude * 1.5
      : null;

  if (!latest || !isFiniteNumber(latest.close) || !isFiniteNumber(latest.volume)) {
    return {
      latest,
      previous,
      latestDollarVolume,
      enhancedProxyFlow1D_V188: null,
      components: emptyComponents(),
      componentAgreementPct: null,
      positiveComponentCount: 0,
      negativeComponentCount: 0,
      neutralComponentCount: 0,
      directionConflictFlag: false,
      flowConfidence: "Low" as Confidence,
      wasClipped: false,
      clippingReason: "Latest close or volume is missing; V1.8.8 proxy unavailable.",
      maxAllowedMagnitude: finalClipMagnitude,
    };
  }

  const previousClose = previous?.close;
  const dailyReturn =
    isFiniteNumber(previousClose) && previousClose !== 0
      ? (latest.close - previousClose) / previousClose
      : null;
  const clippedDailyReturn = isFiniteNumber(dailyReturn)
    ? clamp(dailyReturn, -0.08, 0.08)
    : null;
  const latestTypicalPrice = typicalPrice(latest);
  const previousTypicalPrice = typicalPrice(previous);
  const typicalMove =
    isFiniteNumber(latestTypicalPrice) &&
    isFiniteNumber(previousTypicalPrice) &&
    previousTypicalPrice !== 0
      ? (latestTypicalPrice - previousTypicalPrice) / previousTypicalPrice
      : null;
  const clippedTypicalMove = isFiniteNumber(typicalMove)
    ? clamp(typicalMove, -0.08, 0.08)
    : null;
  const closeLocation = closeLocationValue(latest);
  const gapReturn =
    isFiniteNumber(latest.open) &&
    isFiniteNumber(previousClose) &&
    previousClose !== 0
      ? (latest.open - previousClose) / previousClose
      : null;
  const intradayReturn =
    isFiniteNumber(latest.open) && latest.open !== 0
      ? (latest.close - latest.open) / latest.open
      : null;
  const gapAdjustedReturn =
    isFiniteNumber(gapReturn) && isFiniteNumber(intradayReturn)
      ? clamp(intradayReturn - gapReturn * 0.5, -0.08, 0.08)
      : null;

  const rawComponents = {
    chaikinComponent:
      latest.chaikinDailyFlowDollar ?? latest.dailyFlowDollar ?? candidate.chaikinDailyFlowLatest ?? null,
    priceChangeWeightedComponent:
      isFiniteNumber(latestDollarVolume) && isFiniteNumber(clippedDailyReturn)
        ? latestDollarVolume * clippedDailyReturn
        : null,
    mfiLikeComponent:
      isFiniteNumber(latestDollarVolume) && isFiniteNumber(clippedTypicalMove)
        ? Math.sign(clippedTypicalMove) * latestDollarVolume * Math.abs(clippedTypicalMove)
        : null,
    obvDirectionalComponent:
      isFiniteNumber(latestDollarVolume) && isFiniteNumber(dailyReturn)
        ? Math.sign(dailyReturn) * latestDollarVolume * 0.15
        : null,
    closeLocationComponent:
      isFiniteNumber(latestDollarVolume) && isFiniteNumber(closeLocation)
        ? latestDollarVolume * closeLocation
        : null,
    gapAdjustedComponent:
      isFiniteNumber(latestDollarVolume) && isFiniteNumber(gapAdjustedReturn)
        ? latestDollarVolume * gapAdjustedReturn
        : null,
  };

  const components: EnhancedFlowComponents = {
    chaikinComponent: clipComponent(rawComponents.chaikinComponent, componentClipMagnitude),
    priceChangeWeightedComponent: clipComponent(
      rawComponents.priceChangeWeightedComponent,
      componentClipMagnitude,
    ),
    mfiLikeComponent: clipComponent(rawComponents.mfiLikeComponent, componentClipMagnitude),
    obvDirectionalComponent: clipComponent(
      rawComponents.obvDirectionalComponent,
      componentClipMagnitude,
    ),
    closeLocationComponent: clipComponent(rawComponents.closeLocationComponent, componentClipMagnitude),
    gapAdjustedComponent: clipComponent(rawComponents.gapAdjustedComponent, componentClipMagnitude),
  };
  const availableComponents = Object.values(components).filter((component) =>
    isFiniteNumber(component.clipped),
  );
  const weightedSum =
    availableComponents.length > 0
      ? (components.chaikinComponent.clipped ?? 0) * COMPONENT_WEIGHTS.chaikinComponent +
        (components.priceChangeWeightedComponent.clipped ?? 0) *
          COMPONENT_WEIGHTS.priceChangeWeightedComponent +
        (components.mfiLikeComponent.clipped ?? 0) * COMPONENT_WEIGHTS.mfiLikeComponent +
        (components.obvDirectionalComponent.clipped ?? 0) *
          COMPONENT_WEIGHTS.obvDirectionalComponent +
        (components.closeLocationComponent.clipped ?? 0) *
          COMPONENT_WEIGHTS.closeLocationComponent +
        (components.gapAdjustedComponent.clipped ?? 0) * COMPONENT_WEIGHTS.gapAdjustedComponent
      : null;
  const enhancedProxyFlow1D_V188 =
    isFiniteNumber(weightedSum) && isFiniteNumber(finalClipMagnitude)
      ? clamp(weightedSum, -finalClipMagnitude, finalClipMagnitude)
      : weightedSum;
  const finalWasClipped =
    isFiniteNumber(weightedSum) &&
    isFiniteNumber(enhancedProxyFlow1D_V188) &&
    weightedSum !== enhancedProxyFlow1D_V188;
  const componentWasClipped = Object.values(components).some((component) => component.wasClipped);
  const neutralThreshold =
    isFiniteNumber(componentClipMagnitude) && componentClipMagnitude > 0
      ? componentClipMagnitude * 0.01
      : 0;
  const componentDirections = availableComponents.map((component) =>
    meaningfulDirection(component.clipped, neutralThreshold),
  );
  const positiveComponentCount = componentDirections.filter((value) => value === "Positive").length;
  const negativeComponentCount = componentDirections.filter((value) => value === "Negative").length;
  const neutralComponentCount = componentDirections.filter((value) => value === "Neutral").length;
  const dominantCount = Math.max(positiveComponentCount, negativeComponentCount, neutralComponentCount);
  const componentAgreementPct =
    componentDirections.length > 0
      ? round((dominantCount / componentDirections.length) * 100, 2)
      : null;
  const directionConflictFlag = positiveComponentCount > 0 && negativeComponentCount > 0;
  const flowConfidence: Confidence =
    isFiniteNumber(componentAgreementPct) &&
    componentAgreementPct >= 80 &&
    availableComponents.length >= 4
      ? "High"
      : isFiniteNumber(componentAgreementPct) &&
          componentAgreementPct >= 60 &&
          availableComponents.length >= 3
        ? "Medium"
        : "Low";

  return {
    latest,
    previous,
    latestDollarVolume,
    enhancedProxyFlow1D_V188,
    components,
    componentAgreementPct,
    positiveComponentCount,
    negativeComponentCount,
    neutralComponentCount,
    directionConflictFlag,
    flowConfidence,
    wasClipped: componentWasClipped || finalWasClipped,
    clippingReason:
      componentWasClipped || finalWasClipped
        ? "One or more components or the final weighted sum exceeded configured magnitude caps."
        : null,
    maxAllowedMagnitude: finalClipMagnitude,
  };
}

function emptyComponent(): ComponentValue {
  return {
    raw: null,
    clipped: null,
    direction: "Unknown",
    wasClipped: false,
  };
}

function emptyComponents(): EnhancedFlowComponents {
  return {
    chaikinComponent: emptyComponent(),
    priceChangeWeightedComponent: emptyComponent(),
    mfiLikeComponent: emptyComponent(),
    obvDirectionalComponent: emptyComponent(),
    closeLocationComponent: emptyComponent(),
    gapAdjustedComponent: emptyComponent(),
  };
}

function dedupeCandidates(...snapshots: Array<SnapshotResponse | null>) {
  const byTicker = new Map<string, CalibrationCandidate>();

  snapshots.forEach((snapshot) => {
    snapshot?.items.forEach((item) => {
      const ticker = item.ticker.toUpperCase();
      if (!byTicker.has(ticker)) {
        byTicker.set(ticker, item as CalibrationCandidate);
      }
    });
  });

  return byTicker;
}

async function buildCalibrationRow(
  candidate: CalibrationCandidate,
  topRankedTickers: Set<string>,
  fixedWatchlistTickers: Set<string>,
) {
  const ticker = candidate.ticker.toUpperCase();
  const ohlcvInput = await resolveOhlcvInput(candidate);
  const resolvedAvgDollarVolume20D =
    candidate.avgDollarVolume20D ?? averageDollarVolume(ohlcvInput.rows);
  const candidateWithOhlcv = {
    ...candidate,
    avgDollarVolume20D: resolvedAvgDollarVolume20D,
    recentDailyFlow: ohlcvInput.rows,
  };
  const latest = latestDailyFlow(candidateWithOhlcv);
  const previous = previousDailyFlow(candidateWithOhlcv);
  const ohlcvMissingFields = missingOhlcvFields(ohlcvInput.rows);
  const ohlcvInputAvailable = ohlcvMissingFields.length === 0;
  const legacyProxyFlow1D = getLegacyProxyFlow1D(candidateWithOhlcv, latest);
  const enhancedProxyFlow1D_V187 = calculateV187EnhancedProxy(candidateWithOhlcv);
  const enhanced = calculateV188EnhancedProxy(candidateWithOhlcv);
  const enhancedProxyFlow1D_V188 = enhanced.enhancedProxyFlow1D_V188;
  const legacyProxyDirection = direction(legacyProxyFlow1D);
  const enhancedProxyDirection_V187 = direction(enhancedProxyFlow1D_V187);
  const enhancedProxyDirection_V188 = direction(enhancedProxyFlow1D_V188);
  const previousTypicalPrice = typicalPrice(previous);

  return {
    ticker,
    companyName: candidate.companyName ?? null,
    inTopRanked: topRankedTickers.has(ticker),
    inFixedWatchlist: fixedWatchlistTickers.has(ticker),
    legacyProxyFlow1D,
    enhancedProxyFlow1D_V187,
    enhancedProxyFlow1D_V188,
    legacyProxyDirection,
    enhancedProxyDirection_V187,
    enhancedProxyDirection_V188,
    legacyToV188MagnitudeRatio: round(safeRatio(enhancedProxyFlow1D_V188, legacyProxyFlow1D), 6),
    v187ToV188MagnitudeRatio: round(safeRatio(enhancedProxyFlow1D_V188, enhancedProxyFlow1D_V187), 6),
    directionChangedVsLegacy:
      legacyProxyDirection !== "Unknown" &&
      enhancedProxyDirection_V188 !== "Unknown" &&
      legacyProxyDirection !== enhancedProxyDirection_V188,
    directionChangedVsV187:
      enhancedProxyDirection_V187 !== "Unknown" &&
      enhancedProxyDirection_V188 !== "Unknown" &&
      enhancedProxyDirection_V187 !== enhancedProxyDirection_V188,
    ohlcvInputAvailable,
    ohlcvSource: ohlcvInput.source,
    ohlcvRowsUsed: ohlcvInput.rows.length,
    ohlcvMissingFields,
    v188UnavailableReason:
      ohlcvInputAvailable && isFiniteNumber(enhancedProxyFlow1D_V188)
        ? null
        : "Missing raw OHLCV history required for component calculation.",
    latestOpen: latest?.open ?? null,
    latestHigh: latest?.high ?? null,
    latestLow: latest?.low ?? null,
    latestClose: latest?.close ?? null,
    latestVolume: latest?.volume ?? null,
    previousClose: previous?.close ?? null,
    previousTypicalPrice,
    components: {
      chaikinComponent: enhanced.components.chaikinComponent.clipped,
      priceChangeWeightedComponent: enhanced.components.priceChangeWeightedComponent.clipped,
      mfiLikeComponent: enhanced.components.mfiLikeComponent.clipped,
      obvDirectionalComponent: enhanced.components.obvDirectionalComponent.clipped,
      closeLocationComponent: enhanced.components.closeLocationComponent.clipped,
      gapAdjustedComponent: enhanced.components.gapAdjustedComponent.clipped,
      raw: {
        chaikinComponent: enhanced.components.chaikinComponent.raw,
        priceChangeWeightedComponent: enhanced.components.priceChangeWeightedComponent.raw,
        mfiLikeComponent: enhanced.components.mfiLikeComponent.raw,
        obvDirectionalComponent: enhanced.components.obvDirectionalComponent.raw,
        closeLocationComponent: enhanced.components.closeLocationComponent.raw,
        gapAdjustedComponent: enhanced.components.gapAdjustedComponent.raw,
      },
      wasClipped: {
        chaikinComponent: enhanced.components.chaikinComponent.wasClipped,
        priceChangeWeightedComponent: enhanced.components.priceChangeWeightedComponent.wasClipped,
        mfiLikeComponent: enhanced.components.mfiLikeComponent.wasClipped,
        obvDirectionalComponent: enhanced.components.obvDirectionalComponent.wasClipped,
        closeLocationComponent: enhanced.components.closeLocationComponent.wasClipped,
        gapAdjustedComponent: enhanced.components.gapAdjustedComponent.wasClipped,
      },
    },
    componentAgreementPct: enhanced.componentAgreementPct,
    positiveComponentCount: enhanced.positiveComponentCount,
    negativeComponentCount: enhanced.negativeComponentCount,
    neutralComponentCount: enhanced.neutralComponentCount,
    directionConflictFlag: enhanced.directionConflictFlag,
    flowConfidence: enhanced.flowConfidence,
    wasClipped: enhanced.wasClipped,
    clippingReason: enhanced.clippingReason,
    maxAllowedMagnitude: enhanced.maxAllowedMagnitude,
    avgDollarVolume20D: resolvedAvgDollarVolume20D,
    marketCap: candidate.marketCap ?? null,
    latestDollarVolume: enhanced.latestDollarVolume,
    latestFlowDate: enhanced.latest?.date ?? null,
    archiveHit: ohlcvInput.archiveHit,
    calibrationStatus: "RESEARCH_ONLY_NOT_PRODUCTION",
  };
}

function average(values: Array<number | null>) {
  const finiteValues = values.filter(isFiniteNumber);
  if (finiteValues.length === 0) return null;

  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

type CalibrationRow = Awaited<ReturnType<typeof buildCalibrationRow>>;

function summarizeRows(rows: CalibrationRow[]) {
  return {
    rowCount: rows.length,
    v188ComputedCount: rows.filter((row) => isFiniteNumber(row.enhancedProxyFlow1D_V188)).length,
    v188UnavailableCount: rows.filter((row) => !isFiniteNumber(row.enhancedProxyFlow1D_V188)).length,
    ohlcvAvailableCount: rows.filter((row) => row.ohlcvInputAvailable).length,
    ohlcvMissingCount: rows.filter((row) => !row.ohlcvInputAvailable).length,
    positiveCount: rows.filter((row) => row.enhancedProxyDirection_V188 === "Positive").length,
    negativeCount: rows.filter((row) => row.enhancedProxyDirection_V188 === "Negative").length,
    neutralCount: rows.filter((row) => row.enhancedProxyDirection_V188 === "Neutral").length,
    highConfidenceCount: rows.filter((row) => row.flowConfidence === "High").length,
    mediumConfidenceCount: rows.filter((row) => row.flowConfidence === "Medium").length,
    lowConfidenceCount: rows.filter((row) => row.flowConfidence === "Low").length,
    directionChangedVsLegacyCount: rows.filter((row) => row.directionChangedVsLegacy).length,
    avgLegacyToV188MagnitudeRatio: round(
      average(rows.map((row) => row.legacyToV188MagnitudeRatio)),
      6,
    ),
    productionFlowChanged: false,
  };
}

export async function buildEnhancedFlowCalibrationReport(
  options: BuildEnhancedFlowCalibrationOptions = {},
) {
  const requestedLimit = options.limit ?? MAX_FLOW_CALIBRATION_TICKERS;
  const limit = Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_FLOW_CALIBRATION_TICKERS);
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

  const flowCalibrationTickerSet = Array.from(orderedTickerSet).slice(0, limit);
  const rows = await Promise.all(
    flowCalibrationTickerSet
      .map((ticker) => candidateByTicker.get(ticker))
      .filter((candidate): candidate is CalibrationCandidate => candidate != null)
      .map((candidate) =>
        buildCalibrationRow(candidate, topRankedTickers, fixedWatchlistTickers),
      ),
  );
  const archiveHitCount = rows.filter((row) => row.archiveHit).length;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    flowCalibrationTickerSet,
    flowCalibrationTickerCount: flowCalibrationTickerSet.length,
    maxFlowCalibrationTickers: MAX_FLOW_CALIBRATION_TICKERS,
    productionFlowChanged: false,
    calibrationScope: {
      topRankedTickerCount: topRankedTickers.size,
      fixedWatchlistTickerCount: FIXED_WATCHLIST.length,
      uniqueTickerCount: flowCalibrationTickerSet.length,
      maxFlowCalibrationTickers: MAX_FLOW_CALIBRATION_TICKERS,
      fullUniverseCalibrationAllowed: false,
      liveProviderCallCount: 0,
      notes:
        "V1.8.8.1 reads latest persisted snapshots and existing archived OHLCV only; it does not compute enhanced calibration for the full universe.",
    },
    calibrationQuotaGuard: {
      enabled: true,
      maxFlowCalibrationTickers: MAX_FLOW_CALIBRATION_TICKERS,
      fullUniverseCalculationAllowed: false,
      liveProviderCallCount: 0,
      archiveHitCount,
      providerQuotaExhausted: false,
    },
    algorithmVersion: ALGORITHM_VERSION,
    componentWeights: COMPONENT_WEIGHTS,
    rows,
    summary: summarizeRows(rows),
    manualCalibrationReadiness: {
      supported: false,
      intendedUse:
        "Compare external real buy/sell/net flow samples against legacy and enhanced proxy.",
      requiredFields: [
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
      placeholderExamples: [
        {
          ticker: "AMD",
          note:
            "Placeholder only for future Webull/manual comparison; no external numbers are stored or used in production calculations.",
        },
      ],
    },
    recommendation:
      "Keep production flow unchanged. Use V1.8.8 rows to compare direction, magnitude, clipping, and confidence before any future proxy promotion review.",
    safetyWarnings: [
      "Research endpoint only: production flow, scoring, thresholds, and Entry / Position rules are unchanged.",
      "Full-universe enhanced proxy calibration is disabled; ticker scope is capped at Top 11 plus Fixed Watchlist, max 26 unique tickers.",
      "No live provider calls are made by this calibration endpoint.",
    ],
  };
}
