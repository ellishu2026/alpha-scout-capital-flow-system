export type StockPool = "MID_CAP" | "HIGH_PRICE" | "OVERLAP" | "WATCHLIST";

export type DataStatus =
  | "HIGH"
  | "MID"
  | "LOW"
  | "LIVE_MARKET"
  | "PARTIAL_LIVE"
  | "MOCK";

export type RankChangeType = "NEW" | "UP" | "DOWN" | "SAME";

export type SnapshotMode = "MARKET_SCAN" | "FIXED_WATCHLIST" | "MOCK";

export type PersistenceStatus = "SAVED" | "DISABLED" | "FAILED";

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
  message: string;
  snapshot: SnapshotResponse;
};
