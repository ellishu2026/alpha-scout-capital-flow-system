import { updateForwardReturns } from "@/lib/forwardReturns";
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
    : undefined;
}

async function handleUpdate(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const result = await updateForwardReturns({
    limit: parseLimit(request.nextUrl.searchParams.get("limit")),
  });

  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  return handleUpdate(request);
}

export async function POST(request: NextRequest) {
  return handleUpdate(request);
}
