import {
  getMockCandidateFallback,
  previousRankMap,
} from "@/data/mockSnapshot";
import {
  calculateCompositeScore,
  calculateRankChange,
  getRankChangeLabel,
  getRankChangeType,
  getSignal,
} from "@/lib/scoring";
import {
  buildSecFinancialSnapshot,
  getFinancialFallback,
  type FinancialSnapshot,
} from "@/lib/secFinancialData";
import {
  FIXED_WATCHLIST_SYMBOLS,
  MARKET_SCAN_SYMBOLS,
} from "@/lib/marketUniverse";
import type { SnapshotResponse, StockCandidate, StockPool } from "@/types/stock";
import YahooFinance from "yahoo-finance2";

const MID_CAP_MIN = 50_000_000_000;
const MID_CAP_MAX = 300_000_000_000;
const HIGH_PRICE_MIN = 800;
const TOP_CANDIDATE_LIMIT = 11;
const QUOTE_CONCURRENCY = 8;
const CANDLE_CONCURRENCY = 4;

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

const fallbackCompanyNames: Record<string, string> = {
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

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];

  for (let index = 0; index < items.length; index += limit) {
    const batch = items.slice(index, index + limit);
    results.push(...(await Promise.all(batch.map((item) => mapper(item)))));
  }

  return results;
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

async function resolveFinancials(symbol: string): Promise<FinancialSnapshot> {
  try {
    const secFinancials = await buildSecFinancialSnapshot(symbol);

    if (secFinancials) {
      return secFinancials;
    }

    return {
      ...(await getFinancialFallback(symbol)),
      financialError: "SEC_UNAVAILABLE",
    };
  } catch {
    // SEC data is best-effort; keep live market snapshots resilient.
  }

  return {
    ...(await getFinancialFallback(symbol)),
    financialError: "SEC_REQUEST_FAILED",
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
          : fallbackCompanyNames[symbol] ?? symbol,
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

function classifyPool(quote: LiveQuote): StockPool | null {
  const marketCap = quote.marketCap ?? 0;
  const price = quote.price ?? 0;
  const isMidCap = marketCap >= MID_CAP_MIN && marketCap <= MID_CAP_MAX;
  const isHighPrice = price > HIGH_PRICE_MIN;

  if (isMidCap && isHighPrice) {
    return "OVERLAP";
  }

  if (isMidCap) {
    return "MID_CAP";
  }

  if (isHighPrice) {
    return "HIGH_PRICE";
  }

  return null;
}

async function buildCandidateFromParts({
  symbol,
  quote,
  flows,
  pool,
  usedMarketFallback,
}: {
  symbol: string;
  quote: LiveQuote | null;
  flows: CapitalFlows;
  pool: StockPool;
  usedMarketFallback: boolean;
}): Promise<StockCandidate> {
  const mockCandidate = getMockCandidateFallback(symbol);
  const financials = await resolveFinancials(symbol);
  const capitalFlowScore = calculateCapitalFlowScore(flows);
  const compositeScore = calculateCompositeScore(
    financials.marginScore,
    financials.fcfScore,
    capitalFlowScore,
  );

  return {
    rank: 0,
    ticker: symbol,
    companyName:
      quote?.companyName ??
      mockCandidate?.companyName ??
      fallbackCompanyNames[symbol] ??
      symbol,
    pool,
    marketCap: quote ? (quote.marketCap ?? 0) : (mockCandidate?.marketCap ?? 0),
    price: quote ? (quote.price ?? 0) : (mockCandidate?.price ?? 0),
    ...financials,
    ...flows,
    compositeScore,
    capitalFlowScore,
    capitalFlowChangeRatio: calculateCapitalFlowChangeRatio(flows),
    signal: getSignal(
      compositeScore,
      financials.marginScore,
      financials.fcfScore,
      capitalFlowScore,
    ),
    dataStatus: usedMarketFallback ? "PARTIAL_LIVE" : "LIVE_MARKET",
  };
}

async function buildFixedWatchlistCandidateWithMeta(symbol: string): Promise<{
  candidate: StockCandidate;
  usedFallback: boolean;
}> {
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

  if (!quote?.price || !quote?.marketCap) {
    usedFallback = true;
  }

  return {
    usedFallback,
    candidate: await buildCandidateFromParts({
      symbol,
      quote,
      flows: flows ?? fallbackFlows(symbol),
      pool: "WATCHLIST",
      usedMarketFallback: usedFallback,
    }),
  };
}

async function fetchQuoteForScan(symbol: string): Promise<{
  symbol: string;
  quote: LiveQuote | null;
  pool: StockPool | null;
  failed: boolean;
}> {
  try {
    const quote = await fetchLiveQuote(symbol);
    return {
      symbol,
      quote,
      pool: classifyPool(quote),
      failed: !quote.price || !quote.marketCap,
    };
  } catch {
    return {
      symbol,
      quote: null,
      pool: null,
      failed: true,
    };
  }
}

async function buildScanCandidateFromQuote({
  symbol,
  quote,
  pool,
}: {
  symbol: string;
  quote: LiveQuote;
  pool: StockPool;
}): Promise<{
  candidate: StockCandidate;
  usedFallback: boolean;
}> {
  let flows: CapitalFlows | null = null;
  let usedFallback = false;

  try {
    const candles = await fetchHistoricalDailyCandles(symbol, 45);
    flows = calculateSignedCapitalFlows(candles);

    if (candles.length < 26) {
      usedFallback = true;
    }
  } catch {
    usedFallback = true;
  }

  return {
    usedFallback,
    candidate: await buildCandidateFromParts({
      symbol,
      quote,
      flows: flows ?? fallbackFlows(symbol),
      pool,
      usedMarketFallback: usedFallback,
    }),
  };
}

function rankCandidates(candidates: StockCandidate[], limit: number) {
  return candidates
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, limit)
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
}

function buildMovementSummary(candidates: StockCandidate[]) {
  return candidates.reduce(
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
}

export async function buildFixedWatchlistSnapshot(): Promise<SnapshotResponse> {
  const symbols = Array.from(new Set(FIXED_WATCHLIST_SYMBOLS));
  const results = await mapWithConcurrency(
    symbols,
    CANDLE_CONCURRENCY,
    buildFixedWatchlistCandidateWithMeta,
  );

  const liveCount = results.filter((result) => !result.usedFallback).length;

  if (liveCount === 0) {
    throw new Error("Live fixed watchlist ingestion failed for all symbols.");
  }

  const rankedCandidates = rankCandidates(
    results.map((result) => result.candidate),
    TOP_CANDIDATE_LIMIT,
  );

  return {
    updatedAt: new Date().toISOString(),
    dataMode: "Daily Close Snapshot",
    refreshMode: "Auto Daily Refresh",
    mode: "FIXED_WATCHLIST",
    status: "PARTIAL_LIVE",
    count: rankedCandidates.length,
    scannedCount: symbols.length,
    candidateCount: rankedCandidates.length,
    failedCount: results.filter((result) => result.usedFallback).length,
    movementSummary: buildMovementSummary(rankedCandidates),
    items: rankedCandidates,
  };
}

export async function buildMarketScanSnapshot(): Promise<SnapshotResponse> {
  const symbols = Array.from(new Set(MARKET_SCAN_SYMBOLS));
  const quoteResults = await mapWithConcurrency(
    symbols,
    QUOTE_CONCURRENCY,
    fetchQuoteForScan,
  );
  const quoteFilteredCandidates = quoteResults.filter(
    (
      result,
    ): result is {
      symbol: string;
      quote: LiveQuote;
      pool: StockPool;
      failed: boolean;
    } => result.quote != null && result.pool != null,
  );

  if (quoteFilteredCandidates.length === 0) {
    throw new Error("Market scan quote filter returned no candidates.");
  }

  const scanResults = await mapWithConcurrency(
    quoteFilteredCandidates,
    CANDLE_CONCURRENCY,
    buildScanCandidateFromQuote,
  );

  const rankedCandidates = rankCandidates(
    scanResults.map((result) => result.candidate),
    TOP_CANDIDATE_LIMIT,
  );

  if (rankedCandidates.length === 0) {
    throw new Error("Market scan returned no ranked candidates.");
  }

  const selectedTickers = new Set(
    rankedCandidates.map((candidate) => candidate.ticker),
  );
  const selectedResults = scanResults.filter((result) =>
    selectedTickers.has(result.candidate.ticker),
  );
  const quoteFailedCount = quoteResults.filter((result) => result.failed).length;
  const candleFallbackCount = selectedResults.filter(
    (result) => result.usedFallback,
  ).length;

  return {
    updatedAt: new Date().toISOString(),
    dataMode: "Daily Close Snapshot",
    refreshMode: "Auto Daily Refresh",
    mode: "MARKET_SCAN",
    status: "PARTIAL_LIVE",
    count: rankedCandidates.length,
    scannedCount: symbols.length,
    candidateCount: quoteFilteredCandidates.length,
    failedCount: quoteFailedCount + candleFallbackCount,
    movementSummary: buildMovementSummary(rankedCandidates),
    items: rankedCandidates,
  };
}

export async function buildLiveCandidate(
  symbol: string,
): Promise<StockCandidate> {
  const { candidate } = await buildFixedWatchlistCandidateWithMeta(symbol);

  return candidate;
}

export const buildLiveMarketSnapshot = buildFixedWatchlistSnapshot;
