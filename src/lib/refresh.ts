import { mockSnapshot } from "@/data/mockSnapshot";
import { buildLiveMarketSnapshot } from "@/lib/liveMarketData";
import type { RefreshResult, SnapshotResponse } from "@/types/stock";

export async function buildLatestSnapshot(): Promise<SnapshotResponse> {
  if (process.env.YAHOO_FINANCE_ENABLED === "true") {
    try {
      return await buildLiveMarketSnapshot();
    } catch {
      return mockSnapshot;
    }
  }

  return mockSnapshot;
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
        ? `V1.1 yahoo-finance2 refresh completed in ${snapshot.status} mode.`
        : "V1.1 yahoo-finance2 refresh failed; returned V1.0 mock snapshot fallback."
      : "V1.0 mock snapshot refresh completed. Live yahoo-finance2 ingestion is not enabled.",
    snapshot,
  };
}
