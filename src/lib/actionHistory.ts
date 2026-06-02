import "server-only";

import { signalSnapshotTableName } from "@/lib/signalSnapshots";
import {
  getSupabaseAdminClient,
  getSupabaseConfigStatus,
  isSupabaseConfigured,
} from "@/lib/supabaseAdmin";
import type {
  ActionHistoryReport,
  ActionHistoryRow,
  ActionHistorySummary,
  StockCandidate,
} from "@/types/stock";

type SignalSnapshotHistoryRow = {
  signal_date: string;
  created_at: string | null;
  mode: string | null;
  source_bucket: string | null;
  ticker: string;
  rank: number | string | null;
  composite_score: number | string | null;
  signal: string | null;
  flow_data_quality_grade: string | null;
  provider_used: string | null;
  action_signal?: string | null;
  raw_item?: StockCandidate | null;
};

const ENTRY_ORDER = {
  "Insufficient Data": 0,
  Avoid: 1,
  Watch: 2,
  "Buy Candidate": 3,
  Unknown: -1,
} as const;

const POSITION_ORDER = {
  Exit: 0,
  "Sell Candidate": 1,
  Reduce: 2,
  Hold: 3,
  "Insufficient Data": -1,
  Unknown: -1,
} as const;

function emptySummary(): ActionHistorySummary {
  return {
    totalRows: 0,
    newBuyCandidateCount: 0,
    entryUpgradeCount: 0,
    entryDowngradeCount: 0,
    positionUpgradeCount: 0,
    positionDowngradeCount: 0,
    newSellCandidateCount: 0,
    newExitCount: 0,
    noChangeCount: 0,
  };
}

function emptyReport(error?: string): ActionHistoryReport {
  return {
    ok: error == null,
    count: 0,
    actionHistorySummary: emptySummary(),
    rows: [],
    error,
  };
}

function errorMessage(error: unknown) {
  const supabaseError = error as { message?: string };

  return (
    supabaseError?.message ??
    (error instanceof Error ? error.message : "Unknown action history error")
  );
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;

  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function rawItem(row: SignalSnapshotHistoryRow) {
  return row.raw_item && typeof row.raw_item === "object" ? row.raw_item : null;
}

function entryAction(row?: SignalSnapshotHistoryRow | null) {
  if (!row) return "Unknown";

  return (
    rawItem(row)?.entryActionSignal ??
    row.action_signal ??
    rawItem(row)?.actionSignal ??
    "Unknown"
  );
}

function positionAction(row?: SignalSnapshotHistoryRow | null) {
  if (!row) return "Unknown";

  return rawItem(row)?.positionActionSignal ?? "Unknown";
}

function legacyAction(row?: SignalSnapshotHistoryRow | null) {
  if (!row) return "Unknown";

  return row.action_signal ?? rawItem(row)?.actionSignal ?? "Unknown";
}

function entryChange(current: string, previous: string) {
  if (previous === "Unknown") return `New ${current}`;
  if (current === previous) return "No Change";

  return `${previous} → ${current}`;
}

function positionChange(current: string, previous: string) {
  if (previous === "Unknown") return `New ${current}`;
  if (current === previous) return "No Change";

  return `${previous} → ${current}`;
}

function actionRank(
  action: string,
  order: Record<string, number>,
): number | null {
  return action in order ? order[action] : null;
}

function isUpgrade(
  current: string,
  previous: string,
  order: Record<string, number>,
) {
  const currentRank = actionRank(current, order);
  const previousRank = actionRank(previous, order);

  return currentRank != null && previousRank != null && currentRank > previousRank;
}

function isDowngrade(
  current: string,
  previous: string,
  order: Record<string, number>,
) {
  const currentRank = actionRank(current, order);
  const previousRank = actionRank(previous, order);

  return currentRank != null && previousRank != null && currentRank < previousRank;
}

function historyKey(row: SignalSnapshotHistoryRow) {
  return [row.ticker, row.mode ?? "UNKNOWN", row.source_bucket ?? "UNKNOWN"].join(
    "::",
  );
}

function buildHistoryRow(
  row: SignalSnapshotHistoryRow,
  previous?: SignalSnapshotHistoryRow,
): ActionHistoryRow {
  const currentEntry = entryAction(row);
  const previousEntry = entryAction(previous);
  const currentPosition = positionAction(row);
  const previousPosition = positionAction(previous);
  const rank = numberOrNull(row.rank);
  const previousRank = numberOrNull(previous?.rank);

  return {
    ticker: row.ticker,
    signalDate: row.signal_date,
    mode: row.mode,
    sourceBucket: row.source_bucket,
    rank,
    previousRank,
    rankChange: rank != null && previousRank != null ? rank - previousRank : null,
    entryActionSignal: currentEntry,
    previousEntryActionSignal: previousEntry,
    entryActionChange: entryChange(currentEntry, previousEntry),
    positionActionSignal: currentPosition,
    previousPositionActionSignal: previousPosition,
    positionActionChange: positionChange(currentPosition, previousPosition),
    actionSignal: legacyAction(row),
    previousActionSignal: legacyAction(previous),
    compositeScore: numberOrNull(row.composite_score),
    previousCompositeScore: numberOrNull(previous?.composite_score),
    signal: row.signal ?? "Unknown",
    previousSignal: previous?.signal ?? "Unknown",
    flowDataQualityGrade: row.flow_data_quality_grade,
    providerUsed: row.provider_used,
    createdAt: row.created_at,
    previousCreatedAt: previous?.created_at ?? null,
  };
}

function buildSummary(rows: ActionHistoryRow[]): ActionHistorySummary {
  const summary = emptySummary();

  summary.totalRows = rows.length;
  rows.forEach((row) => {
    if (
      row.entryActionSignal === "Buy Candidate" &&
      row.previousEntryActionSignal !== "Buy Candidate"
    ) {
      summary.newBuyCandidateCount += 1;
    }

    if (
      row.positionActionSignal === "Sell Candidate" &&
      row.previousPositionActionSignal !== "Sell Candidate"
    ) {
      summary.newSellCandidateCount += 1;
    }

    if (
      row.positionActionSignal === "Exit" &&
      row.previousPositionActionSignal !== "Exit"
    ) {
      summary.newExitCount += 1;
    }

    if (
      isUpgrade(
        row.entryActionSignal,
        row.previousEntryActionSignal,
        ENTRY_ORDER,
      )
    ) {
      summary.entryUpgradeCount += 1;
    }

    if (
      isDowngrade(
        row.entryActionSignal,
        row.previousEntryActionSignal,
        ENTRY_ORDER,
      )
    ) {
      summary.entryDowngradeCount += 1;
    }

    if (
      isUpgrade(
        row.positionActionSignal,
        row.previousPositionActionSignal,
        POSITION_ORDER,
      )
    ) {
      summary.positionUpgradeCount += 1;
    }

    if (
      isDowngrade(
        row.positionActionSignal,
        row.previousPositionActionSignal,
        POSITION_ORDER,
      )
    ) {
      summary.positionDowngradeCount += 1;
    }

    if (
      row.entryActionChange === "No Change" &&
      row.positionActionChange === "No Change"
    ) {
      summary.noChangeCount += 1;
    }
  });

  return summary;
}

export async function buildActionHistoryReport({
  limit = 20,
}: {
  limit?: number;
} = {}): Promise<ActionHistoryReport> {
  const parsedLimit = Math.min(Math.max(Math.floor(limit), 1), 200);

  if (!isSupabaseConfigured()) {
    return emptyReport(getSupabaseConfigStatus().reason ?? "SUPABASE_ENV_MISSING");
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return emptyReport("SUPABASE_UNAVAILABLE");
  }

  const fetchLimit = Math.min(Math.max(parsedLimit * 6, 200), 1000);
  const { data, error } = await supabase
    .from(signalSnapshotTableName)
    .select(
      [
        "signal_date",
        "created_at",
        "mode",
        "source_bucket",
        "ticker",
        "rank",
        "composite_score",
        "signal",
        "flow_data_quality_grade",
        "provider_used",
        "raw_item",
      ].join(","),
    )
    .order("signal_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("rank", { ascending: true })
    .limit(fetchLimit);

  if (error) {
    return emptyReport(errorMessage(error));
  }

  const rows = (data ?? []) as unknown as SignalSnapshotHistoryRow[];
  const rowsByKey = new Map<string, SignalSnapshotHistoryRow[]>();

  rows.forEach((row) => {
    const key = historyKey(row);
    const existing = rowsByKey.get(key);

    if (existing) {
      existing.push(row);
    } else {
      rowsByKey.set(key, [row]);
    }
  });

  const historyRows = rows
    .map((row) => {
      const group = rowsByKey.get(historyKey(row)) ?? [];
      const index = group.indexOf(row);

      return buildHistoryRow(row, group[index + 1]);
    })
    .slice(0, parsedLimit);

  return {
    ok: true,
    count: historyRows.length,
    actionHistorySummary: buildSummary(historyRows),
    rows: historyRows,
  };
}
