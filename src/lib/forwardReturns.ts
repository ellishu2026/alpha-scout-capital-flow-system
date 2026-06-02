import "server-only";

import type { OhlcvCandle } from "@/lib/capitalFlow";
import { fetchHistoricalDailyCandles } from "@/lib/liveMarketData";
import {
  fetchProviderCandles,
  getProviderBudgetSummary,
} from "@/lib/marketDataProviders";
import { signalSnapshotTableName } from "@/lib/signalSnapshots";
import {
  getSupabaseAdminClient,
  getSupabaseConfigStatus,
  isSupabaseConfigured,
} from "@/lib/supabaseAdmin";
import type { ForwardReturnUpdateStatus, StockCandidate } from "@/types/stock";

const FORWARD_WINDOWS = [1, 3, 5, 10, 20] as const;
const FORWARD_RETURN_FIELDS = [
  "forward_1d_return_pct",
  "forward_3d_return_pct",
  "forward_5d_return_pct",
  "forward_10d_return_pct",
  "forward_20d_return_pct",
] as const;

type ForwardReturnField = (typeof FORWARD_RETURN_FIELDS)[number];

type SignalSnapshotForwardRow = {
  id: string;
  signal_date: string;
  ticker: string;
  price: number | string | null;
  forward_1d_return_pct: number | null;
  forward_3d_return_pct: number | null;
  forward_5d_return_pct: number | null;
  forward_10d_return_pct: number | null;
  forward_20d_return_pct: number | null;
};

type ForwardReturnUpdateOptions = {
  limit?: number;
};

type ForwardReturnDebugQuery = {
  ticker?: string;
  signalDate?: string;
  mode?: string;
  sourceBucket?: string;
  limit?: number;
};

export type ForwardReturnUpdateResult = {
  ok: boolean;
  status: ForwardReturnUpdateStatus;
  checkedRows: number;
  updatedRows: number;
  skippedRows: number;
  insufficientFutureDataRows: number;
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
  errors: string[];
  updatedAt: string;
};

function parseLimit(limit: number | undefined) {
  return Number.isFinite(limit)
    ? Math.min(Math.max(Math.floor(limit as number), 1), 200)
    : 100;
}

function errorMessage(error: unknown) {
  const supabaseError = error as {
    message?: string;
    code?: string;
    details?: string;
  };

  return (
    supabaseError?.message ??
    (error instanceof Error ? error.message : "Unknown forward return error")
  );
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;

  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateFromIsoDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isFinite(date.getTime()) ? date : null;
}

function daysBetween(startDate: string) {
  const start = dateFromIsoDate(startDate);

  if (!start) return 60;

  return Math.max(
    60,
    Math.ceil((Date.now() - start.getTime()) / 86_400_000) + 45,
  );
}

function roundPct(value: number) {
  return Math.round(value * 100) / 100;
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

function budgetFields() {
  const budget = getProviderBudgetSummary();

  return {
    providerCallsUsed: {
      polygon: budget.polygon.callsUsed,
      alphaVantage: budget.alphaVantage.callsUsed,
      twelveData: budget.twelveData.callsUsed,
      eodhd: budget.eodhd.callsUsed,
    },
    providerCallsRemaining: {
      polygon: budget.polygon.remaining,
      alphaVantage: budget.alphaVantage.remaining,
      twelveData: budget.twelveData.remaining,
      eodhd: budget.eodhd.remaining,
    },
  };
}

function normalizeCandles(candles: OhlcvCandle[]) {
  return candles
    .filter(
      (candle) =>
        candle.date instanceof Date &&
        Number.isFinite(candle.date.getTime()) &&
        typeof candle.close === "number" &&
        Number.isFinite(candle.close),
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function futureCandlesForDate(candles: OhlcvCandle[], signalDate: string) {
  return normalizeCandles(candles).filter((candle) => isoDate(candle.date) > signalDate);
}

function hasAnyNeededFutureData(candles: OhlcvCandle[], signalDate: string) {
  return futureCandlesForDate(candles, signalDate).length > 0;
}

function calculateForwardReturns({
  row,
  candles,
}: {
  row: SignalSnapshotForwardRow;
  candles: OhlcvCandle[];
}) {
  const basePrice = numberOrNull(row.price);

  if (!basePrice || basePrice <= 0) {
    return {
      updates: {},
      insufficientCount: 0,
      skipped: true,
    } as const;
  }

  const futureCandles = futureCandlesForDate(candles, row.signal_date);
  const updates: Partial<Record<ForwardReturnField, number>> = {};
  let insufficientCount = 0;

  FORWARD_WINDOWS.forEach((window, index) => {
    const field = FORWARD_RETURN_FIELDS[index];

    if (row[field] != null) {
      return;
    }

    const candle = futureCandles[window - 1];
    const close = numberOrNull(candle?.close);

    if (close == null) {
      insufficientCount += 1;
      return;
    }

    updates[field] = roundPct(((close - basePrice) / basePrice) * 100);
  });

  return {
    updates,
    insufficientCount,
    skipped: false,
  } as const;
}

async function fetchCandlesForForwardReturns(ticker: string, signalDate: string) {
  const providerResult = await fetchProviderCandles(ticker);

  if (hasAnyNeededFutureData(providerResult.candles, signalDate)) {
    return providerResult.candles;
  }

  return fetchHistoricalDailyCandles(ticker, daysBetween(signalDate));
}

async function queryEligibleRows(limit: number) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      data: null,
      error: new Error("SUPABASE_UNAVAILABLE"),
    };
  }

  return supabase
    .from(signalSnapshotTableName)
    .select(
      [
        "id",
        "signal_date",
        "ticker",
        "price",
        ...FORWARD_RETURN_FIELDS,
      ].join(","),
    )
    .or(FORWARD_RETURN_FIELDS.map((field) => `${field}.is.null`).join(","))
    .order("signal_date", { ascending: true })
    .order("ticker", { ascending: true })
    .limit(limit);
}

async function updateSnapshotForwardReturnSummary(
  result: ForwardReturnUpdateResult,
) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) return;

  const { data } = await supabase
    .from("alpha_scout_snapshots")
    .select("snapshot_date,mode,snapshot")
    .order("snapshot_date", { ascending: false })
    .limit(3);

  if (!data?.length) return;

  await Promise.all(
    data.map((row) => {
      const snapshot =
        row.snapshot && typeof row.snapshot === "object"
          ? {
              ...row.snapshot,
              forwardReturnUpdateStatus: result.status,
              forwardReturnUpdatedRows: result.updatedRows,
              forwardReturnCheckedRows: result.checkedRows,
              forwardReturnInsufficientFutureDataRows:
                result.insufficientFutureDataRows,
              forwardReturnLastUpdatedAt: result.updatedAt,
            }
          : row.snapshot;

      return supabase
        .from("alpha_scout_snapshots")
        .update({ snapshot })
        .eq("snapshot_date", row.snapshot_date)
        .eq("mode", row.mode);
    }),
  );
}

export async function updateForwardReturns({
  limit,
}: ForwardReturnUpdateOptions = {}): Promise<ForwardReturnUpdateResult> {
  const updatedAt = new Date().toISOString();
  const parsedLimit = parseLimit(limit);
  const errors: string[] = [];

  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      status: "FAILED",
      checkedRows: 0,
      updatedRows: 0,
      skippedRows: 0,
      insufficientFutureDataRows: 0,
      ...budgetFields(),
      errors: [getSupabaseConfigStatus().reason ?? "SUPABASE_ENV_MISSING"],
      updatedAt,
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      status: "FAILED",
      checkedRows: 0,
      updatedRows: 0,
      skippedRows: 0,
      insufficientFutureDataRows: 0,
      ...budgetFields(),
      errors: ["SUPABASE_UNAVAILABLE"],
      updatedAt,
    };
  }

  const { data, error } = await queryEligibleRows(parsedLimit);

  if (error) {
    return {
      ok: false,
      status: "FAILED",
      checkedRows: 0,
      updatedRows: 0,
      skippedRows: 0,
      insufficientFutureDataRows: 0,
      ...budgetFields(),
      errors: [errorMessage(error)],
      updatedAt,
    };
  }

  const rows = (data ?? []) as unknown as SignalSnapshotForwardRow[];

  if (rows.length === 0) {
    return {
      ok: true,
      status: "NO_ELIGIBLE_ROWS",
      checkedRows: 0,
      updatedRows: 0,
      skippedRows: 0,
      insufficientFutureDataRows: 0,
      ...budgetFields(),
      errors,
      updatedAt,
    };
  }

  const candleCache = new Map<string, Promise<OhlcvCandle[]>>();
  let updatedRows = 0;
  let skippedRows = 0;
  let insufficientFutureDataRows = 0;

  for (const row of rows) {
    const ticker = row.ticker?.toUpperCase();

    if (!ticker || !row.signal_date || !numberOrNull(row.price)) {
      skippedRows += 1;
      errors.push(`${row.ticker ?? "UNKNOWN"}:MISSING_SIGNAL_DATE_OR_PRICE`);
      continue;
    }

    try {
      if (!candleCache.has(ticker)) {
        candleCache.set(
          ticker,
          fetchCandlesForForwardReturns(ticker, row.signal_date),
        );
      }

      const candles = await candleCache.get(ticker);
      const result = calculateForwardReturns({
        row,
        candles: candles ?? [],
      });

      if (result.skipped) {
        skippedRows += 1;
        errors.push(`${ticker}:INVALID_BASE_PRICE`);
        continue;
      }

      if (Object.keys(result.updates).length === 0) {
        insufficientFutureDataRows += 1;
        continue;
      }

      const { error: updateError } = await supabase
        .from(signalSnapshotTableName)
        .update({
          ...result.updates,
          forward_returns_updated_at: updatedAt,
        })
        .eq("id", row.id);

      if (updateError) {
        skippedRows += 1;
        errors.push(`${ticker}:${errorMessage(updateError)}`);
        continue;
      }

      updatedRows += 1;

      if (result.insufficientCount > 0) {
        insufficientFutureDataRows += 1;
      }
    } catch (error) {
      skippedRows += 1;
      errors.push(`${ticker}:${errorMessage(error)}`);
    }
  }

  const status: ForwardReturnUpdateStatus =
    updatedRows === 0 && insufficientFutureDataRows === 0 && skippedRows > 0
      ? "FAILED"
      : updatedRows === rows.length && insufficientFutureDataRows === 0
        ? "UPDATED"
        : "PARTIAL_UPDATED";

  const result: ForwardReturnUpdateResult = {
    ok: status !== "FAILED",
    status,
    checkedRows: rows.length,
    updatedRows,
    skippedRows,
    insufficientFutureDataRows,
    ...budgetFields(),
    errors,
    updatedAt,
  };

  if (result.ok) {
    await updateSnapshotForwardReturnSummary(result);
  }

  return result;
}

export async function queryForwardReturns({
  ticker,
  signalDate,
  mode,
  sourceBucket,
  limit = 50,
}: ForwardReturnDebugQuery) {
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
    .select(
      [
        "signal_date",
        "mode",
        "source_bucket",
        "ticker",
        "signal",
        "price",
        ...FORWARD_RETURN_FIELDS,
        "forward_returns_updated_at",
        "composite_score",
        "capital_flow_score",
        "flow_data_quality_grade",
        "provider_used",
        "raw_item",
      ].join(","),
    )
    .order("signal_date", { ascending: false })
    .order("rank", { ascending: true })
    .limit(parseLimit(limit));

  if (signalDate) {
    query = query.eq("signal_date", signalDate);
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
      ticker: ticker?.toUpperCase(),
      signal_date: signalDate,
      mode,
      source_bucket: sourceBucket,
      limit: parseLimit(limit),
    },
    rows: (data ?? []).map((row) =>
      withRawItemActionFields(row as unknown as Record<string, unknown>),
    ),
  };
}
