import type { DataStatus, RankChangeType, StockPool } from "@/types/stock";

export function calculateCompositeScore(
  marginScore: number,
  fcfScore: number,
  capitalFlowScore: number,
) {
  return Number(
    (marginScore * 0.3 + fcfScore * 0.4 + capitalFlowScore * 0.3).toFixed(1),
  );
}

export function getSignal(
  compositeScore: number,
  marginScore: number,
  fcfScore: number,
  capitalFlowScore: number,
) {
  if (
    compositeScore >= 85 &&
    marginScore >= 75 &&
    fcfScore >= 80 &&
    capitalFlowScore >= 80
  ) {
    return "Strong Accumulation";
  }

  if (compositeScore >= 75) {
    return "Accumulation";
  }

  if (compositeScore >= 65) {
    return "Watch";
  }

  return "Neutral";
}

export function calculateRankChange(
  currentRank: number,
  previousRank?: number | null,
) {
  if (previousRank == null) {
    return null;
  }

  return previousRank - currentRank;
}

export function getRankChangeType(
  currentRank: number,
  previousRank?: number | null,
): RankChangeType {
  if (previousRank == null) {
    return "NEW";
  }

  if (previousRank > currentRank) {
    return "UP";
  }

  if (previousRank < currentRank) {
    return "DOWN";
  }

  return "SAME";
}

export function getRankChangeLabel(
  currentRank: number,
  previousRank?: number | null,
) {
  const changeType = getRankChangeType(currentRank, previousRank);
  const rankChange = calculateRankChange(currentRank, previousRank);

  if (changeType === "NEW") {
    return "NEW";
  }

  if (changeType === "SAME" || rankChange === 0 || rankChange == null) {
    return "—";
  }

  if (changeType === "UP") {
    return `↑${Math.abs(rankChange)}`;
  }

  return `↓${Math.abs(rankChange)}`;
}

function isAvailableNumber(
  value: number | null | undefined,
): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatMarketCap(value: number | null | undefined) {
  if (!isAvailableNumber(value) || value <= 0) {
    return "N/A";
  }

  if (value >= 1_000_000_000_000) {
    return `$${(value / 1_000_000_000_000).toFixed(1)}T`;
  }

  const billions = value / 1_000_000_000;
  const digits = billions >= 100 ? 0 : 1;

  return `$${billions.toFixed(digits)}B`;
}

export function formatCurrency(value: number | null | undefined) {
  if (!isAvailableNumber(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

export function formatLargeCurrency(value: number | null | undefined) {
  if (!isAvailableNumber(value)) {
    return "N/A";
  }

  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (absValue >= 1_000_000_000_000) {
    return `${sign}$${(absValue / 1_000_000_000_000).toFixed(1)}T`;
  }

  if (absValue >= 1_000_000_000) {
    return `${sign}$${(absValue / 1_000_000_000).toFixed(1)}B`;
  }

  if (absValue >= 1_000_000) {
    return `${sign}$${(absValue / 1_000_000).toFixed(1)}M`;
  }

  return `${sign}$${absValue.toFixed(0)}`;
}

export function formatPercent(value: number | null | undefined) {
  if (!isAvailableNumber(value)) {
    return "N/A";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function getPoolLabel(pool: StockPool) {
  const labels: Record<StockPool, string> = {
    MID_CAP: "$50B-$300B",
    HIGH_PRICE: "Price > $800",
    OVERLAP: "Overlap",
    WATCHLIST: "Fixed List",
  };

  return labels[pool];
}

export function getDataStatusLabel(status: DataStatus) {
  const labels: Record<DataStatus, string> = {
    HIGH: "High",
    MID: "Medium",
    LOW: "Low",
    LIVE_MARKET: "Live",
    PARTIAL_LIVE: "Partial Live",
    MOCK: "Mock",
  };

  return labels[status];
}

export function getScoreLevel(score: number) {
  if (score >= 85) {
    return "High";
  }

  if (score >= 70) {
    return "Medium";
  }

  return "Low";
}
