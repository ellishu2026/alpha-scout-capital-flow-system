import "server-only";

import type { DailyFlowDetail } from "@/lib/capitalFlow";
import { getLatestSnapshot } from "@/lib/snapshotStore";
import type { SnapshotResponse, StockCandidate } from "@/types/stock";

const MAX_FLOW_CALIBRATION_TICKERS = 26;
const TOP_RANKED_LIMIT = 11;
const ALGORITHM_VERSION = "V1.8.8_ENHANCED_FLOW_PROXY";

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

function latestDailyFlow(candidate: CalibrationCandidate) {
  return getRecentDailyFlow(candidate).at(-1) ?? null;
}

function previousDailyFlow(candidate: CalibrationCandidate) {
  return getRecentDailyFlow(candidate).at(-2) ?? null;
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
        ? latestDollarVolume * (clippedDailyReturn / 0.08)
        : null,
    mfiLikeComponent:
      isFiniteNumber(latestDollarVolume) && isFiniteNumber(clippedTypicalMove)
        ? Math.sign(clippedTypicalMove) *
          latestDollarVolume *
          clamp(Math.abs(clippedTypicalMove) / 0.04, 0, 1)
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
        ? latestDollarVolume * (gapAdjustedReturn / 0.08)
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
  const meaningfulMagnitude =
    isFiniteNumber(enhancedProxyFlow1D_V188) &&
    isFiniteNumber(componentClipMagnitude) &&
    Math.abs(enhancedProxyFlow1D_V188) >= componentClipMagnitude * 0.05;
  const flowConfidence: Confidence =
    isFiniteNumber(componentAgreementPct) &&
    componentAgreementPct >= 70 &&
    meaningfulMagnitude &&
    availableComponents.length >= 4
      ? "High"
      : isFiniteNumber(componentAgreementPct) &&
          componentAgreementPct >= 55 &&
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

function buildCalibrationRow(
  candidate: CalibrationCandidate,
  topRankedTickers: Set<string>,
  fixedWatchlistTickers: Set<string>,
) {
  const ticker = candidate.ticker.toUpperCase();
  const latest = latestDailyFlow(candidate);
  const legacyProxyFlow1D = getLegacyProxyFlow1D(candidate, latest);
  const enhancedProxyFlow1D_V187 = calculateV187EnhancedProxy(candidate);
  const enhanced = calculateV188EnhancedProxy(candidate);
  const enhancedProxyFlow1D_V188 = enhanced.enhancedProxyFlow1D_V188;
  const legacyProxyDirection = direction(legacyProxyFlow1D);
  const enhancedProxyDirection_V187 = direction(enhancedProxyFlow1D_V187);
  const enhancedProxyDirection_V188 = direction(enhancedProxyFlow1D_V188);

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
    avgDollarVolume20D: candidate.avgDollarVolume20D ?? null,
    marketCap: candidate.marketCap ?? null,
    latestDollarVolume: enhanced.latestDollarVolume,
    latestFlowDate: enhanced.latest?.date ?? null,
    calibrationStatus: "RESEARCH_ONLY_NOT_PRODUCTION",
  };
}

function average(values: Array<number | null>) {
  const finiteValues = values.filter(isFiniteNumber);
  if (finiteValues.length === 0) return null;

  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function summarizeRows(rows: ReturnType<typeof buildCalibrationRow>[]) {
  return {
    rowCount: rows.length,
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
  const rows = flowCalibrationTickerSet
    .map((ticker) => candidateByTicker.get(ticker))
    .filter((candidate): candidate is CalibrationCandidate => candidate != null)
    .map((candidate) =>
      buildCalibrationRow(candidate, topRankedTickers, fixedWatchlistTickers),
    );

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
        "V1.8.8 reads latest persisted snapshots only and does not compute enhanced calibration for the full universe.",
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
