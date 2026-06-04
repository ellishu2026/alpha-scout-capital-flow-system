import { mockSnapshot } from "@/data/mockSnapshot";
import {
  applyActionSignalsToItems,
  applyActionSignalsToSnapshot,
  buildActionSignalSummary,
  buildPositionActionSummary,
} from "@/lib/actionSignals";
import { applyFlowDataQualityMetadataToItems } from "@/lib/flowDataQualityTiers";
import {
  COVERAGE_MARKET_SCAN_LIMIT,
  buildFixedWatchlistSnapshot,
  buildMarketScanSnapshot,
  createRefreshTimeoutGuard,
  getRefreshTimeoutSummary,
  TOP_CANDIDATE_LIMIT,
  type RefreshTimeoutGuard,
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
import { upsertSignalSnapshots } from "@/lib/signalSnapshots";
import { isSupabaseConfigured } from "@/lib/supabaseAdmin";
import type {
  CoverageSourceBucket,
  FlowWindowCoverageSummary,
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

async function buildFreshMarketSnapshotForRefresh(
  guard?: RefreshTimeoutGuard,
  topN = COVERAGE_MARKET_SCAN_LIMIT,
): Promise<SnapshotResponse> {
  if (process.env.YAHOO_FINANCE_ENABLED === "true") {
    try {
      return await buildMarketScanSnapshot(topN, guard);
    } catch {
      try {
        return await buildFixedWatchlistSnapshot(guard);
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
  const qualityScores = coverageItems
    .map((candidate) => candidate.flowDataQualityScore)
    .filter(
      (score): score is number =>
        typeof score === "number" && Number.isFinite(score),
    );
  const dataQualitySummary = {
    gradeACount: coverageItems.filter(
      (candidate) => candidate.flowDataQualityGrade === "A",
    ).length,
    gradeBCount: coverageItems.filter(
      (candidate) => candidate.flowDataQualityGrade === "B",
    ).length,
    gradeCCount: coverageItems.filter(
      (candidate) => candidate.flowDataQualityGrade === "C",
    ).length,
    gradeDCount: coverageItems.filter(
      (candidate) => candidate.flowDataQualityGrade === "D",
    ).length,
    averageFlowDataQualityScore:
      qualityScores.length > 0
        ? Number(
            (
              qualityScores.reduce((sum, score) => sum + score, 0) /
              qualityScores.length
            ).toFixed(1),
          )
        : null,
    lowQualityTickers: coverageItems
      .filter(
        (candidate) =>
          candidate.flowDataQualityGrade === "C" ||
          candidate.flowDataQualityGrade === "D",
      )
      .map((candidate) => candidate.ticker),
    proxyDataTickers: coverageItems
      .filter(
        (candidate) =>
          candidate.capitalFlowDataSource === "YFINANCE_COMPOSITE_PROXY" ||
          candidate.capitalFlowDataSource === "YFINANCE_CHAIKIN",
      )
      .map((candidate) => candidate.ticker),
    staleDataTickers: coverageItems
      .filter((candidate) => {
        const freshness =
          candidate.flowDataQualityInputs?.providerFreshnessDays;

        return typeof freshness === "number" && freshness > 7;
      })
      .map((candidate) => candidate.ticker),
  };
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
    dataQualitySummary,
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

function buildFlowWindowCoverageSummary({
  marketItems,
  fixedItems,
}: {
  marketItems: StockCandidate[];
  fixedItems: StockCandidate[];
}): FlowWindowCoverageSummary {
  const topRankedTickers = marketItems.map((candidate) => candidate.ticker);
  const fixedWatchlistTickers = fixedItems.map((candidate) => candidate.ticker);
  const displayWindowTickerSet = new Set([
    ...topRankedTickers,
    ...fixedWatchlistTickers,
  ]);
  const displayItemsByTicker = new Map<string, StockCandidate>();

  for (const candidate of [...marketItems, ...fixedItems]) {
    displayItemsByTicker.set(candidate.ticker, candidate);
  }

  const displayItems = Array.from(displayItemsByTicker.values()).filter(
    (candidate) => displayWindowTickerSet.has(candidate.ticker),
  );
  const longWindowUnavailableTickers = displayItems
    .filter(
      (candidate) =>
        candidate.capitalFlow6W == null ||
        candidate.capitalFlow9W == null ||
        candidate.capitalFlow12W == null,
    )
    .map((candidate) => candidate.ticker);

  return {
    displayWindowTickerCount: displayWindowTickerSet.size,
    topRankedTickerCount: topRankedTickers.length,
    fixedWatchlistTickerCount: fixedWatchlistTickers.length,
    uniqueTickerCount: displayWindowTickerSet.size,
    extendedWindowCalculatedCount:
      displayItems.length - longWindowUnavailableTickers.length,
    extendedWindowUnavailableCount: longWindowUnavailableTickers.length,
    providerCallsUsedForDisplayWindows: 0,
    archiveHitCount: displayItems.filter(
      (candidate) => candidate.archiveStatus === "ARCHIVE_HIT",
    ).length,
    liveProviderCallCount: displayItems.filter(
      (candidate) =>
        candidate.providerUsed === "ALPHA_VANTAGE" ||
        candidate.providerUsed === "TWELVE_DATA" ||
        candidate.providerUsed === "EODHD" ||
        candidate.providerUsed === "POLYGON",
    ).length,
    longWindowUnavailableTickers,
  };
}

async function buildFreshFixedSnapshotForRefresh(guard?: RefreshTimeoutGuard) {
  if (process.env.YAHOO_FINANCE_ENABLED !== "true") {
    return undefined;
  }

  try {
    return await buildFixedWatchlistSnapshot(guard);
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

export async function refreshDailySnapshot({
  topN = COVERAGE_MARKET_SCAN_LIMIT,
}: {
  topN?: number;
} = {}): Promise<RefreshResult> {
  const timeoutGuard = createRefreshTimeoutGuard();
  const liveMode = process.env.YAHOO_FINANCE_ENABLED === "true";
  const freshFixedSnapshot =
    await buildFreshFixedSnapshotForRefresh(timeoutGuard);
  const marketCoverageSnapshot =
    await buildFreshMarketSnapshotForRefresh(timeoutGuard, topN);
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
  const marketSnapshotWithActions =
    applyActionSignalsToSnapshot(marketSnapshotWithBuckets);
  const fixedSnapshotWithActions = fixedSnapshot
    ? applyActionSignalsToSnapshot(fixedSnapshot)
    : undefined;
  const marketTop15ItemsWithActions =
    applyActionSignalsToItems(marketTop15Items);
  const providerCoverageSummary = buildProviderCoverageSummary({
    fixedSnapshot: fixedSnapshotWithActions,
    marketTop15Items: marketTop15ItemsWithActions,
  });
  const flowWindowCoverageSummary = buildFlowWindowCoverageSummary({
    marketItems: marketSnapshotWithActions.items,
    fixedItems: fixedSnapshotWithActions?.items ?? [],
  });
  const actionSignalSummary = buildActionSignalSummary(
    marketSnapshotWithActions.items,
  );
  const positionActionSummary = buildPositionActionSummary(
    marketSnapshotWithActions.items,
  );
  const marketSnapshotForSave = {
    ...attachProviderCoverageSummary(
      timeoutGuard.triggered
        ? {
            ...marketSnapshotWithActions,
            status: "PARTIAL_LIVE_TIMEOUT_GUARDED",
          }
        : marketSnapshotWithActions,
      providerCoverageSummary,
    ),
    actionSignalSummary,
    entryActionSummary: actionSignalSummary,
    positionActionSummary,
    universeCoverageSummary: marketCoverageSnapshot.universeCoverageSummary,
    flowWindowCoverageSummary,
  };
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
          attachProviderCoverageSummary(
            {
              ...(fixedSnapshotWithActions ?? fixedSnapshot),
              actionSignalSummary: buildActionSignalSummary(
                (fixedSnapshotWithActions ?? fixedSnapshot).items,
              ),
              entryActionSummary: buildActionSignalSummary(
                (fixedSnapshotWithActions ?? fixedSnapshot).items,
              ),
              positionActionSummary: buildPositionActionSummary(
                (fixedSnapshotWithActions ?? fixedSnapshot).items,
              ),
              flowWindowCoverageSummary,
            },
            providerCoverageSummary,
          ),
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
  const timeoutSummary = getRefreshTimeoutSummary({
    guard: timeoutGuard,
    finalCoverageTickerCount: providerCoverageSummary.dedupedCoverageCount,
    fixedWatchlistTickerCount:
      timeoutGuard.fixedWatchlistTickers.size ||
      fixedSnapshot?.scannedCount ||
      fixedSnapshot?.items.length ||
      0,
    marketScanTickerCount:
      timeoutGuard.marketScanTickers.size ||
      (marketCoverageSnapshot.mode === "MARKET_SCAN"
        ? marketCoverageSnapshot.scannedCount ??
          marketCoverageSnapshot.items.length
        : marketTop15Items.length),
    dedupedCoverageTickerCount: providerCoverageSummary.dedupedCoverageCount,
  });
  const snapshotWithoutSignalStatus: SnapshotResponse = {
    ...marketSnapshotForSave,
    persistenceStatus,
    previousSnapshotFound: Boolean(previousMarketSnapshot),
    persistenceError: persistenceIssue?.error,
    persistenceErrorCode: persistenceIssue?.errorCode,
    persistenceErrorDetails: persistenceIssue?.errorDetails,
    fixedSnapshot: fixedSnapshotWithActions,
    actionSignalSummary,
    entryActionSummary: actionSignalSummary,
    positionActionSummary,
    ...timeoutSummary,
  };
  const signalSnapshotResult = await upsertSignalSnapshots({
    marketSnapshot:
      marketCoverageSnapshot.mode === "MARKET_SCAN"
        ? {
            ...marketCoverageSnapshot,
            items: marketTop15ItemsWithActions,
          }
        : undefined,
    fixedSnapshot:
      fixedSnapshotWithActions ?? snapshotWithoutSignalStatus.fixedSnapshot,
    fallbackSnapshot: snapshotWithoutSignalStatus,
  });
  const signalSnapshotFields = {
    signalSnapshotPersistenceStatus: signalSnapshotResult.status,
    signalSnapshotRowsSaved: signalSnapshotResult.rowsSaved,
    signalSnapshotError: signalSnapshotResult.error,
    signalSnapshotLatestDate: signalSnapshotResult.latestSignalDate,
    signalSnapshotCoverageSummary: signalSnapshotResult.coverageSummary,
  };
  const snapshot: SnapshotResponse = {
    ...snapshotWithoutSignalStatus,
    ...signalSnapshotFields,
  };

  if (currentMode === "MARKET_SCAN" && marketSaveResult.ok) {
    await upsertTodaySnapshot("MARKET_SCAN", withoutFixedSnapshot(snapshot));
  }

  const usedLiveSnapshot =
    snapshot.status === "LIVE_MARKET" ||
    snapshot.status === "PARTIAL_LIVE" ||
    snapshot.status === "PARTIAL_LIVE_TIMEOUT_GUARDED";
  const outputSnapshot: SnapshotResponse = {
    ...snapshot,
    items: applyFlowDataQualityMetadataToItems(snapshot.items),
    fixedSnapshot: snapshot.fixedSnapshot
      ? {
          ...snapshot.fixedSnapshot,
          items: applyFlowDataQualityMetadataToItems(snapshot.fixedSnapshot.items),
        }
      : undefined,
  };

  return {
    ok: true,
    refreshedAt: new Date().toISOString(),
    dataMode: outputSnapshot.dataMode,
    refreshMode: outputSnapshot.refreshMode,
    status: outputSnapshot.status,
    count: outputSnapshot.count,
    persistenceStatus,
    previousSnapshotFound: Boolean(previousMarketSnapshot),
    droppedSymbols: snapshot.droppedSymbols,
    persistenceError: snapshot.persistenceError,
    persistenceErrorCode: snapshot.persistenceErrorCode,
    persistenceErrorDetails: snapshot.persistenceErrorDetails,
    providerCoverageSummary,
    universeCoverageSummary: marketCoverageSnapshot.universeCoverageSummary,
    flowWindowCoverageSummary,
    actionSignalSummary,
    entryActionSummary: actionSignalSummary,
    positionActionSummary,
    ...signalSnapshotFields,
    ...timeoutSummary,
    message: liveMode
      ? usedLiveSnapshot
        ? timeoutSummary.timeoutGuardTriggered
          ? `V1.6.7.2 refresh completed with timeout guard after ${timeoutSummary.elapsedMs}ms.`
          : `V1.6.7.2 refresh completed in ${snapshot.mode ?? snapshot.status} mode.`
        : "V1.4 yahoo-finance2 refresh failed; returned mock snapshot fallback."
      : "V1.0 mock snapshot refresh completed. Live yahoo-finance2 ingestion is not enabled.",
    snapshot: outputSnapshot,
  };
}
