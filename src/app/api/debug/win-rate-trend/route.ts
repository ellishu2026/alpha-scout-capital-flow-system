import { buildWinRateTrendReport } from "@/lib/winRateTrend";
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
    : 500;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const result = await buildWinRateTrendReport({
    limit: parseLimit(searchParams.get("limit")),
    window: searchParams.get("window"),
    actionType: searchParams.get("actionType"),
    action: searchParams.get("action"),
    candidate: searchParams.get("candidate"),
    rolling: searchParams.get("rolling"),
  });

  return NextResponse.json(result);
}
