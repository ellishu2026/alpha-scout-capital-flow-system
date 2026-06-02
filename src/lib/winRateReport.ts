import "server-only";

import { signalSnapshotTableName } from "@/lib/signalSnapshots";
import {
  getSupabaseAdminClient,
  getSupabaseConfigStatus,
  isSupabaseConfigured,
} from "@/lib/supabaseAdmin";
import type {
  CalibrationReadiness,
  ForwardWindowStats,
  StockCandidate,
  WinRateGroupSummary,
  WinRateReport,
} from "@/types/stock";

const FORWARD_WINDOWS = [
  {
    key: "forward1D",
    field: "forward_1d_return_pct",
  },
  {
    key: "forward3D",
    field: "forward_3d_return_pct",
  },
  {
    key: "forward5D",
    field: "forward_5d_return_pct",
  },
  {
    key: "forward10D",
    field: "forward_10d_return_pct",
  },
  {
    key: "forward20D",
    field: "forward_20d_return_pct",
  },
] as const;

const MIN_RECOMMENDED_CALIBRATION_SAMPLES = 30;

type WinRateReportQuery = {
  from?: string;
  to?: string;
  mode?: string;
  signal?: string;
  sourceBucket?: string;
  minSamples?: number;
  limit?: number;
};

type SignalPerformanceRow = {
  signal_date: string;
  mode: string | null;
  source_bucket: string | null;
  ticker: string;
  signal: string | null;
  capital_flow_score: number | string | null;
  composite_score: number | string | null;
  flow_data_quality_grade: string | null;
  provider_used: string | null;
  action_signal?: string | null;
  action_confidence?: string | null;
  raw_item?: StockCandidate | null;
  forward_1d_return_pct: number | string | null;
  forward_3d_return_pct: number | string | null;
  forward_5d_return_pct: number | string | null;
  forward_10d_return_pct: number | string | null;
  forward_20d_return_pct: number | string | null;
};

type ForwardWindowKey = (typeof FORWARD_WINDOWS)[number]["key"];

const emptyWindowStats: ForwardWindowStats = {
  sampleCount: 0,
  winCount: 0,
  lossCount: 0,
  winRatePct: null,
  avgReturnPct: null,
  medianReturnPct: null,
  bestReturnPct: null,
  worstReturnPct: null,
};

function parseLimit(limit: number | undefined) {
  return Number.isFinite(limit)
    ? Math.min(Math.max(Math.floor(limit as number), 1), 500)
    : 200;
}

function parseMinSamples(minSamples: number | undefined) {
  return Number.isFinite(minSamples)
    ? Math.max(Math.floor(minSamples as number), 0)
    : 1;
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;

  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function roundPct(value: number) {
  return Math.round(value * 100) / 100;
}

function median(values: number[]) {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function scoreBucket(value: unknown) {
  const score = numberOrNull(value);

  if (score == null) return "Unknown";
  if (score >= 90) return "90-100";
  if (score >= 80) return "80-89";
  if (score >= 70) return "70-79";
  if (score >= 60) return "60-69";

  return "below-60";
}

function emptyGroup(groupName: string): WinRateGroupSummary {
  return {
    groupName,
    totalSignals: 0,
    availableSamplesByWindow: {
      forward1D: 0,
      forward3D: 0,
      forward5D: 0,
      forward10D: 0,
      forward20D: 0,
    },
    forward1D: { ...emptyWindowStats },
    forward3D: { ...emptyWindowStats },
    forward5D: { ...emptyWindowStats },
    forward10D: { ...emptyWindowStats },
    forward20D: { ...emptyWindowStats },
  };
}

function calculateWindowStats(values: number[]): ForwardWindowStats {
  if (values.length === 0) {
    return { ...emptyWindowStats };
  }

  const winCount = values.filter((value) => value > 0).length;
  const lossCount = values.length - winCount;
  const total = values.reduce((sum, value) => sum + value, 0);

  return {
    sampleCount: values.length,
    winCount,
    lossCount,
    winRatePct: roundPct((winCount / values.length) * 100),
    avgReturnPct: roundPct(total / values.length),
    medianReturnPct: roundPct(median(values) ?? 0),
    bestReturnPct: roundPct(Math.max(...values)),
    worstReturnPct: roundPct(Math.min(...values)),
  };
}

function hasAnyForwardReturn(row: SignalPerformanceRow) {
  return FORWARD_WINDOWS.some(
    (window) => numberOrNull(row[window.field]) != null,
  );
}

function rawItem(row: SignalPerformanceRow) {
  return row.raw_item && typeof row.raw_item === "object" ? row.raw_item : null;
}

function legacyAction(row: SignalPerformanceRow) {
  return row.action_signal ?? rawItem(row)?.actionSignal ?? "Unknown";
}

function entryAction(row: SignalPerformanceRow) {
  return (
    rawItem(row)?.entryActionSignal ??
    row.action_signal ??
    rawItem(row)?.actionSignal ??
    "Unknown"
  );
}

function positionAction(row: SignalPerformanceRow) {
  return rawItem(row)?.positionActionSignal ?? "Unknown";
}

function actionConfidence(row: SignalPerformanceRow) {
  return row.action_confidence ?? rawItem(row)?.actionConfidence ?? "Unknown";
}

function entryConfidence(row: SignalPerformanceRow) {
  return (
    rawItem(row)?.entryActionConfidence ??
    row.action_confidence ??
    rawItem(row)?.actionConfidence ??
    "Unknown"
  );
}

function positionConfidence(row: SignalPerformanceRow) {
  return rawItem(row)?.positionActionConfidence ?? "Unknown";
}

function buildCalibrationReadiness({
  totalSignals,
  availableForwardReturnRows,
  insufficientForwardReturnRows,
  overall,
}: {
  totalSignals: number;
  availableForwardReturnRows: number;
  insufficientForwardReturnRows: number;
  overall: WinRateGroupSummary;
}): CalibrationReadiness {
  const readyWindows = FORWARD_WINDOWS.map((window) => window.key).filter(
    (key): key is ForwardWindowKey =>
      overall[key].sampleCount >= MIN_RECOMMENDED_CALIBRATION_SAMPLES,
  );

  return {
    totalSignals,
    availableForwardReturnRows,
    insufficientForwardReturnRows,
    minRecommendedSamples: MIN_RECOMMENDED_CALIBRATION_SAMPLES,
    isReadyForRuleCalibration: readyWindows.length > 0,
    readyWindows,
    notReadyReason:
      readyWindows.length > 0
        ? null
        : "Forward return samples are still insufficient for reliable calibration.",
  };
}

function buildGroupSummary(groupName: string, rows: SignalPerformanceRow[]) {
  const summary = emptyGroup(groupName);
  summary.totalSignals = rows.length;

  FORWARD_WINDOWS.forEach((window) => {
    const values = rows
      .map((row) => numberOrNull(row[window.field]))
      .filter((value): value is number => value != null);
    const stats = calculateWindowStats(values);

    summary.availableSamplesByWindow[window.key] = stats.sampleCount;
    summary[window.key] = stats;
  });

  return summary;
}

function groupedSummaries({
  rows,
  groupName,
  minSamples,
}: {
  rows: SignalPerformanceRow[];
  groupName: (row: SignalPerformanceRow) => string;
  minSamples: number;
}) {
  const groups = new Map<string, SignalPerformanceRow[]>();

  rows.forEach((row) => {
    const name = groupName(row);
    const existing = groups.get(name);

    if (existing) {
      existing.push(row);
    } else {
      groups.set(name, [row]);
    }
  });

  const summaries = Array.from(groups.entries()).map(([name, groupRows]) =>
    buildGroupSummary(name, groupRows),
  );

  if (!rows.some(hasAnyForwardReturn)) {
    return summaries.sort(
      (a, b) =>
        b.totalSignals - a.totalSignals || a.groupName.localeCompare(b.groupName),
    );
  }

  return summaries
    .filter((summary) =>
      Object.values(summary.availableSamplesByWindow).some(
        (sampleCount) => sampleCount >= minSamples,
      ),
    )
    .sort((a, b) => {
      const aSamples = Object.values(a.availableSamplesByWindow).reduce(
        (sum, value) => sum + value,
        0,
      );
      const bSamples = Object.values(b.availableSamplesByWindow).reduce(
        (sum, value) => sum + value,
        0,
      );

      return bSamples - aSamples || a.groupName.localeCompare(b.groupName);
    });
}

function emptyReport({
  filters,
  generatedAt,
  error,
}: {
  filters: WinRateReport["filters"];
  generatedAt: string;
  error?: string;
}): WinRateReport {
  const overall = emptyGroup("Overall");

  return {
    ok: error == null,
    filters,
    generatedAt,
    totalRowsScanned: 0,
    availableForwardReturnRows: 0,
    insufficientForwardReturnRows: 0,
    calibrationReadiness: buildCalibrationReadiness({
      totalSignals: 0,
      availableForwardReturnRows: 0,
      insufficientForwardReturnRows: 0,
      overall,
    }),
    summaries: {
      overall,
      bySignal: [],
      byMode: [],
      bySourceBucket: [],
      byEntryAction: [],
      byPositionAction: [],
      byLegacyAction: [],
      byActionConfidence: [],
      byEntryConfidence: [],
      byPositionConfidence: [],
      byDataQualityGrade: [],
      byProviderUsed: [],
      byCapitalFlowScoreBucket: [],
      byCompositeScoreBucket: [],
    },
    error,
  };
}

function reportFilters({
  from,
  to,
  mode,
  signal,
  sourceBucket,
  minSamples,
  limit,
}: Required<Pick<WinRateReportQuery, "minSamples" | "limit">> &
  Omit<WinRateReportQuery, "minSamples" | "limit">) {
  return {
    from,
    to,
    mode,
    signal,
    source_bucket: sourceBucket,
    min_samples: minSamples,
    limit,
  };
}

export async function buildWinRateReport({
  from,
  to,
  mode,
  signal,
  sourceBucket,
  minSamples,
  limit,
}: WinRateReportQuery = {}): Promise<WinRateReport> {
  const parsedLimit = parseLimit(limit);
  const parsedMinSamples = parseMinSamples(minSamples);
  const generatedAt = new Date().toISOString();
  const filters = reportFilters({
    from,
    to,
    mode,
    signal,
    sourceBucket,
    minSamples: parsedMinSamples,
    limit: parsedLimit,
  });

  if (!isSupabaseConfigured()) {
    return emptyReport({
      filters,
      generatedAt,
      error: getSupabaseConfigStatus().reason ?? "SUPABASE_ENV_MISSING",
    });
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return emptyReport({
      filters,
      generatedAt,
      error: "SUPABASE_UNAVAILABLE",
    });
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
        "capital_flow_score",
        "composite_score",
        "flow_data_quality_grade",
        "provider_used",
        "raw_item",
        ...FORWARD_WINDOWS.map((window) => window.field),
      ].join(","),
    )
    .order("signal_date", { ascending: false })
    .limit(parsedLimit);

  if (from) {
    query = query.gte("signal_date", from);
  }

  if (to) {
    query = query.lte("signal_date", to);
  }

  if (mode) {
    query = query.eq("mode", mode);
  }

  if (signal) {
    query = query.eq("signal", signal);
  }

  if (sourceBucket) {
    query = query.eq("source_bucket", sourceBucket);
  }

  const { data, error } = await query;

  if (error) {
    return emptyReport({
      filters,
      generatedAt,
      error: error.message,
    });
  }

  const rows = (data ?? []) as unknown as SignalPerformanceRow[];
  const availableForwardReturnRows = rows.filter(hasAnyForwardReturn).length;
  const insufficientForwardReturnRows = rows.length - availableForwardReturnRows;
  const overall = buildGroupSummary("Overall", rows);

  return {
    ok: true,
    filters,
    generatedAt,
    totalRowsScanned: rows.length,
    availableForwardReturnRows,
    insufficientForwardReturnRows,
    calibrationReadiness: buildCalibrationReadiness({
      totalSignals: rows.length,
      availableForwardReturnRows,
      insufficientForwardReturnRows,
      overall,
    }),
    summaries: {
      overall,
      bySignal: groupedSummaries({
        rows,
        groupName: (row) => row.signal ?? "Unknown",
        minSamples: parsedMinSamples,
      }),
      byMode: groupedSummaries({
        rows,
        groupName: (row) => row.mode ?? "Unknown",
        minSamples: parsedMinSamples,
      }),
      bySourceBucket: groupedSummaries({
        rows,
        groupName: (row) => row.source_bucket ?? "Unknown",
        minSamples: parsedMinSamples,
      }),
      byEntryAction: groupedSummaries({
        rows,
        groupName: entryAction,
        minSamples: parsedMinSamples,
      }),
      byPositionAction: groupedSummaries({
        rows,
        groupName: positionAction,
        minSamples: parsedMinSamples,
      }),
      byLegacyAction: groupedSummaries({
        rows,
        groupName: legacyAction,
        minSamples: parsedMinSamples,
      }),
      byActionConfidence: groupedSummaries({
        rows,
        groupName: actionConfidence,
        minSamples: parsedMinSamples,
      }),
      byEntryConfidence: groupedSummaries({
        rows,
        groupName: entryConfidence,
        minSamples: parsedMinSamples,
      }),
      byPositionConfidence: groupedSummaries({
        rows,
        groupName: positionConfidence,
        minSamples: parsedMinSamples,
      }),
      byDataQualityGrade: groupedSummaries({
        rows,
        groupName: (row) => row.flow_data_quality_grade ?? "Unknown",
        minSamples: parsedMinSamples,
      }),
      byProviderUsed: groupedSummaries({
        rows,
        groupName: (row) => row.provider_used ?? "Unknown",
        minSamples: parsedMinSamples,
      }),
      byCapitalFlowScoreBucket: groupedSummaries({
        rows,
        groupName: (row) => scoreBucket(row.capital_flow_score),
        minSamples: parsedMinSamples,
      }),
      byCompositeScoreBucket: groupedSummaries({
        rows,
        groupName: (row) => scoreBucket(row.composite_score),
        minSamples: parsedMinSamples,
      }),
    },
  };
}
