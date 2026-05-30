import { buildSecFinancialDebug } from "@/lib/secFinancialData";
import { NextRequest, NextResponse } from "next/server";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return true;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown SEC financial error";
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const ticker = request.nextUrl.searchParams.get("ticker")?.trim().toUpperCase();

  if (!ticker) {
    return NextResponse.json(
      {
        ok: false,
        message: "Missing ticker query parameter.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await buildSecFinancialDebug(ticker);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      ticker,
      cikFound: false,
      financialDataSource: "N/A",
      error: errorMessage(error),
    });
  }
}
