import { querySignalSnapshots } from "@/lib/signalSnapshots";
import { NextRequest, NextResponse } from "next/server";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return true;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function parseLimit(value: string | null) {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? Math.min(Math.max(Math.floor(parsed), 1), 200)
    : 50;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get("date")?.trim();
  const ticker = request.nextUrl.searchParams.get("ticker")?.trim();
  const mode = request.nextUrl.searchParams.get("mode")?.trim();
  const sourceBucket = request.nextUrl.searchParams.get("source_bucket")?.trim();
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const result = await querySignalSnapshots({
    date: date || undefined,
    ticker: ticker || undefined,
    mode: mode || undefined,
    sourceBucket: sourceBucket || undefined,
    limit,
  });

  return NextResponse.json(result);
}
