import { buildEnhancedFlowCalibrationReport } from "@/lib/enhancedFlowCalibration";
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
    ? Math.min(Math.max(Math.floor(parsed), 1), 26)
    : 26;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const result = await buildEnhancedFlowCalibrationReport({ limit });

  return NextResponse.json(result);
}
