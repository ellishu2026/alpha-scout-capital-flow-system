import "server-only";

import { getSupabaseAdminClient, isSupabaseConfigured } from "@/lib/supabaseAdmin";
import type { SnapshotMode, SnapshotResponse } from "@/types/stock";

const tableName = "alpha_scout_snapshots";

type SnapshotRow = {
  snapshot_date: string;
  mode: SnapshotMode;
  status: string;
  snapshot: SnapshotResponse;
  created_at?: string;
};

export function getSnapshotDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export async function saveSnapshot(
  mode: SnapshotMode,
  snapshot: SnapshotResponse,
) {
  if (!isSupabaseConfigured()) {
    return { ok: false, disabled: true };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return { ok: false, disabled: true };
  }

  const snapshotDate = getSnapshotDate(new Date(snapshot.updatedAt));
  const { error } = await supabase.from(tableName).insert({
    snapshot_date: snapshotDate,
    mode,
    status: snapshot.status,
    snapshot,
  });

  return { ok: !error, disabled: false, error };
}

export async function upsertTodaySnapshot(
  mode: SnapshotMode,
  snapshot: SnapshotResponse,
) {
  if (!isSupabaseConfigured()) {
    return { ok: false, disabled: true };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return { ok: false, disabled: true };
  }

  const snapshotDate = getSnapshotDate(new Date(snapshot.updatedAt));
  const { error } = await supabase.from(tableName).upsert(
    {
      snapshot_date: snapshotDate,
      mode,
      status: snapshot.status,
      snapshot,
    },
    {
      onConflict: "snapshot_date,mode",
    },
  );

  return { ok: !error, disabled: false, error };
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
    .from(tableName)
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
    .from(tableName)
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
