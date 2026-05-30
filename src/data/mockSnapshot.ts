import {
  calculateCompositeScore,
  calculateRankChange,
  getRankChangeLabel,
  getRankChangeType,
  getSignal,
} from "@/lib/scoring";
import type { SnapshotResponse, StockCandidate } from "@/types/stock";

type MockCandidateInput = Omit<
  StockCandidate,
  "rank" | "compositeScore" | "signal" | "dataStatus"
>;

const billion = 1_000_000_000;

export const previousRankMap: Record<string, number | null> = {
  NVDA: 3,
  AVGO: null,
  LLY: 2,
  NOW: 4,
  ASML: 7,
  COST: 6,
  VRT: 10,
  ORCL: 8,
  FICO: null,
  AMD: 5,
  ANET: 11,
};

const candidates: MockCandidateInput[] = [
  {
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    pool: "HIGH_PRICE",
    marketCap: 2_850 * billion,
    price: 1_132.8,
    fcf: 27.0 * billion,
    fcfQoqChange: 18.4,
    capitalFlow3D: 42.8 * billion,
    capitalFlow5D: 69.5 * billion,
    capitalFlow9D: 111.2 * billion,
    capitalFlow3W: 156.4 * billion,
    capitalFlow5W: 208.9 * billion,
    marginScore: 94,
    fcfScore: 96,
    capitalFlowScore: 97,
    marginChange: 4.8,
    cashFlowChangeRatio: 18.4,
    capitalFlowChangeRatio: 27.6,
  },
  {
    ticker: "AVGO",
    companyName: "Broadcom Inc.",
    pool: "HIGH_PRICE",
    marketCap: 640 * billion,
    price: 1_381.2,
    fcf: 19.4 * billion,
    fcfQoqChange: 11.2,
    capitalFlow3D: 18.8 * billion,
    capitalFlow5D: 31.6 * billion,
    capitalFlow9D: 50.7 * billion,
    capitalFlow3W: 73.2 * billion,
    capitalFlow5W: 96.5 * billion,
    marginScore: 90,
    fcfScore: 94,
    capitalFlowScore: 90,
    marginChange: 3.1,
    cashFlowChangeRatio: 11.2,
    capitalFlowChangeRatio: 18.8,
  },
  {
    ticker: "LLY",
    companyName: "Eli Lilly and Company",
    pool: "OVERLAP",
    marketCap: 845 * billion,
    price: 892.45,
    fcf: 6.7 * billion,
    fcfQoqChange: 9.8,
    capitalFlow3D: 14.2 * billion,
    capitalFlow5D: 28.1 * billion,
    capitalFlow9D: 37.8 * billion,
    capitalFlow3W: 61.4 * billion,
    capitalFlow5W: 88.2 * billion,
    marginScore: 91,
    fcfScore: 86,
    capitalFlowScore: 89,
    marginChange: 5.4,
    cashFlowChangeRatio: 9.8,
    capitalFlowChangeRatio: 16.7,
  },
  {
    ticker: "NOW",
    companyName: "ServiceNow, Inc.",
    pool: "HIGH_PRICE",
    marketCap: 171 * billion,
    price: 829.74,
    fcf: 3.1 * billion,
    fcfQoqChange: 15.9,
    capitalFlow3D: 5.4 * billion,
    capitalFlow5D: 9.7 * billion,
    capitalFlow9D: 14.3 * billion,
    capitalFlow3W: 22.8 * billion,
    capitalFlow5W: 33.6 * billion,
    marginScore: 86,
    fcfScore: 91,
    capitalFlowScore: 84,
    marginChange: 2.7,
    cashFlowChangeRatio: 15.9,
    capitalFlowChangeRatio: 14.1,
  },
  {
    ticker: "ASML",
    companyName: "ASML Holding N.V.",
    pool: "HIGH_PRICE",
    marketCap: 374 * billion,
    price: 948.31,
    fcf: 7.5 * billion,
    fcfQoqChange: 8.6,
    capitalFlow3D: 7.8 * billion,
    capitalFlow5D: 12.5 * billion,
    capitalFlow9D: 19.1 * billion,
    capitalFlow3W: 27.4 * billion,
    capitalFlow5W: 43.2 * billion,
    marginScore: 88,
    fcfScore: 85,
    capitalFlowScore: 83,
    marginChange: 1.9,
    cashFlowChangeRatio: 8.6,
    capitalFlowChangeRatio: 12.4,
  },
  {
    ticker: "COST",
    companyName: "Costco Wholesale Corporation",
    pool: "HIGH_PRICE",
    marketCap: 390 * billion,
    price: 879.15,
    fcf: 6.2 * billion,
    fcfQoqChange: 7.2,
    capitalFlow3D: 6.9 * billion,
    capitalFlow5D: 10.4 * billion,
    capitalFlow9D: 18.2 * billion,
    capitalFlow3W: 26.8 * billion,
    capitalFlow5W: 39.7 * billion,
    marginScore: 84,
    fcfScore: 87,
    capitalFlowScore: 82,
    marginChange: 1.4,
    cashFlowChangeRatio: 7.2,
    capitalFlowChangeRatio: 10.9,
  },
  {
    ticker: "VRT",
    companyName: "Vertiv Holdings Co",
    pool: "MID_CAP",
    marketCap: 51 * billion,
    price: 135.42,
    fcf: 1.0 * billion,
    fcfQoqChange: 22.3,
    capitalFlow3D: 2.5 * billion,
    capitalFlow5D: 4.8 * billion,
    capitalFlow9D: 8.1 * billion,
    capitalFlow3W: 11.7 * billion,
    capitalFlow5W: 16.9 * billion,
    marginScore: 82,
    fcfScore: 86,
    capitalFlowScore: 85,
    marginChange: 6.6,
    cashFlowChangeRatio: 22.3,
    capitalFlowChangeRatio: 19.5,
  },
  {
    ticker: "ORCL",
    companyName: "Oracle Corporation",
    pool: "MID_CAP",
    marketCap: 298 * billion,
    price: 121.64,
    fcf: 11.8 * billion,
    fcfQoqChange: 10.4,
    capitalFlow3D: 9.4 * billion,
    capitalFlow5D: 15.1 * billion,
    capitalFlow9D: 24.8 * billion,
    capitalFlow3W: 35.6 * billion,
    capitalFlow5W: 52.3 * billion,
    marginScore: 80,
    fcfScore: 88,
    capitalFlowScore: 80,
    marginChange: 2.2,
    cashFlowChangeRatio: 10.4,
    capitalFlowChangeRatio: 11.8,
  },
  {
    ticker: "AMD",
    companyName: "Advanced Micro Devices, Inc.",
    pool: "MID_CAP",
    marketCap: 285 * billion,
    price: 176.9,
    fcf: 1.1 * billion,
    fcfQoqChange: 13.1,
    capitalFlow3D: 10.6 * billion,
    capitalFlow5D: 18.9 * billion,
    capitalFlow9D: 27.5 * billion,
    capitalFlow3W: 43.8 * billion,
    capitalFlow5W: 57.2 * billion,
    marginScore: 75,
    fcfScore: 79,
    capitalFlowScore: 89,
    marginChange: 2.8,
    cashFlowChangeRatio: 13.1,
    capitalFlowChangeRatio: 24.6,
  },
  {
    ticker: "FICO",
    companyName: "Fair Isaac Corporation",
    pool: "MID_CAP",
    marketCap: 54 * billion,
    price: 2_196.32,
    fcf: 0.7 * billion,
    fcfQoqChange: 12.9,
    capitalFlow3D: 1.2 * billion,
    capitalFlow5D: 2.1 * billion,
    capitalFlow9D: 3.6 * billion,
    capitalFlow3W: 5.4 * billion,
    capitalFlow5W: 7.6 * billion,
    marginScore: 87,
    fcfScore: 82,
    capitalFlowScore: 76,
    marginChange: 3.6,
    cashFlowChangeRatio: 12.9,
    capitalFlowChangeRatio: 9.3,
  },
  {
    ticker: "ANET",
    companyName: "Arista Networks, Inc.",
    pool: "OVERLAP",
    marketCap: 110 * billion,
    price: 87.18,
    fcf: 2.1 * billion,
    fcfQoqChange: 9.7,
    capitalFlow3D: 3.6 * billion,
    capitalFlow5D: 6.4 * billion,
    capitalFlow9D: 11.9 * billion,
    capitalFlow3W: 18.1 * billion,
    capitalFlow5W: 24.8 * billion,
    marginScore: 81,
    fcfScore: 80,
    capitalFlowScore: 79,
    marginChange: 2.6,
    cashFlowChangeRatio: 9.7,
    capitalFlowChangeRatio: 12.8,
  },
  {
    ticker: "MELI",
    companyName: "MercadoLibre, Inc.",
    pool: "OVERLAP",
    marketCap: 86 * billion,
    price: 1_709.22,
    fcf: 4.8 * billion,
    fcfQoqChange: 6.3,
    capitalFlow3D: 1.9 * billion,
    capitalFlow5D: 3.4 * billion,
    capitalFlow9D: 5.2 * billion,
    capitalFlow3W: 8.9 * billion,
    capitalFlow5W: 12.8 * billion,
    marginScore: 78,
    fcfScore: 84,
    capitalFlowScore: 72,
    marginChange: 1.8,
    cashFlowChangeRatio: 6.3,
    capitalFlowChangeRatio: 7.1,
  },
  {
    ticker: "APP",
    companyName: "AppLovin Corporation",
    pool: "OVERLAP",
    marketCap: 126 * billion,
    price: 372.41,
    fcf: 2.4 * billion,
    fcfQoqChange: 17.1,
    capitalFlow3D: 4.7 * billion,
    capitalFlow5D: 7.2 * billion,
    capitalFlow9D: 10.9 * billion,
    capitalFlow3W: 17.2 * billion,
    capitalFlow5W: 25.4 * billion,
    marginScore: 74,
    fcfScore: 83,
    capitalFlowScore: 77,
    marginChange: 4.2,
    cashFlowChangeRatio: 17.1,
    capitalFlowChangeRatio: 13.3,
  },
  {
    ticker: "SMCI",
    companyName: "Super Micro Computer, Inc.",
    pool: "MID_CAP",
    marketCap: 56 * billion,
    price: 947.21,
    fcf: 0.4 * billion,
    fcfQoqChange: -4.7,
    capitalFlow3D: -1.8 * billion,
    capitalFlow5D: 2.2 * billion,
    capitalFlow9D: 6.8 * billion,
    capitalFlow3W: 9.7 * billion,
    capitalFlow5W: 14.1 * billion,
    marginScore: 66,
    fcfScore: 62,
    capitalFlowScore: 73,
    marginChange: -1.2,
    cashFlowChangeRatio: -4.7,
    capitalFlowChangeRatio: 5.8,
  },
  {
    ticker: "TTD",
    companyName: "The Trade Desk, Inc.",
    pool: "MID_CAP",
    marketCap: 52 * billion,
    price: 94.36,
    fcf: 0.6 * billion,
    fcfQoqChange: 5.4,
    capitalFlow3D: 1.1 * billion,
    capitalFlow5D: 1.8 * billion,
    capitalFlow9D: 2.9 * billion,
    capitalFlow3W: 4.5 * billion,
    capitalFlow5W: 6.7 * billion,
    marginScore: 70,
    fcfScore: 69,
    capitalFlowScore: 68,
    marginChange: 1.1,
    cashFlowChangeRatio: 5.4,
    capitalFlowChangeRatio: 6.2,
  },
];

export type MockFinancialFallback = Pick<
  StockCandidate,
  | "marginScore"
  | "fcfScore"
  | "marginChange"
  | "fcf"
  | "fcfQoqChange"
  | "cashFlowChangeRatio"
>;

export function getMockFinancialFallback(
  ticker: string,
): MockFinancialFallback {
  const fallback = candidates.find((candidate) => candidate.ticker === ticker);

  if (!fallback) {
    return {
      marginScore: 65,
      fcfScore: 65,
      marginChange: 0,
      fcf: 0,
      fcfQoqChange: 0,
      cashFlowChangeRatio: 0,
    };
  }

  return {
    marginScore: fallback.marginScore,
    fcfScore: fallback.fcfScore,
    marginChange: fallback.marginChange,
    fcf: fallback.fcf,
    fcfQoqChange: fallback.fcfQoqChange,
    cashFlowChangeRatio: fallback.cashFlowChangeRatio,
  };
}

export function getMockCandidateFallback(ticker: string) {
  return candidates.find((candidate) => candidate.ticker === ticker) ?? null;
}

const rankedCandidates: StockCandidate[] = candidates
  .map((candidate) => {
    const compositeScore = calculateCompositeScore(
      candidate.marginScore,
      candidate.fcfScore,
      candidate.capitalFlowScore,
    );

    return {
      ...candidate,
      rank: 0,
      compositeScore,
      signal: getSignal(
        compositeScore,
        candidate.marginScore,
        candidate.fcfScore,
        candidate.capitalFlowScore,
      ),
      dataStatus: "MOCK" as const,
    };
  })
  .sort((a, b) => b.compositeScore - a.compositeScore)
  .slice(0, 11)
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
    if (candidate.changeType === "NEW") {
      summary.newCount += 1;
    }

    if (candidate.changeType === "UP") {
      summary.upCount += 1;
    }

    if (candidate.changeType === "DOWN") {
      summary.downCount += 1;
    }

    if (candidate.changeType === "SAME") {
      summary.sameCount += 1;
    }

    return summary;
  },
  {
    newCount: 0,
    upCount: 0,
    downCount: 0,
    sameCount: 0,
  },
);

export const mockSnapshot: SnapshotResponse = {
  updatedAt: new Date("2026-05-30T16:00:00.000Z").toISOString(),
  dataMode: "Daily Close Snapshot",
  refreshMode: "Auto Daily Refresh",
  status: "MOCK",
  count: rankedCandidates.length,
  movementSummary,
  items: rankedCandidates,
};
