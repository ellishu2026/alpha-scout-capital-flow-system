import { mockSnapshot } from "@/data/mockSnapshot";
import {
  COVERAGE_MARKET_SCAN_LIMIT,
  buildFixedWatchlistSnapshot,
  buildMarketScanSnapshot,
  TOP_CANDIDATE_LIMIT,
} from "@/lib/liveMarketData";
import {
  getPolygonLiveEnabled,
  getProviderBudgetSummary,
} from "@/lib/marketDataProviders";
import { applyRealRankMovement } from "@/lib/rankMovement";
import {
  getLatestSnapshot as getLatestSavedSnapshot,
  getPreviousSnapshot,
  getSnapshotDate,
  type SnapshotStoreWriteResult,
  upsertTodaySnapshot,
} from "@/lib/snapshotStore";
import { isSupabaseConfigured } from "@/lib/supabaseAdmin";
import type {
  CoverageSourceBucket,
  ProviderCoverageSummary,
  RefreshResult,
  SnapshotResponse,
  StockCandidate,
} from "@/types/stock";

function withoutFixedSnapshot(snapshot: SnapshotResponse): SnapshotResponse {
  const snapshotWithoutFixed = { ...snapshot };
  delete snapshotWithoutFixed.fixedSnapshot;

  return snapshotWithoutFixed;
}

async function buildFreshMarketSnapshotForRefresh(): Promise<SnapshotResponse> {
  if (process.env.YAHOO_FINANCE_ENABLED === "true") {
    try {
      return await buildMarketScanSnapshot(COVERAGE_MARKET_SCAN_LIMIT);
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

function withTopCandidateLimit(snapshot: SnapshotResponse) {
  return {
    ...snapshot,
    count: Math.min(snapshot.items.length, TOP_CANDIDATE_LIMIT),
    items: snapshot.items.slice(0, TOP_CANDIDATE_LIMIT),
  };
}

function coverageBucketForTicker({
  ticker,
  fixedTickers,
  marketTickers,
}: {
  ticker: string;
  fixedTickers: Set<string>;
  marketTickers: Set<string>;
}): CoverageSourceBucket {
  const inFixed = fixedTickers.has(ticker);
  const inMarket = marketTickers.has(ticker);

  if (inFixed && inMarket) return "BOTH";
  if (inFixed) return "FIXED_WATCHLIST";
  return "MARKET_SCAN_TOP15";
}

function annotateCoverageBuckets({
  marketSnapshot,
  fixedSnapshot,
  marketTop15Items,
}: {
  marketSnapshot: SnapshotResponse;
  fixedSnapshot?: SnapshotResponse;
  marketTop15Items: StockCandidate[];
}) {
  const fixedTickers = new Set(
    fixedSnapshot?.items.map((candidate) => candidate.ticker) ?? [],
  );
  const marketTickers = new Set(
    marketTop15Items.map((candidate) => candidate.ticker),
  );

  return {
    marketSnapshot: {
      ...marketSnapshot,
      items: marketSnapshot.items.map((candidate) => ({
        ...candidate,
        sourceBucket: coverageBucketForTicker({
          ticker: candidate.ticker,
          fixedTickers,
          marketTickers,
        }),
      })),
    },
    fixedSnapshot: fixedSnapshot
      ? {
          ...fixedSnapshot,
          items: fixedSnapshot.items.map((candidate) => ({
            ...candidate,
            sourceBucket: coverageBucketForTicker({
              ticker: candidate.ticker,
              fixedTickers,
              marketTickers,
            }),
          })),
        }
      : undefined,
    marketTop15Items: marketTop15Items.map((candidate) => ({
      ...candidate,
      sourceBucket: coverageBucketForTicker({
        ticker: candidate.ticker,
        fixedTickers,
        marketTickers,
      }),
    })),
  };
}

function buildProviderCoverageSummary({
  fixedSnapshot,
  marketTop15Items,
}: {
  fixedSnapshot?: SnapshotResponse;
  marketTop15Items: StockCandidate[];
}): ProviderCoverageSummary {
  const coverageByTicker = new Map<string, StockCandidate>();
  const fixedItems = fixedSnapshot?.items ?? [];
  const providerCoverageRank = (candidate: StockCandidate) => {
    if (candidate.archiveStatus === "ARCHIVE_HIT") return 3;
    if (
      candidate.providerUsed === "ALPHA_VANTAGE" ||
      candidate.providerUsed === "TWELVE_DATA" ||
      candidate.providerUsed === "EODHD" ||
      candidate.providerUsed === "POLYGON"
    ) {
      return 2;
    }
    if (candidate.capitalFlowDataSource === "YFINANCE_CHAIKIN") return 1;
    return 0;
  };
  const keepBetterCoverage = (
    current: StockCandidate | undefined,
    next: StockCandidate,
  ) => {
    if (!current) return next;

    return providerCoverageRank(next) > providerCoverageRank(current)
      ? { ...current, ...next }
      : { ...next, ...current };
  };

  for (const candidate of fixedItems) {
    coverageByTicker.set(candidate.ticker, candidate);
  }

  for (const candidate of marketTop15Items) {
    coverageByTicker.set(
      candidate.ticker,
      keepBetterCoverage(coverageByTicker.get(candidate.ticker), candidate),
    );
  }

  const coverageItems = Array.from(coverageByTicker.values());
  const archiveHitTickers = coverageItems
    .filter((candidate) => candidate.archiveStatus === "ARCHIVE_HIT")
    .map((candidate) => candidate.ticker);
  const alphaVantageLiveTickers = coverageItems
    .filter((candidate) => candidate.providerUsed === "ALPHA_VANTAGE")
    .map((candidate) => candidate.ticker);
  const twelveDataLiveTickers = coverageItems
    .filter((candidate) => candidate.providerUsed === "TWELVE_DATA")
    .map((candidate) => candidate.ticker);
  const eodhdLiveTickers = coverageItems
    .filter((candidate) => candidate.providerUsed === "EODHD")
    .map((candidate) => candidate.ticker);
  const polygonLiveTickers = coverageItems
    .filter((candidate) => candidate.providerUsed === "POLYGON")
    .map((candidate) => candidate.ticker);
  const yfinanceFallbackTickers = coverageItems
    .filter(
      (candidate) =>
        candidate.capitalFlowDataSource === "YFINANCE_CHAIKIN" ||
        candidate.capitalFlowDataSource === "YFINANCE_COMPOSITE_PROXY",
    )
    .map((candidate) => candidate.ticker);
  const compositeProxyFallbackTickers = coverageItems
    .filter(
      (candidate) =>
        candidate.capitalFlowDataSource === "YFINANCE_COMPOSITE_PROXY",
    )
    .map((candidate) => candidate.ticker);
  const providerErrorTickers = coverageItems
    .filter((candidate) => (candidate.providerErrors?.length ?? 0) > 0)
    .map((candidate) => candidate.ticker);
  const providerBudget = getProviderBudgetSummary();
  const realProviderCoverageCount =
    archiveHitTickers.length +
    alphaVantageLiveTickers.length +
    twelveDataLiveTickers.length +
    eodhdLiveTickers.length +
    polygonLiveTickers.length;
  const totalTickers = coverageItems.length;

  return {
    totalTickers,
    fixedListCount: fixedItems.length,
    marketScanTop15Count: marketTop15Items.length,
    dedupedCoverageCount: totalTickers,
    archiveHitCount: archiveHitTickers.length,
    alphaVantageLiveCount: alphaVantageLiveTickers.length,
    twelveDataLiveCount: twelveDataLiveTickers.length,
    eodhdLiveCount: eodhdLiveTickers.length,
    polygonLiveCount: polygonLiveTickers.length,
    yfinanceFallbackCount: yfinanceFallbackTickers.length,
    compositeProxyFallbackCount: compositeProxyFallbackTickers.length,
    realProviderCoverageCount,
    realProviderCoveragePct:
      totalTickers > 0
        ? Number(((realProviderCoverageCount / totalTickers) * 100).toFixed(1))
        : 0,
    providerCallsUsed: {
      polygon: providerBudget.polygon.callsUsed,
      alphaVantage: providerBudget.alphaVantage.callsUsed,
      twelveData: providerBudget.twelveData.callsUsed,
      eodhd: providerBudget.eodhd.callsUsed,
    },
    providerCallsRemaining: {
      polygon: providerBudget.polygon.remaining,
      alphaVantage: providerBudget.alphaVantage.remaining,
      twelveData: providerBudget.twelveData.remaining,
      eodhd: providerBudget.eodhd.remaining,
    },
    polygonLiveEnabled: getPolygonLiveEnabled(),
    archiveHitTickers,
    alphaVantageLiveTickers,
    twelveDataLiveTickers,
    eodhdLiveTickers,
    polygonLiveTickers,
    yfinanceFallbackTickers,
    compositeProxyFallbackTickers,
    providerErrorTickers,
  };
}

function attachProviderCoverageSummary(
  snapshot: SnapshotResponse,
  providerCoverageSummary?: ProviderCoverageSummary,
): SnapshotResponse {
  if (!providerCoverageSummary) {
    return snapshot;
  }

  return {
    ...snapshot,
    providerCoverageSummary,
    realProviderCoveragePct: providerCoverageSummary.realProviderCoveragePct,
    archiveHitCount: providerCoverageSummary.archiveHitCount,
    liveProviderSuccessCount:
      providerCoverageSummary.alphaVantageLiveCount +
      providerCoverageSummary.twelveDataLiveCount +
      providerCoverageSummary.eodhdLiveCount +
      providerCoverageSummary.polygonLiveCount,
    fallbackToYfinanceCount: providerCoverageSummary.yfinanceFallbackCount,
    providerCallsUsed: providerCoverageSummary.providerCallsUsed,
    providerCallsRemaining: providerCoverageSummary.providerCallsRemaining,
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
  const marketCoverageSnapshot = await buildFreshMarketSnapshotForRefresh();
  const currentMarketSnapshot = withTopCandidateLimit(marketCoverageSnapshot);
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
  const freshFixedSnapshot = await buildFreshFixedSnapshotForRefresh();
  const {
    marketSnapshot: marketSnapshotWithBuckets,
    fixedSnapshot,
    marketTop15Items,
  } = annotateCoverageBuckets({
    marketSnapshot,
    fixedSnapshot: freshFixedSnapshot,
    marketTop15Items:
      marketCoverageSnapshot.mode === "MARKET_SCAN"
        ? marketCoverageSnapshot.items
        : currentMarketSnapshot.items,
  });
  const providerCoverageSummary = buildProviderCoverageSummary({
    fixedSnapshot,
    marketTop15Items,
  });
  const marketSnapshotForSave = attachProviderCoverageSummary(
    marketSnapshotWithBuckets,
    providerCoverageSummary,
  );
  const marketSaveResult =
    currentMode === "MARKET_SCAN"
      ? await upsertTodaySnapshot(
          "MARKET_SCAN",
          withoutFixedSnapshot(marketSnapshotForSave),
        )
      : ({
          ok: false,
          status: isSupabaseConfigured() ? "FAILED" : "DISABLED",
          error:
            currentMode === "FIXED_WATCHLIST"
              ? "Market scan failed; fixed-watchlist fallback was not saved as MARKET_SCAN."
              : "Market scan failed; mock fallback was not saved as MARKET_SCAN.",
          errorCode: "MARKET_SCAN_UNAVAILABLE",
        } satisfies SnapshotStoreWriteResult);
  const fixedSaveResult = fixedSnapshot
    ? await upsertTodaySnapshot(
        "FIXED_WATCHLIST",
        withoutFixedSnapshot(
          attachProviderCoverageSummary(fixedSnapshot, providerCoverageSummary),
        ),
      )
    : undefined;
  const failedSaveResult = [marketSaveResult, fixedSaveResult].find(
    (result) => result?.status === "FAILED",
  );
  const disabledSaveResult = [marketSaveResult, fixedSaveResult].find(
    (result) => result?.status === "DISABLED",
  );
  const persistenceStatus =
    failedSaveResult
      ? "FAILED"
      : disabledSaveResult
      ? "DISABLED"
      : marketSaveResult.ok && (fixedSaveResult?.ok ?? true)
        ? "SAVED"
        : "FAILED";
  const persistenceIssue = failedSaveResult ?? disabledSaveResult;
  const snapshot: SnapshotResponse = {
    ...marketSnapshotForSave,
    persistenceStatus,
    previousSnapshotFound: Boolean(previousMarketSnapshot),
    persistenceError: persistenceIssue?.error,
    persistenceErrorCode: persistenceIssue?.errorCode,
    persistenceErrorDetails: persistenceIssue?.errorDetails,
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
    persistenceError: snapshot.persistenceError,
    persistenceErrorCode: snapshot.persistenceErrorCode,
    persistenceErrorDetails: snapshot.persistenceErrorDetails,
    providerCoverageSummary,
    message: liveMode
      ? usedLiveSnapshot
        ? `V1.4 yahoo-finance2 refresh completed in ${snapshot.mode ?? snapshot.status} mode.`
        : "V1.4 yahoo-finance2 refresh failed; returned mock snapshot fallback."
      : "V1.0 mock snapshot refresh completed. Live yahoo-finance2 ingestion is not enabled.",
    snapshot,
  };
}
