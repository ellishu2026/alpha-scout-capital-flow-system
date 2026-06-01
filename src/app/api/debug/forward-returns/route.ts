import { queryForwardReturns } from "@/lib/forwardReturns";
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

  const ticker = request.nextUrl.searchParams.get("ticker")?.trim();
  const signalDate = request.nextUrl.searchParams.get("signal_date")?.trim();
  const mode = request.nextUrl.searchParams.get("mode")?.trim();
  const sourceBucket = request.nextUrl.searchParams.get("source_bucket")?.trim();
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const result = await queryForwardReturns({
    ticker: ticker || undefined,
    signalDate: signalDate || undefined,
    mode: mode || undefined,
    sourceBucket: sourceBucket || undefined,
    limit,
  });

  return NextResponse.json(result);
}
