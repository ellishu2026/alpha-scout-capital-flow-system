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
  | "MULTI_BUCKET"
  | "OUTSIDE_V1_7_9_POOLS";
export type UniverseMembershipBucket = Exclude<
  UniverseSourceBucket,
  "MULTI_BUCKET" | "OUTSIDE_V1_7_9_POOLS"
>;
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
  capitalFlow1D?: number | null;
  capitalFlow10D?: number | null;
  capitalFlow20D?: number | null;
  capitalFlow4W?: number | null;
  capitalFlow6W?: number | null;
  capitalFlow9W?: number | null;
  capitalFlow12W?: number | null;
  flowWindowCoverage?: {
    availableDailyFlowCount: number;
    requestedWindows: string[];
    unavailableWindows: string[];
  };
  flowWindowDataSource?: CapitalFlowDataSource;
  flowWindowUpdatedAt?: string | null;
  flowWindowProviderUsed?: ProviderUsed;
  flowWindowExtendedHistoryAvailable?: boolean;
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
  universeSourceBucket?: UniverseSourceBucket;
  universeSourceBuckets?: UniverseMembershipBucket[];
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
  sourceBuckets: UniverseMembershipBucket[];
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

export type FlowWindowCoverageSummary = {
  displayWindowTickerCount: number;
  topRankedTickerCount: number;
  fixedWatchlistTickerCount: number;
  uniqueTickerCount: number;
  extendedWindowCalculatedCount: number;
  extendedWindowUnavailableCount: number;
  providerCallsUsedForDisplayWindows: number;
  archiveHitCount: number;
  liveProviderCallCount: number;
  longWindowUnavailableTickers: string[];
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

export type ForwardWindowKey =
  | "forward1D"
  | "forward3D"
  | "forward5D"
  | "forward10D"
  | "forward20D";

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
  readyWindows: ForwardWindowKey[];
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

export type ThresholdSimulationRuleSet = {
  id: string;
  name: string;
  description: string;
  entryRuleSummary: string;
  positionRuleSummary: string;
  status?: "ACTIVE_PRODUCTION";
  isProduction: boolean;
  autoActivationAllowed: false;
};

export type ThresholdSimulationComparison = {
  winRateDeltaPct: number | null;
  avgReturnDeltaPct: number | null;
  medianReturnDeltaPct: number | null;
  worstReturnDeltaPct: number | null;
  sampleCountDelta: number;
  coverageDeltaPct: number;
  isBetterThanProduction: boolean;
  reason: string;
};

export type ThresholdSimulationResult = ForwardWindowStats & {
  ruleSetId: string;
  ruleSetName: string;
  window: ForwardWindowKey;
  maxDrawdownProxy: number | null;
  signalCount: number;
  buyCandidateCount: number;
  watchCount: number;
  avoidCount: number;
  holdCount: number;
  reduceCount: number;
  sellCandidateCount: number;
  exitCount: number;
  coveragePct: number;
  comparisonToProduction: ThresholdSimulationComparison;
};

export type ThresholdSimulationReport = {
  ok: boolean;
  generatedAt: string;
  totalRowsScanned: number;
  availableForwardReturnRows: number;
  insufficientForwardReturnRows: number;
  minRecommendedSamples: number;
  isReadyForThresholdSimulation: boolean;
  readyWindows: ForwardWindowKey[];
  notReadyReason: string | null;
  productionRuleSet: ThresholdSimulationRuleSet;
  candidateRuleSets: ThresholdSimulationRuleSet[];
  simulationResults: ThresholdSimulationResult[];
  bestCandidate: ThresholdSimulationResult | null;
  recommendation: string;
  promotionWorkflowAvailable: boolean;
  promotionEndpoint: string;
  promotionAllowed: false;
  abComparisonAvailable: boolean;
  abComparisonEndpoint: string;
  defaultABCandidateRuleSet: string;
  rollingRecommendationAvailable: boolean;
  rollingRecommendationEndpoint: string;
  winRateTrendAvailable: boolean;
  winRateTrendEndpoint: string;
  tradeWinRateLeaderboardAvailable?: boolean;
  tradeWinRateLeaderboardEndpoint?: string;
  safetyWarnings: string[];
  error?: string;
};

export type ThresholdSimulationSummary = {
  available: boolean;
  endpoint: string;
  status: "Ready" | "Not Ready";
  samples: number;
  minRecommendedSamples: number;
  readyWindows: ForwardWindowKey[];
  bestCandidate: ThresholdSimulationResult | null;
  recommendation: string;
  notReadyReason: string | null;
  promotionWorkflowAvailable: boolean;
  promotionEndpoint: string;
  promotionAllowed: false;
  abComparisonAvailable: boolean;
  abComparisonEndpoint: string;
  defaultABCandidateRuleSet: string;
  rollingRecommendationAvailable: boolean;
  rollingRecommendationEndpoint: string;
  winRateTrendAvailable: boolean;
  winRateTrendEndpoint: string;
};

export type RuleABComparison = {
  candidateRuleSetId: string;
  candidateRuleSetName: string;
  window: ForwardWindowKey;
  productionSampleCount: number;
  candidateSampleCount: number;
  productionWinCount: number;
  candidateWinCount: number;
  productionLossCount: number;
  candidateLossCount: number;
  productionWinRatePct: number | null;
  candidateWinRatePct: number | null;
  winRateDeltaPct: number | null;
  productionAvgReturnPct: number | null;
  candidateAvgReturnPct: number | null;
  avgReturnDeltaPct: number | null;
  productionMedianReturnPct: number | null;
  candidateMedianReturnPct: number | null;
  medianReturnDeltaPct: number | null;
  productionWorstReturnPct: number | null;
  candidateWorstReturnPct: number | null;
  worstReturnDeltaPct: number | null;
  productionBestReturnPct: number | null;
  candidateBestReturnPct: number | null;
  productionCoverage: number;
  candidateCoverage: number;
  coverageDeltaPct: number | null;
  isCandidateBetter: boolean;
  reason: string;
};

export type RuleABReport = {
  ok: boolean;
  generatedAt: string;
  totalRowsScanned: number;
  availableForwardReturnRows: number;
  insufficientForwardReturnRows: number;
  minRecommendedSamples: number;
  isReadyForABComparison: boolean;
  readyWindows: ForwardWindowKey[];
  notReadyReason: string | null;
  productionRuleSet: ThresholdSimulationRuleSet;
  candidateRuleSets: ThresholdSimulationRuleSet[];
  selectedCandidateRuleSet: ThresholdSimulationRuleSet;
  abComparisons: RuleABComparison[];
  winRateDefinitions: {
    validSample: string;
    entryAction: {
      buyCandidate: string;
      watch: string;
      avoid: string;
    };
    positionAction: {
      hold: string;
      reduce: string;
      sellCandidate: string;
      exit: string;
    };
    general: string;
  };
  recommendation: string;
  rollingRecommendationAvailable: boolean;
  rollingRecommendationEndpoint: string;
  winRateTrendAvailable: boolean;
  winRateTrendEndpoint: string;
  tradeWinRateLeaderboardAvailable: boolean;
  tradeWinRateLeaderboardEndpoint: string;
  safetyWarnings: string[];
  error?: string;
};

export type RollingRecommendedAction =
  | "NO_CHANGE"
  | "REVIEW_CANDIDATE_RULE"
  | "PROMOTE_TO_APPROVAL_REVIEW";

export type RollingConfidenceLevel = "Low" | "Medium" | "High";

export type RollingRecommendationSummary = {
  status: "Not Ready" | "Ready";
  recommendedAction: RollingRecommendedAction;
  selectedCandidateRuleSet: ThresholdSimulationRuleSet | null;
  confidenceLevel: RollingConfidenceLevel;
  reason: string;
  autoActivationAllowed: false;
  explicitApprovalRequired: true;
};

export type RollingRecommendationWindow = {
  windowName: "last20Signals" | "last50Signals" | "last100Signals" | "last250Signals";
  signalLimit: number;
  signalCount: number;
  availableForwardReturnRows: number;
  minRecommendedSamples: number;
  isReady: boolean;
  readyWindows: ForwardWindowKey[];
  bestCandidateRuleSet: ThresholdSimulationRuleSet | null;
  productionBaseline: ThresholdSimulationRuleSet;
  recommendation: string;
  recommendedAction: RollingRecommendedAction;
  notReadyReason: string | null;
};

export type RollingCandidateRecommendation = {
  ruleSetId: string;
  ruleSetName: string;
  rollingWindow: RollingRecommendationWindow["windowName"];
  sampleCount: number;
  availableForwardReturnRows: number;
  readiness: "Not Ready" | "Ready";
  estimatedWinRateImprovement: number | null;
  estimatedAvgReturnImprovement: number | null;
  downsideRiskChange: number | null;
  confidenceLevel: RollingConfidenceLevel;
  recommendedAction: RollingRecommendedAction;
  reason: string;
  autoActivationAllowed: false;
};

export type RollingRecommendationReport = {
  ok: boolean;
  generatedAt: string;
  totalRowsScanned: number;
  availableForwardReturnRows: number;
  minRecommendedSamples: number;
  currentProductionRuleSet: ThresholdSimulationRuleSet;
  rollingRecommendation: RollingRecommendationSummary;
  windows: RollingRecommendationWindow[];
  candidateRecommendations: RollingCandidateRecommendation[];
  promotionGate: {
    autoActivationAllowed: false;
    explicitApprovalRequired: true;
    requiresRulePromotionWorkflow: true;
    requiresABComparison: true;
    requiresThresholdSimulation: true;
    requiresMinimumSamples: true;
    requiresRiskReview: true;
    canAutoActivate: false;
  };
  relatedEndpoints: {
    thresholdSimulationEndpoint: string;
    ruleABEndpoint: string;
    rulePromotionEndpoint: string;
  };
  winRateTrendAvailable: boolean;
  winRateTrendEndpoint: string;
  tradeWinRateLeaderboardAvailable: boolean;
  tradeWinRateLeaderboardEndpoint: string;
  safetyWarnings: string[];
  error?: string;
};

export type WinRateDefinitions = RuleABReport["winRateDefinitions"];

export type WinRateTrendForwardWindow = ForwardWindowKey;

export type WinRateTrendActionType = "entry" | "position";

export type WinRateTrendAction =
  | "Buy Candidate"
  | "Watch"
  | "Avoid"
  | "Hold"
  | "Reduce"
  | "Sell Candidate"
  | "Exit";

export type WinRateTrendPoint = ForwardWindowStats & {
  date: string;
  signalDate: string;
  rollingWindow: number;
  ruleSetId: string;
  ruleSetName: string;
  forwardWindow: WinRateTrendForwardWindow;
  actionType: WinRateTrendActionType;
  action: WinRateTrendAction;
};

export type WinRateTrendSeries = {
  ruleSetId: string;
  ruleSetName: string;
  seriesType: "production" | "candidate";
  points: WinRateTrendPoint[];
  notReadyReason: string | null;
};

export type WinRateABTrendDeltaPoint = {
  date: string;
  signalDate: string;
  productionWinRatePct: number | null;
  candidateWinRatePct: number | null;
  winRateDeltaPct: number | null;
  productionAvgReturnPct: number | null;
  candidateAvgReturnPct: number | null;
  avgReturnDeltaPct: number | null;
  sampleCount: number;
};

export type WinRateTrendReadiness = {
  status: "Not Ready" | "Ready";
  isReady: boolean;
  availableForwardReturnRows: number;
  minRecommendedSamples: number;
  readyWindows: ForwardWindowKey[];
  notReadyReason: string | null;
};

export type WinRateTrendSummary = {
  status: "Not Ready" | "Ready";
  samples: number;
  minRecommendedSamples: number;
  currentWinRatePct: number | null;
  candidateWinRatePct: number | null;
  winRateDeltaPct: number | null;
  currentAvgReturnPct: number | null;
  candidateAvgReturnPct: number | null;
  avgReturnDeltaPct: number | null;
};

export type WinRateTrendReport = {
  ok: boolean;
  generatedAt: string;
  totalRowsScanned: number;
  availableForwardReturnRows: number;
  minRecommendedSamples: number;
  selectedForwardWindow: ForwardWindowKey;
  selectedRollingWindow: number;
  selectedActionType: WinRateTrendActionType;
  selectedAction: WinRateTrendAction;
  productionRuleSet: ThresholdSimulationRuleSet;
  selectedCandidateRuleSet: ThresholdSimulationRuleSet;
  availableCandidates: ThresholdSimulationRuleSet[];
  winRateDefinitions: WinRateDefinitions;
  trendReadiness: WinRateTrendReadiness;
  trendSeries: WinRateTrendSeries[];
  abTrendSeries: {
    productionSeries: WinRateTrendSeries;
    candidateSeries: WinRateTrendSeries;
    deltaSeries: {
      points: WinRateABTrendDeltaPoint[];
      notReadyReason: string | null;
    };
  };
  summary: WinRateTrendSummary;
  tradeWinRateLeaderboardAvailable: boolean;
  tradeWinRateLeaderboardEndpoint: string;
  recommendation: string;
  safetyWarnings: string[];
  error?: string;
};

export type TradeWinRateWindowKey =
  | ForwardWindowKey
  | "forward5W"
  | "forward6W"
  | "forward9W"
  | "forward12W";

export type TradeWinRateWindowMetric = {
  label: string;
  key: TradeWinRateWindowKey;
  field: string | null;
  available: boolean;
};

export type TradeWinRateLeaderboardRow = {
  rank: number;
  ruleSetId: string;
  displayName: string;
  thresholdSummary: string;
  isProduction: boolean;
  autoActivationAllowed: false;
  status: "Active" | "Not Ready" | "Simulated" | "Candidate";
  samples: number;
  minRecommendedSamples: number;
  winRates: Record<TradeWinRateWindowKey, number | null>;
  avgReturns: Partial<Record<TradeWinRateWindowKey, number | null>>;
  compositeTradeRateScore: number | null;
  scoreCoveragePct: number;
  notReadyReason: string | null;
};

export type TradeWinRateLeaderboardReport = {
  ok: boolean;
  generatedAt: string;
  totalRowsScanned: number;
  availableForwardReturnRows: number;
  minRecommendedSamples: number;
  leaderboardReadiness: {
    status: "Ready" | "Not Ready";
    isReady: boolean;
    notReadyReason: string | null;
  };
  forwardWindows: TradeWinRateWindowMetric[];
  scoreWeights: Record<TradeWinRateWindowKey, number>;
  winRateDefinitions: WinRateDefinitions;
  rows: TradeWinRateLeaderboardRow[];
  recommendation: string;
  safetyWarnings: string[];
  error?: string;
};

export type RulePromotionStatus =
  | "DRAFT"
  | "SIMULATED"
  | "RECOMMENDED"
  | "APPROVED"
  | "REJECTED"
  | "ACTIVE_PRODUCTION"
  | "SIMULATED_NOT_READY";

export type RulePromotionCandidate = {
  id: string;
  name: string;
  description: string;
  simulationStatus: RulePromotionStatus;
  approvalStatus: RulePromotionStatus;
  autoActivationAllowed: false;
  canBePromoted: boolean;
  promotionBlockedReason: string | null;
};

export type RulePromotionReport = {
  ok: boolean;
  generatedAt: string;
  currentProductionRuleSet: {
    id: string;
    name: string;
    status: "ACTIVE_PRODUCTION";
    autoActivationAllowed: false;
    activatedAt: string | null;
  };
  candidateRuleSets: RulePromotionCandidate[];
  promotionWorkflow: {
    statuses: RulePromotionStatus[];
    sequence: string;
    description: string;
  };
  approvalGate: {
    explicitApprovalRequired: true;
    autoPromotionAllowed: false;
    minimumSampleRequired: number;
    requiresWinRateImprovement: true;
    requiresAverageReturnImprovement: true;
    requiresWorstReturnNotWorse: true;
    requiresRiskReview: true;
  };
  abComparisonRequired: true;
  abComparisonEndpoint: string;
  abComparisonReady: boolean;
  rollingRecommendationAvailable: true;
  rollingRecommendationEndpoint: string;
  rollingRecommendationRequired: true;
  rollingRecommendationReady: boolean;
  recommendation: string;
  safetyWarnings: string[];
  error?: string;
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
  thresholdSimulationSummary?: ThresholdSimulationSummary;
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
  flowWindowCoverageSummary?: FlowWindowCoverageSummary;
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
  flowWindowCoverageSummary?: FlowWindowCoverageSummary;
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
