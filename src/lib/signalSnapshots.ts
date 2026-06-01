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
};

type SignalSnapshotQuery = {
  date?: string;
  ticker?: string;
  limit?: number;
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
    source_bucket: candidate.sourceBucket ?? mode,
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
    provider_errors: candidate.providerErrors ?? [],
    raw_item: JSON.parse(JSON.stringify(candidate)) as StockCandidate,
  };
}

export async function upsertSignalSnapshots({
  marketSnapshot,
  fixedSnapshot,
}: {
  marketSnapshot: SnapshotResponse;
  fixedSnapshot?: SnapshotResponse;
}): Promise<SignalSnapshotPersistenceResult> {
  const signalDate = getSnapshotDate(new Date(marketSnapshot.updatedAt));

  if (!isSupabaseConfigured()) {
    return {
      status: "SKIPPED",
      rowsSaved: 0,
      error: getSupabaseConfigStatus().reason ?? "SUPABASE_ENV_MISSING",
      latestSignalDate: signalDate,
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      status: "SKIPPED",
      rowsSaved: 0,
      error: "SUPABASE_UNAVAILABLE",
      latestSignalDate: signalDate,
    };
  }

  const rows = [
    ...marketSnapshot.items.map((candidate) =>
      signalRow({
        signalDate,
        snapshot: marketSnapshot,
        mode: marketSnapshot.mode ?? "MARKET_SCAN",
        candidate,
      }),
    ),
    ...(fixedSnapshot?.items.map((candidate) =>
      signalRow({
        signalDate,
        snapshot: fixedSnapshot,
        mode: fixedSnapshot.mode ?? "FIXED_WATCHLIST",
        candidate,
      }),
    ) ?? []),
  ];

  if (rows.length === 0) {
    return {
      status: "SKIPPED",
      rowsSaved: 0,
      error: "NO_SIGNAL_ROWS",
      latestSignalDate: signalDate,
    };
  }

  try {
    const { error } = await supabase
      .from(signalSnapshotTableName)
      .upsert(rows, {
        onConflict: "signal_date,mode,ticker,source_bucket",
      });

    if (error) {
      return {
        status: "FAILED",
        rowsSaved: 0,
        error: errorMessage(error),
        latestSignalDate: signalDate,
      };
    }

    return {
      status: "SAVED",
      rowsSaved: rows.length,
      error: null,
      latestSignalDate: signalDate,
    };
  } catch (error) {
    return {
      status: "FAILED",
      rowsSaved: 0,
      error: errorMessage(error),
      latestSignalDate: signalDate,
    };
  }
}

export async function querySignalSnapshots({
  date,
  ticker,
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
    rows: data ?? [],
  };
}
