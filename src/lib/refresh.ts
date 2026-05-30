import { mockSnapshot } from "@/data/mockSnapshot";
import type { RefreshResult, SnapshotResponse } from "@/types/stock";

export async function buildLatestSnapshot(): Promise<SnapshotResponse> {
  return mockSnapshot;
}

export async function refreshDailySnapshot(): Promise<RefreshResult> {
  const snapshot = await buildLatestSnapshot();

  return {
    ok: true,
    refreshedAt: new Date().toISOString(),
    dataMode: snapshot.dataMode,
    refreshMode: snapshot.refreshMode,
    status: snapshot.status,
    count: snapshot.count,
    message:
      "V1.0 mock snapshot refresh completed. Live yahoo-finance2 ingestion is not enabled.",
    snapshot,
  };
}
