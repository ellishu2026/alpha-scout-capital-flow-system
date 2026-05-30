import { mockSnapshot } from "@/data/mockSnapshot";
import {
  buildFixedWatchlistSnapshot,
  buildMarketScanSnapshot,
} from "@/lib/liveMarketData";
import type { RefreshResult, SnapshotResponse } from "@/types/stock";

export async function buildLatestSnapshot(): Promise<SnapshotResponse> {
  if (process.env.YAHOO_FINANCE_ENABLED === "true") {
    try {
      return await buildMarketScanSnapshot();
    } catch {
      try {
        return await buildFixedWatchlistSnapshot();
      } catch {
        return {
          ...mockSnapshot,
          mode: "MOCK",
        };
      }
    }
  }

  return {
    ...mockSnapshot,
    mode: "MOCK",
  };
}

export async function refreshDailySnapshot(): Promise<RefreshResult> {
  const liveMode = process.env.YAHOO_FINANCE_ENABLED === "true";
  const snapshot = await buildLatestSnapshot();
  const usedLiveSnapshot =
    snapshot.status === "LIVE_MARKET" || snapshot.status === "PARTIAL_LIVE";

  return {
    ok: true,
    refreshedAt: new Date().toISOString(),
    dataMode: snapshot.dataMode,
    refreshMode: snapshot.refreshMode,
    status: snapshot.status,
    count: snapshot.count,
    message: liveMode
      ? usedLiveSnapshot
        ? `V1.2.1 yahoo-finance2 refresh completed in ${snapshot.mode ?? snapshot.status} mode.`
        : "V1.2.1 yahoo-finance2 refresh failed; returned mock snapshot fallback."
      : "V1.0 mock snapshot refresh completed. Live yahoo-finance2 ingestion is not enabled.",
    snapshot,
  };
}
