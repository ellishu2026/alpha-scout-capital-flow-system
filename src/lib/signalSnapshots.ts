import "server-only";

import {
  getSupabaseAdminClient,
  getSupabaseConfigStatus,
  isSupabaseConfigured,
} from "@/lib/supabaseAdmin";
import { getSnapshotDate } from "@/lib/snapshotStore";
import type { SnapshotMode, SnapshotResponse, StockCandidate } from "@/types/stock";

export const signalSnapshotTableName = "alpha_scout_signal_snapshots";

export type SignalSnapshotPersistenceStatus = "SAVED" | "FAILED" | "SKIPPED";

export type SignalSnapshotPersistenceResult = {
  status: SignalSnapshotPersistenceStatus;
  rowsSaved: number;
  error: string | null;
  latestSignalDate: string | null;
  coverageSummary: SignalSnapshotCoverageSummary;
};

type SignalSnapshotQuery = {
  date?: string;
  ticker?: string;
  mode?: string;
  sourceBucket?: string;
  limit?: number;
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

type SignalSnapshotRow = {
  signal_date: string;
  snapshot_created_at?: string;
  mode?: string;
  source_bucket?: string;
  rank?: number;
  ticker: string;
  company_name?: string;
  pool?: string;
  price?: number;
  market_cap?: number;
  composite_score?: number;
  capital_flow_score?: number;
  normalized_flow_score?: number;
  margin_score?: number;
  fcf_score?: number;
  signal?: string;
  data_status?: string;
  change_label?: string;
  change_type?: string;
  rank_change?: number | null;
  capital_flow_3d?: number;
  capital_flow_5d?: number;
  capital_flow_9d?: number;
  capital_flow_3w?: number;
  capital_flow_5w?: number;
  capital_flow_change_ratio?: number;
  margin_change?: number | null;
  fcf?: number;
  fcf_qoq_change?: number | null;
  cash_flow_change_ratio?: number | null;
  financial_data_source?: string;
  financial_updated_at?: string;
  flow_calculation_version?: string;
  capital_flow_data_source?: string;
  capital_flow_quality?: string;
  provider_used?: string;
  provider_endpoint_type?: string;
  archive_status?: string;
  archive_hit_provider?: string | null;
  flow_data_updated_at?: string;
  flow_data_quality_score?: number;
  flow_data_quality_grade?: string;
  flow_data_quality_reasons?: string[];
  flow_data_quality_inputs?: Record<string, unknown>;
  action_signal?: string;
  action_confidence?: string;
  action_reasons?: string[];
  action_risk_flags?: string[];
  provider_errors?: string[];
  raw_item: StockCandidate;
};

function errorMessage(error: unknown) {
  const supabaseError = error as {
    message?: string;
    code?: string;
    details?: string;
  };

  return (
    supabaseError?.message ??
    (error instanceof Error ? error.message : "Unknown signal snapshot error")
  );
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function signalRow({
  signalDate,
  snapshot,
  mode,
  candidate,
}: {
  signalDate: string;
  snapshot: SnapshotResponse;
  mode: SnapshotMode;
  candidate: StockCandidate;
}): SignalSnapshotRow {
  return {
    signal_date: signalDate,
    snapshot_created_at: snapshot.updatedAt,
    mode,
    source_bucket:
      candidate.sourceBucket ??
      (mode === "MARKET_SCAN" ? "MARKET_SCAN_TOP15" : mode),
    rank: candidate.rank,
    ticker: candidate.ticker,
    company_name: candidate.companyName,
    pool: candidate.pool,
    price: finiteNumber(candidate.price) ?? undefined,
    market_cap: finiteNumber(candidate.marketCap) ?? undefined,
    composite_score: finiteNumber(candidate.compositeScore) ?? undefined,
    capital_flow_score: finiteNumber(candidate.capitalFlowScore) ?? undefined,
    normalized_flow_score: finiteNumber(candidate.normalizedFlowScore) ?? undefined,
    margin_score: finiteNumber(candidate.marginScore) ?? undefined,
    fcf_score: finiteNumber(candidate.fcfScore) ?? undefined,
    signal: candidate.signal,
    data_status: candidate.dataStatus,
    change_label: candidate.changeLabel,
    change_type: candidate.changeType,
    rank_change: finiteNumber(candidate.rankChange),
    capital_flow_3d: finiteNumber(candidate.capitalFlow3D) ?? undefined,
    capital_flow_5d: finiteNumber(candidate.capitalFlow5D) ?? undefined,
    capital_flow_9d: finiteNumber(candidate.capitalFlow9D) ?? undefined,
    capital_flow_3w: finiteNumber(candidate.capitalFlow3W) ?? undefined,
    capital_flow_5w: finiteNumber(candidate.capitalFlow5W) ?? undefined,
    capital_flow_change_ratio:
      finiteNumber(candidate.capitalFlowChangeRatio) ?? undefined,
    margin_change: finiteNumber(candidate.marginChange),
    fcf: finiteNumber(candidate.fcf) ?? undefined,
    fcf_qoq_change: finiteNumber(candidate.fcfQoqChange),
    cash_flow_change_ratio: finiteNumber(candidate.cashFlowChangeRatio),
    financial_data_source: candidate.financialDataSource,
    financial_updated_at: candidate.financialUpdatedAt,
    flow_calculation_version: candidate.flowCalculationVersion,
    capital_flow_data_source: candidate.capitalFlowDataSource,
    capital_flow_quality: candidate.capitalFlowQuality,
    provider_used: candidate.providerUsed,
    provider_endpoint_type: candidate.providerEndpointType,
    archive_status: candidate.archiveStatus,
    archive_hit_provider: candidate.archiveHitProvider,
    flow_data_updated_at: candidate.flowDataUpdatedAt,
    flow_data_quality_score:
      finiteNumber(candidate.flowDataQualityScore) ?? undefined,
    flow_data_quality_grade: candidate.flowDataQualityGrade,
    flow_data_quality_reasons: candidate.flowDataQualityReasons ?? [],
    flow_data_quality_inputs: candidate.flowDataQualityInputs,
    action_signal: candidate.actionSignal,
    action_confidence: candidate.actionConfidence,
    action_reasons: candidate.actionReasons ?? [],
    action_risk_flags: candidate.actionRiskFlags ?? [],
    provider_errors: candidate.providerErrors ?? [],
    raw_item: JSON.parse(JSON.stringify(candidate)) as StockCandidate,
  };
}

function withoutActionColumns(row: SignalSnapshotRow): SignalSnapshotRow {
  const fallbackRow = { ...row };

  delete fallbackRow.action_signal;
  delete fallbackRow.action_confidence;
  delete fallbackRow.action_reasons;
  delete fallbackRow.action_risk_flags;

  return fallbackRow;
}

function shouldRetryWithoutActionColumns(error: unknown) {
  const message = errorMessage(error).toLowerCase();

  return (
    message.includes("action_signal") ||
    message.includes("action_confidence") ||
    message.includes("action_reasons") ||
    message.includes("action_risk_flags") ||
    message.includes("schema cache")
  );
}

function withRawItemActionFields(row: Record<string, unknown>) {
  const rawItem = row.raw_item as StockCandidate | undefined;

  if (!rawItem) {
    return row;
  }

  return {
    ...row,
    action_signal: row.action_signal ?? rawItem.actionSignal,
    action_confidence: row.action_confidence ?? rawItem.actionConfidence,
    action_reasons: row.action_reasons ?? rawItem.actionReasons,
    action_risk_flags: row.action_risk_flags ?? rawItem.actionRiskFlags,
  };
}

function emptyCoverageSummary(): SignalSnapshotCoverageSummary {
  return {
    fixedWatchlistRowsSaved: 0,
    marketScanRowsSaved: 0,
    fallbackRowsSaved: 0,
    totalRowsSaved: 0,
    uniqueTickersSaved: 0,
    overlappingTickers: [],
    fixedWatchlistTickers: [],
    marketScanTickers: [],
  };
}

function buildCoverageSummary(rows: SignalSnapshotRow[]) {
  const fixedWatchlistTickers = Array.from(
    new Set(
      rows
        .filter((row) => row.mode === "FIXED_WATCHLIST")
        .map((row) => row.ticker),
    ),
  ).sort();
  const marketScanTickers = Array.from(
    new Set(
      rows
        .filter((row) => row.mode === "MARKET_SCAN")
        .map((row) => row.ticker),
    ),
  ).sort();
  const fixedSet = new Set(fixedWatchlistTickers);
  const overlappingTickers = marketScanTickers
    .filter((ticker) => fixedSet.has(ticker))
    .sort();

  return {
    fixedWatchlistRowsSaved: rows.filter(
      (row) => row.mode === "FIXED_WATCHLIST",
    ).length,
    marketScanRowsSaved: rows.filter((row) => row.mode === "MARKET_SCAN")
      .length,
    fallbackRowsSaved: rows.filter(
      (row) => row.mode !== "FIXED_WATCHLIST" && row.mode !== "MARKET_SCAN",
    ).length,
    totalRowsSaved: rows.length,
    uniqueTickersSaved: new Set(rows.map((row) => row.ticker)).size,
    overlappingTickers,
    fixedWatchlistTickers,
    marketScanTickers,
  };
}

export async function upsertSignalSnapshots({
  marketSnapshot,
  fixedSnapshot,
  fallbackSnapshot,
}: {
  marketSnapshot?: SnapshotResponse;
  fixedSnapshot?: SnapshotResponse;
  fallbackSnapshot?: SnapshotResponse;
}): Promise<SignalSnapshotPersistenceResult> {
  const baseSnapshot = marketSnapshot ?? fixedSnapshot ?? fallbackSnapshot;
  const signalDate = getSnapshotDate(
    new Date(baseSnapshot?.updatedAt ?? new Date()),
  );

  if (!isSupabaseConfigured()) {
    return {
      status: "SKIPPED",
      rowsSaved: 0,
      error: getSupabaseConfigStatus().reason ?? "SUPABASE_ENV_MISSING",
      latestSignalDate: signalDate,
      coverageSummary: emptyCoverageSummary(),
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      status: "SKIPPED",
      rowsSaved: 0,
      error: "SUPABASE_UNAVAILABLE",
      latestSignalDate: signalDate,
      coverageSummary: emptyCoverageSummary(),
    };
  }

  const rows: SignalSnapshotRow[] = [
    ...(marketSnapshot?.items.map((candidate) =>
      signalRow({
        signalDate,
        snapshot: marketSnapshot,
        mode: "MARKET_SCAN",
        candidate,
      }),
    ) ?? []),
    ...(fixedSnapshot?.items.map((candidate) =>
      signalRow({
        signalDate,
        snapshot: fixedSnapshot,
        mode: "FIXED_WATCHLIST",
        candidate,
      }),
    ) ?? []),
  ];

  if (rows.length === 0 && fallbackSnapshot) {
    rows.push(
      ...fallbackSnapshot.items.map((candidate) =>
        signalRow({
          signalDate,
          snapshot: fallbackSnapshot,
          mode: fallbackSnapshot.mode ?? "MARKET_SCAN",
          candidate,
        }),
      ),
    );
  }
  const coverageSummary = buildCoverageSummary(rows);

  if (rows.length === 0) {
    return {
      status: "SKIPPED",
      rowsSaved: 0,
      error: "NO_SIGNAL_ROWS",
      latestSignalDate: signalDate,
      coverageSummary,
    };
  }

  try {
    const { error } = await supabase
      .from(signalSnapshotTableName)
      .upsert(rows, {
        onConflict: "signal_date,mode,ticker,source_bucket",
      });

    if (error) {
      if (shouldRetryWithoutActionColumns(error)) {
        const { error: fallbackError } = await supabase
          .from(signalSnapshotTableName)
          .upsert(rows.map(withoutActionColumns), {
            onConflict: "signal_date,mode,ticker,source_bucket",
          });

        if (!fallbackError) {
          return {
            status: "SAVED",
            rowsSaved: rows.length,
            error: null,
            latestSignalDate: signalDate,
            coverageSummary,
          };
        }

        return {
          status: "FAILED",
          rowsSaved: 0,
          error: errorMessage(fallbackError),
          latestSignalDate: signalDate,
          coverageSummary: emptyCoverageSummary(),
        };
      }

      return {
        status: "FAILED",
        rowsSaved: 0,
        error: errorMessage(error),
        latestSignalDate: signalDate,
        coverageSummary: emptyCoverageSummary(),
      };
    }

    return {
      status: "SAVED",
      rowsSaved: rows.length,
      error: null,
      latestSignalDate: signalDate,
      coverageSummary,
    };
  } catch (error) {
    return {
      status: "FAILED",
      rowsSaved: 0,
      error: errorMessage(error),
      latestSignalDate: signalDate,
      coverageSummary: emptyCoverageSummary(),
    };
  }
}

export async function querySignalSnapshots({
  date,
  ticker,
  mode,
  sourceBucket,
  limit = 50,
}: SignalSnapshotQuery) {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      count: 0,
      rows: [],
      error: getSupabaseConfigStatus().reason ?? "SUPABASE_ENV_MISSING",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      count: 0,
      rows: [],
      error: "SUPABASE_UNAVAILABLE",
    };
  }

  let query = supabase
    .from(signalSnapshotTableName)
    .select("*")
    .order("signal_date", { ascending: false })
    .order("rank", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 200));

  if (date) {
    query = query.eq("signal_date", date);
  }

  if (ticker) {
    query = query.eq("ticker", ticker.toUpperCase());
  }

  if (mode) {
    query = query.eq("mode", mode);
  }

  if (sourceBucket) {
    query = query.eq("source_bucket", sourceBucket);
  }

  const { data, error } = await query;

  if (error) {
    return {
      ok: false,
      count: 0,
      rows: [],
      error: errorMessage(error),
    };
  }

  return {
    ok: true,
    count: data?.length ?? 0,
    filters: {
      date,
      ticker: ticker?.toUpperCase(),
      mode,
      source_bucket: sourceBucket,
      limit: Math.min(Math.max(limit, 1), 200),
    },
    rows: (data ?? []).map((row) =>
      withRawItemActionFields(row as unknown as Record<string, unknown>),
    ),
  };
}
