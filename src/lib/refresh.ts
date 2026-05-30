import { mockSnapshot } from "@/data/mockSnapshot";
import {
  buildFixedWatchlistSnapshot,
  buildMarketScanSnapshot,
} from "@/lib/liveMarketData";
import { applyRealRankMovement } from "@/lib/rankMovement";
import {
  getLatestSnapshot as getLatestSavedSnapshot,
  getPreviousSnapshot,
  getSnapshotDate,
  upsertTodaySnapshot,
} from "@/lib/snapshotStore";
import { isSupabaseConfigured } from "@/lib/supabaseAdmin";
import type { RefreshResult, SnapshotResponse } from "@/types/stock";

function withoutFixedSnapshot(snapshot: SnapshotResponse): SnapshotResponse {
  const snapshotWithoutFixed = { ...snapshot };
  delete snapshotWithoutFixed.fixedSnapshot;

  return snapshotWithoutFixed;
}

async function buildFreshMarketSnapshotForRefresh(): Promise<SnapshotResponse> {
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

async function buildFreshFixedSnapshotForRefresh() {
  if (process.env.YAHOO_FINANCE_ENABLED !== "true") {
    return undefined;
  }

  try {
    return await buildFixedWatchlistSnapshot();
  } catch {
    return undefined;
  }
}

export async function buildLatestSnapshot(): Promise<SnapshotResponse> {
  if (isSupabaseConfigured()) {
    const savedSnapshot = await getLatestSavedSnapshot("MARKET_SCAN");

    if (savedSnapshot) {
      return {
        ...savedSnapshot,
        persistenceStatus: "SAVED",
      };
    }
  }

  if (process.env.YAHOO_FINANCE_ENABLED === "true") {
    try {
      return {
        ...(await buildMarketScanSnapshot()),
        persistenceStatus: isSupabaseConfigured() ? "FAILED" : "DISABLED",
      };
    } catch {
      try {
        return {
          ...(await buildFixedWatchlistSnapshot()),
          persistenceStatus: isSupabaseConfigured() ? "FAILED" : "DISABLED",
        };
      } catch {
        return {
          ...mockSnapshot,
          mode: "MOCK",
          persistenceStatus: isSupabaseConfigured() ? "FAILED" : "DISABLED",
        };
      }
    }
  }

  return {
    ...mockSnapshot,
    mode: "MOCK",
    persistenceStatus: isSupabaseConfigured() ? "FAILED" : "DISABLED",
  };
}

async function buildFixedSnapshotForLatest() {
  if (isSupabaseConfigured()) {
    const savedSnapshot = await getLatestSavedSnapshot("FIXED_WATCHLIST");

    if (savedSnapshot) {
      return {
        ...savedSnapshot,
        persistenceStatus: "SAVED" as const,
      };
    }
  }

  if (process.env.YAHOO_FINANCE_ENABLED !== "true") {
    return undefined;
  }

  try {
    return {
      ...(await buildFixedWatchlistSnapshot()),
      persistenceStatus: isSupabaseConfigured()
        ? ("FAILED" as const)
        : ("DISABLED" as const),
    };
  } catch {
    return undefined;
  }
}

export async function buildLatestSnapshotWithFixed(): Promise<SnapshotResponse> {
  const [snapshot, fixedSnapshot] = await Promise.all([
    buildLatestSnapshot(),
    buildFixedSnapshotForLatest(),
  ]);

  if (!fixedSnapshot) {
    return snapshot;
  }

  return {
    ...snapshot,
    fixedSnapshot,
  };
}

export async function refreshDailySnapshot(): Promise<RefreshResult> {
  const liveMode = process.env.YAHOO_FINANCE_ENABLED === "true";
  const currentMarketSnapshot = await buildFreshMarketSnapshotForRefresh();
  const currentMode = currentMarketSnapshot.mode ?? "MARKET_SCAN";
  const snapshotDate = getSnapshotDate(new Date(currentMarketSnapshot.updatedAt));
  const previousMarketSnapshot =
    currentMode === "MARKET_SCAN"
      ? await getPreviousSnapshot("MARKET_SCAN", snapshotDate)
      : null;
  const marketSnapshot = applyRealRankMovement(
    currentMarketSnapshot,
    previousMarketSnapshot,
  );
  const fixedSnapshot = await buildFreshFixedSnapshotForRefresh();
  const marketSaveResult =
    currentMode === "MARKET_SCAN"
      ? await upsertTodaySnapshot(
          "MARKET_SCAN",
          withoutFixedSnapshot(marketSnapshot),
        )
      : { ok: false, disabled: !isSupabaseConfigured() };
  const fixedSaveResult = fixedSnapshot
    ? await upsertTodaySnapshot(
        "FIXED_WATCHLIST",
        withoutFixedSnapshot(fixedSnapshot),
      )
    : undefined;
  const persistenceStatus =
    marketSaveResult.disabled || fixedSaveResult?.disabled
      ? "DISABLED"
      : marketSaveResult.ok && (fixedSaveResult?.ok ?? true)
        ? "SAVED"
        : "FAILED";
  const snapshot: SnapshotResponse = {
    ...marketSnapshot,
    persistenceStatus,
    previousSnapshotFound: Boolean(previousMarketSnapshot),
    fixedSnapshot,
  };
  const usedLiveSnapshot =
    snapshot.status === "LIVE_MARKET" || snapshot.status === "PARTIAL_LIVE";

  return {
    ok: true,
    refreshedAt: new Date().toISOString(),
    dataMode: snapshot.dataMode,
    refreshMode: snapshot.refreshMode,
    status: snapshot.status,
    count: snapshot.count,
    persistenceStatus,
    previousSnapshotFound: Boolean(previousMarketSnapshot),
    droppedSymbols: snapshot.droppedSymbols,
    message: liveMode
      ? usedLiveSnapshot
        ? `V1.4 yahoo-finance2 refresh completed in ${snapshot.mode ?? snapshot.status} mode.`
        : "V1.4 yahoo-finance2 refresh failed; returned mock snapshot fallback."
      : "V1.0 mock snapshot refresh completed. Live yahoo-finance2 ingestion is not enabled.",
    snapshot,
  };
}
