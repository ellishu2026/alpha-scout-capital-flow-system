import { snapshotTableName } from "@/lib/snapshotStore";
import {
  getSupabaseAdminClient,
  getSupabaseConfigStatus,
} from "@/lib/supabaseAdmin";
import { NextRequest, NextResponse } from "next/server";

type SupabaseErrorLike = {
  message?: string;
  code?: string;
  details?: string;
};

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return true;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function getSnapshotDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function errorPayload(error: unknown) {
  const supabaseError = error as SupabaseErrorLike;

  return {
    error:
      supabaseError?.message ??
      (error instanceof Error ? error.message : "Unknown Supabase error"),
    errorCode: supabaseError?.code,
    errorDetails: supabaseError?.details,
  };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const config = getSupabaseConfigStatus();

  if (!config.configured) {
    return NextResponse.json({
      ok: true,
      supabaseConfigured: false,
      hasSupabaseUrl: config.hasUrl,
      hasServiceRoleKey: config.hasServiceRoleKey,
      writeOk: false,
      readOk: false,
      error: config.reason,
      errorCode: config.reason,
    });
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json({
      ok: true,
      supabaseConfigured: false,
      writeOk: false,
      readOk: false,
      error: "SUPABASE_ENV_MISSING",
      errorCode: "SUPABASE_ENV_MISSING",
    });
  }

  const snapshotDate = getSnapshotDate();
  const debugSnapshot = {
    updatedAt: new Date().toISOString(),
    dataMode: "Daily Close Snapshot",
    refreshMode: "Auto Daily Refresh",
    mode: "MOCK",
    status: "MOCK",
    count: 0,
    items: [],
    diagnostic: "persistence-debug",
  };

  try {
    const { error: writeError } = await supabase.from(snapshotTableName).upsert(
      {
        snapshot_date: snapshotDate,
        mode: "DEBUG",
        status: "DEBUG",
        snapshot: debugSnapshot,
      },
      {
        onConflict: "snapshot_date,mode",
      },
    );

    if (writeError) {
      return NextResponse.json({
        ok: true,
        supabaseConfigured: true,
        hasSupabaseUrl: config.hasUrl,
        hasServiceRoleKey: config.hasServiceRoleKey,
        writeOk: false,
        readOk: false,
        ...errorPayload(writeError),
      });
    }

    const { data, error: readError } = await supabase
      .from(snapshotTableName)
      .select("snapshot_date,mode,status")
      .eq("snapshot_date", snapshotDate)
      .eq("mode", "DEBUG")
      .maybeSingle();

    if (readError) {
      return NextResponse.json({
        ok: true,
        supabaseConfigured: true,
        hasSupabaseUrl: config.hasUrl,
        hasServiceRoleKey: config.hasServiceRoleKey,
        writeOk: true,
        readOk: false,
        ...errorPayload(readError),
      });
    }

    return NextResponse.json({
      ok: true,
      supabaseConfigured: true,
      hasSupabaseUrl: config.hasUrl,
      hasServiceRoleKey: config.hasServiceRoleKey,
      writeOk: true,
      readOk: Boolean(data),
      snapshotDate,
      mode: "DEBUG",
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      supabaseConfigured: true,
      hasSupabaseUrl: config.hasUrl,
      hasServiceRoleKey: config.hasServiceRoleKey,
      writeOk: false,
      readOk: false,
      ...errorPayload(error),
    });
  }
}
