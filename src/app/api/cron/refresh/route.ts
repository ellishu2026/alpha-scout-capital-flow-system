import { refreshDailySnapshot } from "@/lib/refresh";
import { NextRequest, NextResponse } from "next/server";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return true;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function parseTopN(value: string | null) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return 15;

  const topN = Math.floor(parsed);

  return [15, 20, 30].includes(topN) ? topN : 15;
}

async function handleRefresh(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const result = await refreshDailySnapshot({
    topN: parseTopN(request.nextUrl.searchParams.get("topN")),
  });

  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  return handleRefresh(request);
}

export async function POST(request: NextRequest) {
  return handleRefresh(request);
}
