import {
  buildUniverseLightScan,
  UNIVERSE_BUILD_VERSION,
} from "@/lib/liveMarketData";
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

function parseTopN(value: string | null) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return 15;

  const topN = Math.floor(parsed);

  return [15, 20, 30].includes(topN) ? topN : 15;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const topN = parseTopN(request.nextUrl.searchParams.get("topN"));
  const universe = await buildUniverseLightScan({ topN });

  return NextResponse.json({
    ok: true,
    universeBuildVersion: UNIVERSE_BUILD_VERSION,
    count: universe.universeCoverageSummary.dedupedUniverseCount,
    universeCoverageSummary: universe.universeCoverageSummary,
    rows: universe.rows.slice(0, limit),
  });
}
