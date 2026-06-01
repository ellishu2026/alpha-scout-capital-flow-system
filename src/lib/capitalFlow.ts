import type {
  CapitalFlowDataSource,
  CapitalFlowQuality,
  StockCandidate,
} from "@/types/stock";

export const FLOW_CALCULATION_VERSION = "V1.6.1_CHAIKIN" as const;
export const NORMALIZED_FLOW_CALCULATION_VERSION =
  "V1.6.2_NORMALIZED_CHAIKIN" as const;
export const REAL_PROVIDER_FLOW_CALCULATION_VERSION =
  "V1.6.8_PROVIDER_LADDER_CHAIKIN" as const;
export const YFINANCE_FLOW_CALCULATION_VERSION =
  "V1.6.5.1_YFINANCE_CHAIKIN" as const;
export const ARCHIVE_PROVIDER_FLOW_CALCULATION_VERSION =
  "V1.6.8_PROVIDER_LADDER_CHAIKIN" as const;
export const COMPOSITE_PROXY_FLOW_CALCULATION_VERSION =
  "V1.6.8_COMPOSITE_PROXY" as const;
export const COMPOSITE_FLOW_WEIGHTS = {
  chaikin: 0.45,
  priceChangeWeighted: 0.25,
  mfiLike: 0.2,
  obvDirectional: 0.1,
} as const;

export type OhlcvCandle = {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

export type DailyFlowDetail = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  moneyFlowMultiplier: number;
  dailyFlowDollar: number;
  chaikinDailyFlowDollar: number;
  priceChangeWeightedFlow: number;
  mfiLikeFlow: number;
  obvDirectionalFlow: number;
};

export type CapitalFlows = Pick<
  StockCandidate,
  | "capitalFlow3D"
  | "capitalFlow5D"
  | "capitalFlow9D"
  | "capitalFlow3W"
  | "capitalFlow5W"
  | "legacyCapitalFlow3D"
  | "legacyCapitalFlow5D"
  | "legacyCapitalFlow9D"
  | "legacyCapitalFlow3W"
  | "legacyCapitalFlow5W"
  | "flowCalculationVersion"
  | "capitalFlowDataSource"
  | "capitalFlowQuality"
  | "providerUsed"
  | "providerPriorityTried"
  | "providerErrors"
  | "providerEndpointType"
  | "archiveLookupTried"
  | "archiveProviderChecked"
  | "archiveHitProvider"
  | "archiveStatus"
  | "rawProviderPayloadSummary"
  | "moneyFlowMultiplierLatest"
  | "chaikinDailyFlowLatest"
  | "compositeDailyFlowLatest"
  | "priceChangeWeightedFlowLatest"
  | "mfiLikeFlowLatest"
  | "obvDirectionalFlowLatest"
  | "compositeFlowWeights"
  | "flowDataUpdatedAt"
  | "avgDollarVolume20D"
  | "flow3DToMarketCapPct"
  | "flow5DToMarketCapPct"
  | "flow9DToMarketCapPct"
  | "flow3WToMarketCapPct"
  | "flow5WToMarketCapPct"
  | "flow3DToAvgDollarVolume"
  | "flow5DToAvgDollarVolume"
  | "flow9DToAvgDollarVolume"
  | "flow3WToAvgDollarVolume"
  | "flow5WToAvgDollarVolume"
  | "flowConsistency9D"
  | "flowDirectionBreadth"
  | "shortTermFlowAcceleration"
  | "normalizedFlowScore"
  | "rawFlowScore"
  | "flowDataQualityScore"
  | "flowDataQualityGrade"
  | "flowDataQualityReasons"
  | "flowDataQualityInputs"
> & {
  recentDailyFlow?: DailyFlowDetail[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function sumLast(values: number[], count: number) {
  return values.slice(-count).reduce((sum, value) => sum + value, 0);
}

function windowFlows(values: number[]) {
  return {
    capitalFlow3D: sumLast(values, 3),
    capitalFlow5D: sumLast(values, 5),
    capitalFlow9D: sumLast(values, 9),
    capitalFlow3W: sumLast(values, 15),
    capitalFlow5W: sumLast(values, 25),
  };
}

function ratio(value: number, denominator: number | null | undefined) {
  if (!isFiniteNumber(denominator) || denominator === 0) {
    return null;
  }

  return value / denominator;
}

function scoreFlowToAvgDollarVolume(value: number | null | undefined) {
  if (!isFiniteNumber(value)) return 45;
  if (value >= 2) return 100;
  if (value >= 1) return 85;
  if (value >= 0.5) return 75;
  if (value >= 0) return 60;
  if (value >= -0.5) return 45;
  if (value >= -1) return 35;
  return 25;
}

function scoreFlowToMarketCap(value: number | null | undefined) {
  if (!isFiniteNumber(value)) return 45;
  if (value >= 5) return 100;
  if (value >= 2) return 85;
  if (value >= 1) return 75;
  if (value >= 0) return 60;
  if (value >= -1) return 45;
  if (value >= -2) return 35;
  return 25;
}

function scoreAcceleration(value: number | null | undefined) {
  if (!isFiniteNumber(value)) return 55;
  if (value >= 50) return 100;
  if (value >= 20) return 85;
  if (value >= 0) return 70;
  if (value >= -20) return 55;
  return 35;
}

function mapFlowScore(score: number) {
  if (score >= 85) return 100;
  if (score >= 75) return 90;
  if (score >= 65) return 82;
  if (score >= 55) return 75;
  if (score >= 45) return 65;
  if (score >= 35) return 55;

  return 45;
}

function calculateRawFlowScore(flows: Pick<
  StockCandidate,
  | "capitalFlow3D"
  | "capitalFlow5D"
  | "capitalFlow9D"
  | "capitalFlow3W"
  | "capitalFlow5W"
>) {
  const positiveCount = [
    flows.capitalFlow3D,
    flows.capitalFlow5D,
    flows.capitalFlow9D,
    flows.capitalFlow3W,
    flows.capitalFlow5W,
  ].filter((flow) => flow > 0).length;
  let rawScore = positiveCount * 15;

  if (flows.capitalFlow3D > 0 && flows.capitalFlow5D > 0 && flows.capitalFlow9D > 0) {
    rawScore += 25;
  }

  if (flows.capitalFlow3D < 0 && Math.abs(flows.capitalFlow3D) > Math.abs(flows.capitalFlow5D)) {
    rawScore -= 15;
  }

  return clamp(rawScore, 0, 100);
}

function getFlowCalculationVersion(dataSource: CapitalFlowDataSource) {
  if (dataSource === "YFINANCE_COMPOSITE_PROXY") {
    return COMPOSITE_PROXY_FLOW_CALCULATION_VERSION;
  }

  return dataSource === "POLYGON" ||
    dataSource === "ALPHA_VANTAGE" ||
    dataSource === "TWELVE_DATA" ||
    dataSource === "EODHD"
    ? REAL_PROVIDER_FLOW_CALCULATION_VERSION
    : YFINANCE_FLOW_CALCULATION_VERSION;
}

export function calculateMoneyFlowMultiplier(candle: OhlcvCandle) {
  if (
    !isFiniteNumber(candle.high) ||
    !isFiniteNumber(candle.low) ||
    !isFiniteNumber(candle.close) ||
    candle.high === candle.low
  ) {
    return 0;
  }

  return clamp(
    (2 * candle.close - candle.high - candle.low) / (candle.high - candle.low),
    -1,
    1,
  );
}

export function calculateCapitalFlowsFromCandles({
  candles,
  dataSource,
  quality,
  marketCap,
}: {
  candles: OhlcvCandle[];
  dataSource: CapitalFlowDataSource;
  quality: CapitalFlowQuality;
  marketCap?: number | null;
}): CapitalFlows {
  const sortedCandles = candles
    .slice()
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const useCompositeProxy = dataSource === "YFINANCE_COMPOSITE_PROXY";
  const dailyFlowDetails = sortedCandles.map<DailyFlowDetail>((candle, index, rows) => {
    const multiplier = calculateMoneyFlowMultiplier(candle);
    const previousClose = index > 0 ? rows[index - 1].close : null;
    const previousTypicalPrice =
      index > 0 &&
      isFiniteNumber(rows[index - 1].high) &&
      isFiniteNumber(rows[index - 1].low) &&
      isFiniteNumber(rows[index - 1].close)
        ? ((rows[index - 1].high ?? 0) +
            (rows[index - 1].low ?? 0) +
            (rows[index - 1].close ?? 0)) /
          3
        : null;
    const typicalPrice =
      isFiniteNumber(candle.high) &&
      isFiniteNumber(candle.low) &&
      isFiniteNumber(candle.close)
        ? (candle.high + candle.low + candle.close) / 3
        : null;
    const chaikinFlow =
      isFiniteNumber(candle.close) && isFiniteNumber(candle.volume)
        ? candle.close * candle.volume * multiplier
        : 0;
    const priceChangePct =
      isFiniteNumber(previousClose) &&
      previousClose > 0 &&
      isFiniteNumber(candle.close)
        ? (candle.close - previousClose) / previousClose
        : 0;
    const priceChangeWeightedFlow =
      isFiniteNumber(candle.close) && isFiniteNumber(candle.volume)
        ? candle.volume * candle.close * clamp(priceChangePct * 8, -1, 1)
        : 0;
    const mfiDirection =
      isFiniteNumber(typicalPrice) && isFiniteNumber(previousTypicalPrice)
        ? typicalPrice > previousTypicalPrice
          ? 1
          : typicalPrice < previousTypicalPrice
            ? -1
            : 0
        : 0;
    const mfiLikeFlow =
      isFiniteNumber(candle.volume) && isFiniteNumber(typicalPrice)
        ? candle.volume * typicalPrice * mfiDirection
        : 0;
    const obvDirection =
      isFiniteNumber(previousClose) && isFiniteNumber(candle.close)
        ? candle.close > previousClose
          ? 1
          : candle.close < previousClose
            ? -1
            : 0
        : 0;
    const obvDirectionalFlow =
      isFiniteNumber(candle.volume) && isFiniteNumber(candle.close)
        ? candle.volume * candle.close * obvDirection
        : 0;
    const compositeDailyFlow =
      COMPOSITE_FLOW_WEIGHTS.chaikin * chaikinFlow +
      COMPOSITE_FLOW_WEIGHTS.priceChangeWeighted * priceChangeWeightedFlow +
      COMPOSITE_FLOW_WEIGHTS.mfiLike * mfiLikeFlow +
      COMPOSITE_FLOW_WEIGHTS.obvDirectional * obvDirectionalFlow;
    const dailyFlowDollar = useCompositeProxy
      ? compositeDailyFlow
      : chaikinFlow;

    return {
      date: candle.date.toISOString().slice(0, 10),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      moneyFlowMultiplier: Number(multiplier.toFixed(6)),
      dailyFlowDollar: Number.isFinite(dailyFlowDollar) ? dailyFlowDollar : 0,
      chaikinDailyFlowDollar: Number.isFinite(chaikinFlow) ? chaikinFlow : 0,
      priceChangeWeightedFlow: Number.isFinite(priceChangeWeightedFlow)
        ? priceChangeWeightedFlow
        : 0,
      mfiLikeFlow: Number.isFinite(mfiLikeFlow) ? mfiLikeFlow : 0,
      obvDirectionalFlow: Number.isFinite(obvDirectionalFlow)
        ? obvDirectionalFlow
        : 0,
    };
  });
  const chaikinFlows = dailyFlowDetails.map((flow) => flow.dailyFlowDollar);
  const latestDollarVolumes = sortedCandles
    .filter(
      (candle) =>
        isFiniteNumber(candle.close) && isFiniteNumber(candle.volume),
    )
    .slice(-20)
    .map((candle) => (candle.close ?? 0) * (candle.volume ?? 0));
  const avgDollarVolume20D = latestDollarVolumes.length
    ? latestDollarVolumes.reduce((sum, value) => sum + value, 0) /
      latestDollarVolumes.length
    : null;
  const legacyFlows = sortedCandles.reduce<number[]>(
    (dailyFlows, candle, index, rows) => {
      if (index === 0 || !isFiniteNumber(candle.close) || !isFiniteNumber(candle.volume)) {
        return dailyFlows;
      }

      const previousClose = rows[index - 1].close;

      if (!isFiniteNumber(previousClose)) {
        dailyFlows.push(0);
      } else if (candle.close > previousClose) {
        dailyFlows.push(candle.close * candle.volume);
      } else if (candle.close < previousClose) {
        dailyFlows.push(-candle.close * candle.volume);
      } else {
        dailyFlows.push(0);
      }

      return dailyFlows;
    },
    [],
  );
  const latestFlow = dailyFlowDetails.at(-1);
  const flows = windowFlows(chaikinFlows);
  const flow3DToMarketCapRatio = ratio(flows.capitalFlow3D, marketCap);
  const flow5DToMarketCapRatio = ratio(flows.capitalFlow5D, marketCap);
  const flow9DToMarketCapRatio = ratio(flows.capitalFlow9D, marketCap);
  const flow3WToMarketCapRatio = ratio(flows.capitalFlow3W, marketCap);
  const flow5WToMarketCapRatio = ratio(flows.capitalFlow5W, marketCap);
  const flow3DToMarketCapPct =
    flow3DToMarketCapRatio == null ? null : flow3DToMarketCapRatio * 100;
  const flow5DToMarketCapPct =
    flow5DToMarketCapRatio == null ? null : flow5DToMarketCapRatio * 100;
  const flow9DToMarketCapPct =
    flow9DToMarketCapRatio == null ? null : flow9DToMarketCapRatio * 100;
  const flow3WToMarketCapPct =
    flow3WToMarketCapRatio == null ? null : flow3WToMarketCapRatio * 100;
  const flow5WToMarketCapPct =
    flow5WToMarketCapRatio == null ? null : flow5WToMarketCapRatio * 100;
  const flow3DToAvgDollarVolume = ratio(flows.capitalFlow3D, avgDollarVolume20D);
  const flow5DToAvgDollarVolume = ratio(flows.capitalFlow5D, avgDollarVolume20D);
  const flow9DToAvgDollarVolume = ratio(flows.capitalFlow9D, avgDollarVolume20D);
  const flow3WToAvgDollarVolume = ratio(flows.capitalFlow3W, avgDollarVolume20D);
  const flow5WToAvgDollarVolume = ratio(flows.capitalFlow5W, avgDollarVolume20D);
  const recent9Flows = chaikinFlows.slice(-9);
  const flowConsistency9D =
    (recent9Flows.filter((flow) => flow > 0).length / 9) * 100;
  const flowDirectionBreadth =
    ([
      flows.capitalFlow3D,
      flows.capitalFlow5D,
      flows.capitalFlow9D,
      flows.capitalFlow3W,
      flows.capitalFlow5W,
    ].filter((flow) => flow > 0).length /
      5) *
    100;
  const flow3DPerDay = flows.capitalFlow3D / 3;
  const flow9DPerDay = flows.capitalFlow9D / 9;
  const shortTermFlowAcceleration =
    Math.abs(flow9DPerDay) > 1
      ? clamp(
          ((flow3DPerDay - flow9DPerDay) / Math.abs(flow9DPerDay)) * 100,
          -100,
          100,
        )
      : null;
  const rawFlowScore = calculateRawFlowScore(flows);
  const normalizedFlowScore = clamp(
    flowDirectionBreadth * 0.3 +
      flowConsistency9D * 0.25 +
      scoreFlowToAvgDollarVolume(flow5DToAvgDollarVolume) * 0.2 +
      scoreFlowToMarketCap(flow3WToMarketCapPct) * 0.15 +
      scoreAcceleration(shortTermFlowAcceleration) * 0.1,
    0,
    100,
  );

  return {
    ...flows,
    legacyCapitalFlow3D: sumLast(legacyFlows, 3),
    legacyCapitalFlow5D: sumLast(legacyFlows, 5),
    legacyCapitalFlow9D: sumLast(legacyFlows, 9),
    legacyCapitalFlow3W: sumLast(legacyFlows, 15),
    legacyCapitalFlow5W: sumLast(legacyFlows, 25),
    flowCalculationVersion: getFlowCalculationVersion(dataSource),
    capitalFlowDataSource: dataSource,
    capitalFlowQuality: quality,
    providerUsed: dataSource,
    providerPriorityTried: [dataSource],
    providerErrors: [],
    providerEndpointType:
      dataSource === "POLYGON" ||
      dataSource === "ALPHA_VANTAGE" ||
      dataSource === "TWELVE_DATA" ||
      dataSource === "EODHD"
        ? "REAL_PROVIDER"
        : "YFINANCE_HISTORICAL",
    archiveLookupTried: false,
    archiveProviderChecked: [],
    archiveHitProvider: null,
    archiveStatus:
      dataSource === "POLYGON" ||
      dataSource === "ALPHA_VANTAGE" ||
      dataSource === "TWELVE_DATA" ||
      dataSource === "EODHD"
        ? undefined
        : "PROXY_PROVIDER",
    rawProviderPayloadSummary: undefined,
    moneyFlowMultiplierLatest: latestFlow?.moneyFlowMultiplier ?? null,
    chaikinDailyFlowLatest: latestFlow?.chaikinDailyFlowDollar ?? null,
    compositeDailyFlowLatest: useCompositeProxy
      ? latestFlow?.dailyFlowDollar ?? null
      : null,
    priceChangeWeightedFlowLatest: useCompositeProxy
      ? latestFlow?.priceChangeWeightedFlow ?? null
      : null,
    mfiLikeFlowLatest: useCompositeProxy
      ? latestFlow?.mfiLikeFlow ?? null
      : null,
    obvDirectionalFlowLatest: useCompositeProxy
      ? latestFlow?.obvDirectionalFlow ?? null
      : null,
    compositeFlowWeights: useCompositeProxy
      ? { ...COMPOSITE_FLOW_WEIGHTS }
      : undefined,
    flowDataUpdatedAt: latestFlow?.date,
    avgDollarVolume20D,
    flow3DToMarketCapPct,
    flow5DToMarketCapPct,
    flow9DToMarketCapPct,
    flow3WToMarketCapPct,
    flow5WToMarketCapPct,
    flow3DToAvgDollarVolume,
    flow5DToAvgDollarVolume,
    flow9DToAvgDollarVolume,
    flow3WToAvgDollarVolume,
    flow5WToAvgDollarVolume,
    flowConsistency9D,
    flowDirectionBreadth,
    shortTermFlowAcceleration,
    normalizedFlowScore,
    rawFlowScore,
    recentDailyFlow: dailyFlowDetails.slice(-25),
  };
}

export function calculateCapitalFlowScore(flows: CapitalFlows) {
  return mapFlowScore(
    isFiniteNumber(flows.normalizedFlowScore)
      ? flows.normalizedFlowScore
      : calculateRawFlowScore(flows),
  );
}

export function calculateCapitalFlowChangeRatio(flows: CapitalFlows) {
  if (flows.capitalFlow5W === 0) {
    return 0;
  }

  return Number(
    ((flows.capitalFlow3D / Math.abs(flows.capitalFlow5W)) * 100).toFixed(1),
  );
}

export function zeroCapitalFlows(
  dataSource: CapitalFlowDataSource,
  quality: CapitalFlowQuality,
): CapitalFlows {
  return {
    capitalFlow3D: 0,
    capitalFlow5D: 0,
    capitalFlow9D: 0,
    capitalFlow3W: 0,
    capitalFlow5W: 0,
    legacyCapitalFlow3D: 0,
    legacyCapitalFlow5D: 0,
    legacyCapitalFlow9D: 0,
    legacyCapitalFlow3W: 0,
    legacyCapitalFlow5W: 0,
    flowCalculationVersion: YFINANCE_FLOW_CALCULATION_VERSION,
    capitalFlowDataSource: dataSource,
    capitalFlowQuality: quality,
    providerUsed: dataSource,
    providerPriorityTried: [],
    providerErrors: [],
    providerEndpointType: dataSource === "MOCK" ? "MOCK" : "YFINANCE_HISTORICAL",
    archiveLookupTried: false,
    archiveProviderChecked: [],
    archiveHitProvider: null,
    archiveStatus: dataSource === "MOCK" ? "MOCK" : "PROXY_PROVIDER",
    rawProviderPayloadSummary: undefined,
    moneyFlowMultiplierLatest: null,
    chaikinDailyFlowLatest: null,
    compositeDailyFlowLatest: null,
    priceChangeWeightedFlowLatest: null,
    mfiLikeFlowLatest: null,
    obvDirectionalFlowLatest: null,
    compositeFlowWeights: undefined,
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
    recentDailyFlow: [],
  };
}
