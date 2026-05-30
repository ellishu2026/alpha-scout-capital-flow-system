import "server-only";

import {
  getSupabaseAdminClient,
  getSupabaseConfigStatus,
  isSupabaseConfigured,
} from "@/lib/supabaseAdmin";
import type { SnapshotMode, SnapshotResponse } from "@/types/stock";

export const snapshotTableName = "alpha_scout_snapshots";

type SnapshotRow = {
  snapshot_date: string;
  mode: SnapshotMode;
  status: string;
  snapshot: SnapshotResponse;
  created_at?: string;
};

type SupabaseErrorLike = {
  message?: string;
  code?: string;
  details?: string;
};

export type SnapshotStoreWriteResult = {
  ok: boolean;
  status: "SAVED" | "DISABLED" | "FAILED";
  error?: string;
  errorCode?: string;
  errorDetails?: string;
};

function disabledResult(reason = "SUPABASE_ENV_MISSING"): SnapshotStoreWriteResult {
  return {
    ok: false,
    status: "DISABLED",
    error: reason,
    errorCode: reason,
  };
}

function failedResult(error: unknown): SnapshotStoreWriteResult {
  const supabaseError = error as SupabaseErrorLike;

  return {
    ok: false,
    status: "FAILED",
    error:
      supabaseError?.message ??
      (error instanceof Error ? error.message : "Unknown Supabase error"),
    errorCode: supabaseError?.code,
    errorDetails: supabaseError?.details,
  };
}

function savedResult(): SnapshotStoreWriteResult {
  return {
    ok: true,
    status: "SAVED",
  };
}

function toPlainJsonSnapshot(snapshot: SnapshotResponse) {
  return JSON.parse(JSON.stringify(snapshot)) as SnapshotResponse;
}

export function getSnapshotDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export async function saveSnapshot(
  mode: SnapshotMode,
  snapshot: SnapshotResponse,
) {
  if (!isSupabaseConfigured()) {
    return disabledResult(getSupabaseConfigStatus().reason);
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return disabledResult();
  }

  const snapshotDate = getSnapshotDate(new Date(snapshot.updatedAt));
  try {
    const { error } = await supabase.from(snapshotTableName).insert({
      snapshot_date: snapshotDate,
      mode,
      status: snapshot.status,
      snapshot: toPlainJsonSnapshot(snapshot),
    });

    if (error) {
      return failedResult(error);
    }

    return savedResult();
  } catch (error) {
    return failedResult(error);
  }
}

export async function upsertTodaySnapshot(
  mode: SnapshotMode,
  snapshot: SnapshotResponse,
) {
  if (!isSupabaseConfigured()) {
    return disabledResult(getSupabaseConfigStatus().reason);
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return disabledResult();
  }

  const snapshotDate = getSnapshotDate(new Date(snapshot.updatedAt));
  try {
    const { error } = await supabase.from(snapshotTableName).upsert(
      {
        snapshot_date: snapshotDate,
        mode,
        status: snapshot.status,
        snapshot: toPlainJsonSnapshot(snapshot),
      },
      {
        onConflict: "snapshot_date,mode",
      },
    );

    if (error) {
      return failedResult(error);
    }

    return savedResult();
  } catch (error) {
    return failedResult(error);
  }
}

export async function getLatestSnapshot(mode: SnapshotMode) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from(snapshotTableName)
    .select("snapshot")
    .eq("mode", mode)
    .order("snapshot_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Pick<SnapshotRow, "snapshot">>();

  if (error || !data?.snapshot) {
    return null;
  }

  return data.snapshot;
}

export async function getPreviousSnapshot(
  mode: SnapshotMode,
  beforeDate: string,
) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from(snapshotTableName)
    .select("snapshot")
    .eq("mode", mode)
    .lt("snapshot_date", beforeDate)
    .order("snapshot_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Pick<SnapshotRow, "snapshot">>();

  if (error || !data?.snapshot) {
    return null;
  }

  return data.snapshot;
}
