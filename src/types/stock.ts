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
  fcfQoqChange: number;
  capitalFlow3D: number;
  capitalFlow5D: number;
  capitalFlow9D: number;
  capitalFlow3W: number;
  capitalFlow5W: number;
  compositeScore: number;
  marginScore: number;
  fcfScore: number;
  capitalFlowScore: number;
  marginChange: number;
  cashFlowChangeRatio: number;
  capitalFlowChangeRatio: number;
  signal: string;
  dataStatus: DataStatus;
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
  movementSummary?: {
    newCount: number;
    upCount: number;
    downCount: number;
    sameCount: number;
  };
  items: StockCandidate[];
};

export type RefreshResult = {
  ok: boolean;
  refreshedAt: string;
  dataMode: "Daily Close Snapshot";
  refreshMode: "Auto Daily Refresh";
  status: DataStatus;
  count: number;
  message: string;
  snapshot: SnapshotResponse;
};
