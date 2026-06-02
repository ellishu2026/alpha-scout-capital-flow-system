import { buildWinRateReport } from "@/lib/winRateReport";
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
    ? Math.min(Math.max(Math.floor(parsed), 1), 500)
    : 200;
}

function parseMinSamples(value: string | null) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.max(Math.floor(parsed), 0) : 1;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const from = request.nextUrl.searchParams.get("from")?.trim();
  const to = request.nextUrl.searchParams.get("to")?.trim();
  const mode = request.nextUrl.searchParams.get("mode")?.trim();
  const signal = request.nextUrl.searchParams.get("signal")?.trim();
  const sourceBucket = request.nextUrl.searchParams.get("source_bucket")?.trim();
  const minSamples = parseMinSamples(
    request.nextUrl.searchParams.get("min_samples"),
  );
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const result = await buildWinRateReport({
    from: from || undefined,
    to: to || undefined,
    mode: mode || undefined,
    signal: signal || undefined,
    sourceBucket: sourceBucket || undefined,
    minSamples,
    limit,
  });

  return NextResponse.json(result);
}
