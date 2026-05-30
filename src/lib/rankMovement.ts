import {
  calculateRankChange,
  getRankChangeLabel,
  getRankChangeType,
} from "@/lib/scoring";
import type { SnapshotResponse, StockCandidate } from "@/types/stock";

function summarizeMovement(items: StockCandidate[]) {
  return items.reduce(
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

export function applyRealRankMovement(
  currentSnapshot: SnapshotResponse,
  previousSnapshot: SnapshotResponse | null,
): SnapshotResponse {
  if (!previousSnapshot) {
    const items = currentSnapshot.items.map((candidate) => ({
      ...candidate,
      previousRank: null,
      rankChange: null,
      changeType: "NEW" as const,
      changeLabel: "NEW",
    }));

    return {
      ...currentSnapshot,
      items,
      previousSnapshotFound: false,
      droppedSymbols: [],
      movementSummary: summarizeMovement(items),
    };
  }

  const previousRankByTicker = new Map(
    previousSnapshot.items.map((candidate) => [candidate.ticker, candidate.rank]),
  );
  const currentTickers = new Set(
    currentSnapshot.items.map((candidate) => candidate.ticker),
  );
  const items = currentSnapshot.items.map((candidate) => {
    const previousRank = previousRankByTicker.get(candidate.ticker) ?? null;
    const rankChange = calculateRankChange(candidate.rank, previousRank);
    const changeType = getRankChangeType(candidate.rank, previousRank);
    const changeLabel = getRankChangeLabel(candidate.rank, previousRank);

    return {
      ...candidate,
      previousRank,
      rankChange,
      changeType,
      changeLabel,
    };
  });
  const droppedSymbols = previousSnapshot.items
    .filter((candidate) => !currentTickers.has(candidate.ticker))
    .map((candidate) => candidate.ticker);

  return {
    ...currentSnapshot,
    items,
    previousSnapshotFound: true,
    droppedSymbols,
    movementSummary: summarizeMovement(items),
  };
}
