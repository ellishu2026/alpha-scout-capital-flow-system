import {
  getMockCandidateFallback,
  getMockFinancialFallback,
  previousRankMap,
} from "@/data/mockSnapshot";
import {
  calculateCompositeScore,
  calculateRankChange,
  getRankChangeLabel,
  getRankChangeType,
  getSignal,
} from "@/lib/scoring";
import type { SnapshotResponse, StockCandidate } from "@/types/stock";
import YahooFinance from "yahoo-finance2";

export const LIVE_UNIVERSE_SYMBOLS = [
  "SOXL",
  "SMH",
  "NVDA",
  "AMD",
  "VRT",
  "MSFT",
  "GOOGL",
  "DXYZ",
  "RKLB",
  "LLY",
  "IONQ",
] as const;

type LiveUniverseSymbol = (typeof LIVE_UNIVERSE_SYMBOLS)[number];

type LiveQuote = {
  symbol: string;
  companyName: string;
  price: number | null;
  marketCap: number | null;
  regularMarketVolume: number | null;
};

type HistoricalDailyCandle = {
  date: Date;
  close: number;
  volume: number;
};

type CapitalFlows = Pick<
  StockCandidate,
  | "capitalFlow3D"
  | "capitalFlow5D"
  | "capitalFlow9D"
  | "capitalFlow3W"
  | "capitalFlow5W"
>;

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

const fallbackCompanyNames: Record<LiveUniverseSymbol, string> = {
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

const zeroFlows: CapitalFlows = {
  capitalFlow3D: 0,
  capitalFlow5D: 0,
  capitalFlow9D: 0,
  capitalFlow3W: 0,
  capitalFlow5W: 0,
};

function isLiveUniverseSymbol(symbol: string): symbol is LiveUniverseSymbol {
  return LIVE_UNIVERSE_SYMBOLS.includes(symbol as LiveUniverseSymbol);
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function calculateCapitalFlowScore(flows: CapitalFlows) {
  let score = 50;

  if (flows.capitalFlow3D > 0) score += 10;
  if (flows.capitalFlow5D > 0) score += 10;
  if (flows.capitalFlow9D > 0) score += 10;
  if (flows.capitalFlow3W > 0) score += 10;
  if (flows.capitalFlow5W > 0) score += 10;

  if (flows.capitalFlow5W !== 0) {
    const ratio = flows.capitalFlow3D / Math.abs(flows.capitalFlow5W);
    score += clamp(ratio * 20, -10, 10);
  }

  return Number(clamp(score, 0, 100).toFixed(1));
}

function calculateCapitalFlowChangeRatio(flows: CapitalFlows) {
  if (flows.capitalFlow5W === 0) {
    return 0;
  }

  return Number(
    ((flows.capitalFlow3D / Math.abs(flows.capitalFlow5W)) * 100).toFixed(1),
  );
}

function fallbackFlows(symbol: string): CapitalFlows {
  const fallback = getMockCandidateFallback(symbol);

  if (!fallback) {
    return zeroFlows;
  }

  return {
    capitalFlow3D: fallback.capitalFlow3D,
    capitalFlow5D: fallback.capitalFlow5D,
    capitalFlow9D: fallback.capitalFlow9D,
    capitalFlow3W: fallback.capitalFlow3W,
    capitalFlow5W: fallback.capitalFlow5W,
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
          : fallbackCompanyNames[isLiveUniverseSymbol(symbol) ? symbol : "NVDA"],
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
        Number.isFinite(row.volume),
    )
    .map((row) => ({
      date: row.date,
      close: row.close,
      volume: row.volume,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function calculateSignedCapitalFlows(
  candles: HistoricalDailyCandle[],
): CapitalFlows {
  const flows = candles
    .slice()
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .reduce<number[]>((dailyFlows, candle, index, sortedCandles) => {
      if (index === 0) {
        return dailyFlows;
      }

      const previousClose = sortedCandles[index - 1].close;

      if (candle.close > previousClose) {
        dailyFlows.push(candle.close * candle.volume);
      } else if (candle.close < previousClose) {
        dailyFlows.push(-candle.close * candle.volume);
      } else {
        dailyFlows.push(0);
      }

      return dailyFlows;
    }, []);

  const sumLast = (count: number) =>
    flows.slice(-count).reduce((sum, flow) => sum + flow, 0);

  return {
    capitalFlow3D: sumLast(3),
    capitalFlow5D: sumLast(5),
    capitalFlow9D: sumLast(9),
    capitalFlow3W: sumLast(15),
    capitalFlow5W: sumLast(25),
  };
}

async function buildLiveCandidateWithMeta(symbol: LiveUniverseSymbol): Promise<{
  candidate: StockCandidate;
  usedFallback: boolean;
}> {
  const mockCandidate = getMockCandidateFallback(symbol);
  const financials = getMockFinancialFallback(symbol);
  let usedFallback = false;

  let quote: LiveQuote | null = null;
  let flows: CapitalFlows | null = null;

  try {
    quote = await fetchLiveQuote(symbol);
  } catch {
    usedFallback = true;
  }

  try {
    const candles = await fetchHistoricalDailyCandles(symbol, 45);
    flows = calculateSignedCapitalFlows(candles);

    if (candles.length < 26) {
      usedFallback = true;
    }
  } catch {
    usedFallback = true;
  }

  const resolvedFlows = flows ?? fallbackFlows(symbol);
  const capitalFlowScore = calculateCapitalFlowScore(resolvedFlows);
  const compositeScore = calculateCompositeScore(
    financials.marginScore,
    financials.fcfScore,
    capitalFlowScore,
  );

  if (!quote?.price || !quote?.marketCap) {
    usedFallback = true;
  }

  return {
    usedFallback,
    candidate: {
      rank: 0,
      ticker: symbol,
      companyName:
        quote?.companyName ?? mockCandidate?.companyName ?? fallbackCompanyNames[symbol],
      // V1.1 is fixed-watchlist mode; no legacy market-cap or price pool filter applies.
      pool: "WATCHLIST",
      marketCap: quote?.marketCap ?? mockCandidate?.marketCap ?? 0,
      price: quote?.price ?? mockCandidate?.price ?? 0,
      ...financials,
      ...resolvedFlows,
      compositeScore,
      capitalFlowScore,
      capitalFlowChangeRatio: calculateCapitalFlowChangeRatio(resolvedFlows),
      signal: getSignal(
        compositeScore,
        financials.marginScore,
        financials.fcfScore,
        capitalFlowScore,
      ),
      dataStatus: usedFallback ? "PARTIAL_LIVE" : "LIVE_MARKET",
    },
  };
}

export async function buildLiveCandidate(
  symbol: LiveUniverseSymbol,
): Promise<StockCandidate> {
  const { candidate } = await buildLiveCandidateWithMeta(symbol);

  return candidate;
}

export async function buildLiveMarketSnapshot(): Promise<SnapshotResponse> {
  const results = await Promise.all(
    LIVE_UNIVERSE_SYMBOLS.map((symbol) => buildLiveCandidateWithMeta(symbol)),
  );

  const liveCount = results.filter((result) => !result.usedFallback).length;

  if (liveCount === 0) {
    throw new Error("Live yahoo-finance2 ingestion failed for all symbols.");
  }

  const rankedCandidates = results
    .map((result) => result.candidate)
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, LIVE_UNIVERSE_SYMBOLS.length)
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

  const movementSummary = rankedCandidates.reduce(
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

  return {
    updatedAt: new Date().toISOString(),
    dataMode: "Daily Close Snapshot",
    refreshMode: "Auto Daily Refresh",
    status: results.some((result) => result.usedFallback)
      ? "PARTIAL_LIVE"
      : "LIVE_MARKET",
    count: rankedCandidates.length,
    movementSummary,
    items: rankedCandidates,
  };
}
