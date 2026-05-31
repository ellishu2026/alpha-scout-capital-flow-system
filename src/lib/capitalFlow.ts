import type {
  CapitalFlowDataSource,
  CapitalFlowQuality,
  StockCandidate,
} from "@/types/stock";

export const FLOW_CALCULATION_VERSION = "V1.6.1_CHAIKIN" as const;

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
  | "moneyFlowMultiplierLatest"
  | "chaikinDailyFlowLatest"
  | "flowDataUpdatedAt"
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
}: {
  candles: OhlcvCandle[];
  dataSource: CapitalFlowDataSource;
  quality: CapitalFlowQuality;
}): CapitalFlows {
  const sortedCandles = candles
    .slice()
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const dailyFlowDetails = sortedCandles.map<DailyFlowDetail>((candle) => {
    const multiplier = calculateMoneyFlowMultiplier(candle);
    const dailyFlowDollar =
      isFiniteNumber(candle.close) && isFiniteNumber(candle.volume)
        ? candle.close * candle.volume * multiplier
        : 0;

    return {
      date: candle.date.toISOString().slice(0, 10),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      moneyFlowMultiplier: Number(multiplier.toFixed(6)),
      dailyFlowDollar,
    };
  });
  const chaikinFlows = dailyFlowDetails.map((flow) => flow.dailyFlowDollar);
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

  return {
    ...windowFlows(chaikinFlows),
    legacyCapitalFlow3D: sumLast(legacyFlows, 3),
    legacyCapitalFlow5D: sumLast(legacyFlows, 5),
    legacyCapitalFlow9D: sumLast(legacyFlows, 9),
    legacyCapitalFlow3W: sumLast(legacyFlows, 15),
    legacyCapitalFlow5W: sumLast(legacyFlows, 25),
    flowCalculationVersion: FLOW_CALCULATION_VERSION,
    capitalFlowDataSource: dataSource,
    capitalFlowQuality: quality,
    moneyFlowMultiplierLatest: latestFlow?.moneyFlowMultiplier ?? null,
    chaikinDailyFlowLatest: latestFlow?.dailyFlowDollar ?? null,
    flowDataUpdatedAt: latestFlow?.date,
    recentDailyFlow: dailyFlowDetails.slice(-25),
  };
}

export function calculateCapitalFlowScore(flows: CapitalFlows) {
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

  rawScore = clamp(rawScore, 0, 100);

  if (rawScore >= 85) return 100;
  if (rawScore >= 75) return 90;
  if (rawScore >= 65) return 82;
  if (rawScore >= 55) return 75;
  if (rawScore >= 45) return 65;
  if (rawScore >= 35) return 55;

  return 45;
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
    flowCalculationVersion: FLOW_CALCULATION_VERSION,
    capitalFlowDataSource: dataSource,
    capitalFlowQuality: quality,
    moneyFlowMultiplierLatest: null,
    chaikinDailyFlowLatest: null,
    flowDataUpdatedAt: undefined,
    recentDailyFlow: [],
  };
}
