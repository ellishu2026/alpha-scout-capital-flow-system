export type StockPool = "MID_CAP" | "HIGH_PRICE" | "OVERLAP" | "WATCHLIST";

export type DataStatus =
  | "HIGH"
  | "MID"
  | "LOW"
  | "LIVE_MARKET"
  | "PARTIAL_LIVE"
  | "PARTIAL_LIVE_TIMEOUT_GUARDED"
  | "MOCK";

export type RankChangeType = "NEW" | "UP" | "DOWN" | "SAME";

export type SnapshotMode = "MARKET_SCAN" | "FIXED_WATCHLIST" | "MOCK";

export type PersistenceStatus = "SAVED" | "DISABLED" | "FAILED";
export type CapitalFlowDataSource =
  | "YFINANCE_CHAIKIN"
  | "YFINANCE_COMPOSITE_PROXY"
  | "ALPHA_VANTAGE"
  | "TWELVE_DATA"
  | "EODHD"
  | "POLYGON"
  | "MOCK";
export type ProviderUsed =
  | CapitalFlowDataSource
  | "ALPHA_VANTAGE_ARCHIVE"
  | "TWELVE_DATA_ARCHIVE"
  | "EODHD_ARCHIVE"
  | "POLYGON_ARCHIVE";
export type ArchiveHitProvider =
  | "POLYGON"
  | "ALPHA_VANTAGE"
  | "TWELVE_DATA"
  | "EODHD"
  | null;
export type CapitalFlowQuality = "LIVE_PROXY" | "REAL_PROVIDER" | "MOCK" | "FALLBACK";
export type CoverageSourceBucket =
  | "FIXED_WATCHLIST"
  | "MARKET_SCAN_TOP15"
  | "BOTH";
export type UniverseSourceBucket =
  | "FIXED_WATCHLIST"
  | "MARKET_CAP_50B_300B"
  | "HIGH_PRICE_OVER_800"
  | "MULTI_BUCKET";
export type FlowDataQualityGrade = "A" | "B" | "C" | "D";
export type ActionSignal =
  | "Buy Candidate"
  | "Watch"
  | "Avoid"
  | "Insufficient Data";
export type ActionConfidence = "High" | "Medium" | "Low";
export type PositionActionSignal =
  | "Hold"
  | "Reduce"
  | "Sell Candidate"
  | "Exit"
  | "Insufficient Data";

export type FlowDataQualityInputs = {
  providerUsed?: ProviderUsed;
  capitalFlowDataSource?: CapitalFlowDataSource;
  capitalFlowQuality?: CapitalFlowQuality;
  providerEndpointType?: string;
  archiveStatus?: string;
  archiveHitProvider?: ArchiveHitProvider;
  flowDataUpdatedAt?: string;
  rawProviderLatestDate?: string;
  providerFreshnessDays: number | null;
  archiveAgeDays: number | null;
  isArchive: boolean;
  isLiveProvider: boolean;
  isCompositeProxy: boolean;
  hasFullOHLCV: boolean;
  hasVolume: boolean;
  recentDailyFlowCount: number;
  expectedMinimumDailyFlowCount: number;
};

export type FinancialDataSource = "SEC" | "FALLBACK" | "N/A";
export type FinancialPeriodType =
  | "QUARTER"
  | "YTD_NORMALIZED"
  | "ANNUAL"
  | "UNKNOWN";
export type PreviousQuarterMethod =
  | "DIRECT_QUARTER"
  | "FY_MINUS_Q3_YTD"
  | "YTD_DIFF"
  | "UNAVAILABLE";

export type SelectedFinancialPeriod = {
  tag?: string;
  start?: string;
  form?: string;
  fp?: string;
  filed?: string;
  end?: string;
  frame?: string;
  val?: number;
  periodType?: FinancialPeriodType;
};

export type SelectedFinancialPeriods = {
  operatingCashFlow?: SelectedFinancialPeriod;
  capex?: SelectedFinancialPeriod;
  revenue?: SelectedFinancialPeriod;
  marginIncome?: SelectedFinancialPeriod;
  previousOperatingCashFlow?: SelectedFinancialPeriod;
  previousCapex?: SelectedFinancialPeriod;
};

export type PreviousQuarterSearch = {
  triedDirectQuarter: boolean;
  triedYtdDiff: boolean;
  triedFyMinusQ3Ytd: boolean;
  failureReason?: string;
};

export type PreviousQuarterSelectedPeriods = {
  ocfCurrent?: SelectedFinancialPeriod;
  capexCurrent?: SelectedFinancialPeriod;
  ocfPriorForDiff?: SelectedFinancialPeriod;
  capexPriorForDiff?: SelectedFinancialPeriod;
  fyOcf?: SelectedFinancialPeriod;
  fyCapex?: SelectedFinancialPeriod;
  q3YtdOcf?: SelectedFinancialPeriod;
  q3YtdCapex?: SelectedFinancialPeriod;
};

export type FyMinusQ3YtdCandidates = {
  fyOcfCandidates: SelectedFinancialPeriod[];
  fyCapexCandidates: SelectedFinancialPeriod[];
  q3YtdOcfCandidates: SelectedFinancialPeriod[];
  q3YtdCapexCandidates: SelectedFinancialPeriod[];
  rejectionReasons: string[];
};

export type StockCandidate = {
  rank: number;
  previousRank?: number | null;
  rankChange?: number | null;
  changeLabel?: string;
  changeType?: RankChangeType;
  ticker: string;
  companyName: string;
  pool: StockPool;
  marketCap: number;
  price: number;
  fcf: number;
  fcfQoqChange: number | null;
  capitalFlow3D: number;
  capitalFlow5D: number;
  capitalFlow9D: number;
  capitalFlow3W: number;
  capitalFlow5W: number;
  legacyCapitalFlow3D?: number;
  legacyCapitalFlow5D?: number;
  legacyCapitalFlow9D?: number;
  legacyCapitalFlow3W?: number;
  legacyCapitalFlow5W?: number;
  compositeScore: number;
  marginScore: number;
  fcfScore: number;
  capitalFlowScore: number;
  marginChange: number | null;
  cashFlowChangeRatio: number | null;
  capitalFlowChangeRatio: number;
  signal: string;
  dataStatus: DataStatus;
  financialDataSource?: FinancialDataSource;
  financialUpdatedAt?: string;
  currentMargin?: number | null;
  previousMargin?: number | null;
  previousFcf?: number | null;
  financialError?: string;
  selectedFinancialPeriods?: SelectedFinancialPeriods;
  staleDataRejected?: boolean;
  financialPeriodType?: FinancialPeriodType;
  currentQuarterFcf?: number | null;
  previousQuarterFcf?: number | null;
  secSelectedPeriodEnd?: string | null;
  secSelectedPeriodFiled?: string | null;
  secNormalizationNote?: string;
  fcfQoqRaw?: number | null;
  fcfQoqScoreInput?: number | null;
  marginChangeRaw?: number | null;
  marginChangeScoreInput?: number | null;
  financialScoreNote?: string;
  capexMissingFresh?: boolean;
  availableCapexCandidateTags?: string[];
  previousQuarterMethod?: PreviousQuarterMethod;
  previousQuarterSearch?: PreviousQuarterSearch;
  previousQuarterSelectedPeriods?: PreviousQuarterSelectedPeriods;
  fyMinusQ3YtdCandidates?: FyMinusQ3YtdCandidates;
  flowCalculationVersion?:
    | "V1.6.1_CHAIKIN"
    | "V1.6.2_NORMALIZED_CHAIKIN"
    | "V1.6.3_REAL_PROVIDER_CHAIKIN"
    | "V1.6.3_YFINANCE_CHAIKIN"
    | "V1.6.3.1_REAL_PROVIDER_CHAIKIN"
    | "V1.6.3.1_YFINANCE_CHAIKIN"
    | "V1.6.4_REAL_PROVIDER_CHAIKIN"
    | "V1.6.4_YFINANCE_CHAIKIN"
    | "V1.6.4.1_ARCHIVE_PROVIDER_CHAIKIN"
    | "V1.6.4.1_REAL_PROVIDER_CHAIKIN"
    | "V1.6.4.1_YFINANCE_CHAIKIN"
    | "V1.6.5_ARCHIVE_PROVIDER_CHAIKIN"
    | "V1.6.5_REAL_PROVIDER_CHAIKIN"
    | "V1.6.5_YFINANCE_CHAIKIN"
    | "V1.6.5.1_ARCHIVE_PROVIDER_CHAIKIN"
    | "V1.6.5.1_REAL_PROVIDER_CHAIKIN"
    | "V1.6.5.1_YFINANCE_CHAIKIN"
    | "V1.6.6_COMPOSITE_PROXY"
    | "V1.6.7_PROVIDER_LADDER_CHAIKIN"
    | "V1.6.7_COMPOSITE_PROXY"
    | "V1.6.7.1_PROVIDER_LADDER_CHAIKIN"
    | "V1.6.7.1_COMPOSITE_PROXY"
    | "V1.6.7.2_PROVIDER_LADDER_CHAIKIN"
    | "V1.6.7.2_COMPOSITE_PROXY"
    | "V1.6.8_PROVIDER_LADDER_CHAIKIN"
    | "V1.6.8_COMPOSITE_PROXY";
  sourceBucket?: CoverageSourceBucket;
  capitalFlowDataSource?: CapitalFlowDataSource;
  capitalFlowQuality?: CapitalFlowQuality;
  providerUsed?: ProviderUsed;
  providerPriorityTried?: string[];
  providerErrors?: string[];
  providerEndpointType?: string;
  archiveLookupTried?: boolean;
  archiveProviderChecked?: string[];
  archiveHitProvider?: ArchiveHitProvider;
  archiveStatus?: string;
  rawProviderPayloadSummary?: Record<string, unknown>;
  moneyFlowMultiplierLatest?: number | null;
  chaikinDailyFlowLatest?: number | null;
  compositeDailyFlowLatest?: number | null;
  priceChangeWeightedFlowLatest?: number | null;
  mfiLikeFlowLatest?: number | null;
  obvDirectionalFlowLatest?: number | null;
  compositeFlowWeights?: {
    chaikin: number;
    priceChangeWeighted: number;
    mfiLike: number;
    obvDirectional: number;
  };
  flowDataUpdatedAt?: string;
  avgDollarVolume20D?: number | null;
  flow3DToMarketCapPct?: number | null;
  flow5DToMarketCapPct?: number | null;
  flow9DToMarketCapPct?: number | null;
  flow3WToMarketCapPct?: number | null;
  flow5WToMarketCapPct?: number | null;
  flow3DToAvgDollarVolume?: number | null;
  flow5DToAvgDollarVolume?: number | null;
  flow9DToAvgDollarVolume?: number | null;
  flow3WToAvgDollarVolume?: number | null;
  flow5WToAvgDollarVolume?: number | null;
  flowConsistency9D?: number;
  flowDirectionBreadth?: number;
  shortTermFlowAcceleration?: number | null;
  normalizedFlowScore?: number;
  rawFlowScore?: number;
  flowDataQualityScore?: number;
  flowDataQualityGrade?: FlowDataQualityGrade;
  flowDataQualityReasons?: string[];
  flowDataQualityInputs?: FlowDataQualityInputs;
  entryActionSignal?: ActionSignal;
  entryActionConfidence?: ActionConfidence;
  positionActionSignal?: PositionActionSignal;
  positionActionConfidence?: ActionConfidence;
  actionSignal?: ActionSignal;
  actionConfidence?: ActionConfidence;
  actionReasons?: string[];
  actionRiskFlags?: string[];
};

export type ProviderCoverageSummary = {
  totalTickers: number;
  fixedListCount: number;
  marketScanTop15Count: number;
  dedupedCoverageCount: number;
  archiveHitCount: number;
  alphaVantageLiveCount: number;
  twelveDataLiveCount: number;
  eodhdLiveCount: number;
  polygonLiveCount: number;
  yfinanceFallbackCount: number;
  compositeProxyFallbackCount: number;
  realProviderCoverageCount: number;
  realProviderCoveragePct: number;
  providerCallsUsed: {
    polygon: number;
    alphaVantage: number;
    twelveData: number;
    eodhd: number;
  };
  providerCallsRemaining: {
    polygon: number;
    alphaVantage: number;
    twelveData: number;
    eodhd: number;
  };
  polygonLiveEnabled: boolean;
  archiveHitTickers: string[];
  alphaVantageLiveTickers: string[];
  twelveDataLiveTickers: string[];
  eodhdLiveTickers: string[];
  polygonLiveTickers: string[];
  yfinanceFallbackTickers: string[];
  compositeProxyFallbackTickers: string[];
  providerErrorTickers: string[];
  dataQualitySummary?: {
    gradeACount: number;
    gradeBCount: number;
    gradeCCount: number;
    gradeDCount: number;
    averageFlowDataQualityScore: number | null;
    lowQualityTickers: string[];
    proxyDataTickers: string[];
    staleDataTickers: string[];
  };
};

export type UniverseCoverageSummary = {
  fixedWatchlistCount: number;
  marketCap50To300BPoolCount: number;
  highPriceOver800PoolCount: number;
  mergedUniverseCount: number;
  dedupedUniverseCount: number;
  lightFilterTickerCount: number;
  deepScoringCandidateCount: number;
  deepScoringSkippedCount: number;
  scanCandidateCount: number;
  finalRankedCount: number;
  topN: number;
  overlappingTickerCount: number;
  overlappingTickers: string[];
  missingMarketCapCount: number;
  missingMarketCapTickers: string[];
  missingPriceCount: number;
  missingPriceTickers: string[];
  failedQuoteCount: number;
  failedQuoteTickers: string[];
  skippedByTimeoutCount: number;
  skippedByTimeoutTickers: string[];
  providerQuotaExhaustedCount: number;
  providerQuotaExhaustedTickers: string[];
  yfinanceProxyFallbackCount: number;
  yfinanceProxyFallbackTickers: string[];
  includedSourceBuckets: UniverseSourceBucket[];
  universeBuildVersion: string;
  marketCap50To300BTickers: string[];
  highPriceOver800Tickers: string[];
  dedupedUniverseSampleTickers: string[];
};

export type UniverseDebugRow = {
  ticker: string;
  companyName?: string;
  price: number | null;
  marketCap: number | null;
  sourceBucket: UniverseSourceBucket;
  sourceBuckets: Exclude<UniverseSourceBucket, "MULTI_BUCKET">[];
  includedByMarketCapRange: boolean;
  includedByHighPrice: boolean;
  includedByFixedWatchlist: boolean;
  quoteStatus: "OK" | "FAILED" | "SKIPPED_TIMEOUT";
  missingReason?: string;
};

export type SignalSnapshotCoverageSummary = {
  fixedWatchlistRowsSaved: number;
  marketScanRowsSaved: number;
  fallbackRowsSaved: number;
  totalRowsSaved: number;
  uniqueTickersSaved: number;
  overlappingTickers: string[];
  fixedWatchlistTickers: string[];
  marketScanTickers: string[];
};

export type ActionSignalSummary = {
  buyCandidateCount: number;
  watchCount: number;
  avoidCount: number;
  insufficientDataCount: number;
  buyCandidateTickers: string[];
  watchTickers: string[];
  avoidTickers: string[];
  insufficientDataTickers: string[];
};

export type PositionActionSummary = {
  holdCount: number;
  reduceCount: number;
  sellCandidateCount: number;
  exitCount: number;
  insufficientDataCount: number;
  holdTickers: string[];
  reduceTickers: string[];
  sellCandidateTickers: string[];
  exitTickers: string[];
  insufficientDataTickers: string[];
};

export type ForwardReturnUpdateStatus =
  | "UPDATED"
  | "PARTIAL_UPDATED"
  | "NO_ELIGIBLE_ROWS"
  | "FAILED";

export type ForwardWindowStats = {
  sampleCount: number;
  winCount: number;
  lossCount: number;
  winRatePct: number | null;
  avgReturnPct: number | null;
  medianReturnPct: number | null;
  bestReturnPct: number | null;
  worstReturnPct: number | null;
};

export type WinRateGroupSummary = {
  groupName: string;
  totalSignals: number;
  availableSamplesByWindow: {
    forward1D: number;
    forward3D: number;
    forward5D: number;
    forward10D: number;
    forward20D: number;
  };
  forward1D: ForwardWindowStats;
  forward3D: ForwardWindowStats;
  forward5D: ForwardWindowStats;
  forward10D: ForwardWindowStats;
  forward20D: ForwardWindowStats;
};

export type CalibrationReadiness = {
  totalSignals: number;
  availableForwardReturnRows: number;
  insufficientForwardReturnRows: number;
  minRecommendedSamples: number;
  isReadyForRuleCalibration: boolean;
  readyWindows: Array<
    "forward1D" | "forward3D" | "forward5D" | "forward10D" | "forward20D"
  >;
  notReadyReason: string | null;
};

export type CalibrationSimulation = {
  isReady: boolean;
  minRecommendedSamples: number;
  availableForwardReturnRows: number;
  candidateRuleSetsEvaluated: number;
  bestCandidateRuleSet: Record<string, unknown> | null;
  productionRuleSet: string;
  recommendation: string;
  notReadyReason: string | null;
};

export type WinRateReport = {
  ok: boolean;
  filters: Record<string, string | number | undefined>;
  generatedAt: string;
  totalRowsScanned: number;
  availableForwardReturnRows: number;
  insufficientForwardReturnRows: number;
  calibrationReadiness: CalibrationReadiness;
  calibrationSimulation: CalibrationSimulation;
  summaries: {
    overall: WinRateGroupSummary;
    bySignal: WinRateGroupSummary[];
    byMode: WinRateGroupSummary[];
    bySourceBucket: WinRateGroupSummary[];
    byEntryAction: WinRateGroupSummary[];
    byPositionAction: WinRateGroupSummary[];
    byLegacyAction: WinRateGroupSummary[];
    byActionConfidence: WinRateGroupSummary[];
    byEntryConfidence: WinRateGroupSummary[];
    byPositionConfidence: WinRateGroupSummary[];
    byDataQualityGrade: WinRateGroupSummary[];
    byProviderUsed: WinRateGroupSummary[];
    byCapitalFlowScoreBucket: WinRateGroupSummary[];
    byCompositeScoreBucket: WinRateGroupSummary[];
  };
  error?: string;
};

export type ActionHistoryRow = {
  ticker: string;
  signalDate: string;
  mode: string | null;
  sourceBucket: string | null;
  rank: number | null;
  previousRank: number | null;
  rankChange: number | null;
  entryActionSignal: string;
  previousEntryActionSignal: string;
  entryActionChange: string;
  positionActionSignal: string;
  previousPositionActionSignal: string;
  positionActionChange: string;
  actionSignal: string;
  previousActionSignal: string;
  compositeScore: number | null;
  previousCompositeScore: number | null;
  signal: string;
  previousSignal: string;
  flowDataQualityGrade: string | null;
  providerUsed: string | null;
  createdAt: string | null;
  previousCreatedAt: string | null;
};

export type ActionHistorySummary = {
  totalRows: number;
  newBuyCandidateCount: number;
  entryUpgradeCount: number;
  entryDowngradeCount: number;
  positionUpgradeCount: number;
  positionDowngradeCount: number;
  newSellCandidateCount: number;
  newExitCount: number;
  noChangeCount: number;
};

export type ActionHistoryReport = {
  ok: boolean;
  count: number;
  actionHistorySummary: ActionHistorySummary;
  rows: ActionHistoryRow[];
  error?: string;
};

export type SnapshotResponse = {
  updatedAt: string;
  dataMode: "Daily Close Snapshot";
  refreshMode: "Auto Daily Refresh";
  mode?: SnapshotMode;
  status: DataStatus;
  count: number;
  scannedCount?: number;
  candidateCount?: number;
  failedCount?: number;
  persistenceStatus?: PersistenceStatus;
  previousSnapshotFound?: boolean;
  droppedSymbols?: string[];
  persistenceError?: string;
  persistenceErrorCode?: string;
  persistenceErrorDetails?: string;
  providerCoverageSummary?: ProviderCoverageSummary;
  universeCoverageSummary?: UniverseCoverageSummary;
  realProviderCoveragePct?: number;
  archiveHitCount?: number;
  liveProviderSuccessCount?: number;
  fallbackToYfinanceCount?: number;
  providerCallsUsed?: ProviderCoverageSummary["providerCallsUsed"];
  providerCallsRemaining?: ProviderCoverageSummary["providerCallsRemaining"];
  signalSnapshotPersistenceStatus?: "SAVED" | "FAILED" | "SKIPPED";
  signalSnapshotRowsSaved?: number;
  signalSnapshotError?: string | null;
  signalSnapshotLatestDate?: string | null;
  signalSnapshotCoverageSummary?: SignalSnapshotCoverageSummary;
  actionSignalSummary?: ActionSignalSummary;
  entryActionSummary?: ActionSignalSummary;
  positionActionSummary?: PositionActionSummary;
  forwardReturnUpdateStatus?: ForwardReturnUpdateStatus;
  forwardReturnUpdatedRows?: number;
  forwardReturnCheckedRows?: number;
  forwardReturnInsufficientFutureDataRows?: number;
  forwardReturnLastUpdatedAt?: string | null;
  timeoutGuardTriggered?: boolean;
  elapsedMs?: number;
  refreshWorkItemCount?: number;
  processedWorkItemCount?: number;
  skippedWorkItemCount?: number;
  finalCoverageTickerCount?: number;
  fixedWatchlistTickerCount?: number;
  marketScanTickerCount?: number;
  dedupedCoverageTickerCount?: number;
  processedTickerCount?: number;
  skippedTickerCount?: number;
  skippedTickers?: string[];
  metricDefinitions?: Record<string, string>;
  movementSummary?: {
    newCount: number;
    upCount: number;
    downCount: number;
    sameCount: number;
  };
  items: StockCandidate[];
  fixedSnapshot?: SnapshotResponse;
};

export type RefreshResult = {
  ok: boolean;
  refreshedAt: string;
  dataMode: "Daily Close Snapshot";
  refreshMode: "Auto Daily Refresh";
  status: DataStatus;
  count: number;
  persistenceStatus?: PersistenceStatus;
  previousSnapshotFound?: boolean;
  droppedSymbols?: string[];
  persistenceError?: string;
  persistenceErrorCode?: string;
  persistenceErrorDetails?: string;
  providerCoverageSummary?: ProviderCoverageSummary;
  universeCoverageSummary?: UniverseCoverageSummary;
  actionSignalSummary?: ActionSignalSummary;
  entryActionSummary?: ActionSignalSummary;
  positionActionSummary?: PositionActionSummary;
  signalSnapshotPersistenceStatus?: "SAVED" | "FAILED" | "SKIPPED";
  signalSnapshotRowsSaved?: number;
  signalSnapshotError?: string | null;
  signalSnapshotLatestDate?: string | null;
  signalSnapshotCoverageSummary?: SignalSnapshotCoverageSummary;
  timeoutGuardTriggered?: boolean;
  elapsedMs?: number;
  refreshWorkItemCount?: number;
  processedWorkItemCount?: number;
  skippedWorkItemCount?: number;
  finalCoverageTickerCount?: number;
  fixedWatchlistTickerCount?: number;
  marketScanTickerCount?: number;
  dedupedCoverageTickerCount?: number;
  processedTickerCount?: number;
  skippedTickerCount?: number;
  skippedTickers?: string[];
  metricDefinitions?: Record<string, string>;
  message: string;
  snapshot: SnapshotResponse;
};
