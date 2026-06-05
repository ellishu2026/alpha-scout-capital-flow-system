import {
  MOOMOO_FLOW_QUALITY_SCORE,
  MOOMOO_FLOW_TIER,
  MOOMOO_FLOW_TIER_LABEL,
  MOOMOO_CAPITAL_FLOW_SOURCE,
  MOOMOO_HISTORICAL_XLSX_IMPORT_SOURCE,
  MOOMOO_PROVIDER,
  MOOMOO_QUOTA_GUARD,
  ingestMoomooDailyFlows,
  type MoomooIngestItem,
} from "@/lib/moomooCapitalFlow";
import { NextRequest, NextResponse } from "next/server";

function isAuthorized(request: NextRequest) {
  const token = process.env.MOOMOO_INGEST_TOKEN;

  if (!token) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${token}`;
}

function validDate(value: unknown) {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? value : null;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        date?: unknown;
        source?: unknown;
        items?: unknown;
      }
    | null;
  const date = validDate(body?.date);

  const validSource =
    body?.source === MOOMOO_PROVIDER ||
    body?.source === MOOMOO_CAPITAL_FLOW_SOURCE ||
    body?.source === MOOMOO_HISTORICAL_XLSX_IMPORT_SOURCE;

  if (!body || !date || !validSource || !Array.isArray(body.items)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Invalid Moomoo ingest payload.",
        required: {
          date: "YYYY-MM-DD",
          source: `${MOOMOO_PROVIDER}, ${MOOMOO_CAPITAL_FLOW_SOURCE}, or ${MOOMOO_HISTORICAL_XLSX_IMPORT_SOURCE}`,
          items: "array",
        },
      },
      { status: 400 },
    );
  }

  const ingestResult = await ingestMoomooDailyFlows({
    date,
    items: body.items as MoomooIngestItem[],
  });

  return NextResponse.json({
    ok: ingestResult.failedCount === 0,
    generatedAt: new Date().toISOString(),
    provider: body.source,
    date,
    flowDataTier: MOOMOO_FLOW_TIER,
    flowDataTierLabel: MOOMOO_FLOW_TIER_LABEL,
    flowDataQualityScore: MOOMOO_FLOW_QUALITY_SCORE,
    archiveStatus: "SAVED",
    maxSymbolsPerRun: MOOMOO_QUOTA_GUARD.maxSymbolsPerRun,
    receivedCount: body.items.length,
    savedCount: ingestResult.savedCount,
    failedCount: ingestResult.failedCount,
    skippedDueToScopeCount: ingestResult.skippedDueToScopeCount,
    requestGuard: {
      maxSymbolsPerRun: MOOMOO_QUOTA_GUARD.maxSymbolsPerRun,
      requestIntervalMs: MOOMOO_QUOTA_GUARD.requestIntervalMs,
      retryLimit: MOOMOO_QUOTA_GUARD.retryLimit,
      tradingApiAllowed: false,
    },
    results: ingestResult.results,
    productionFlowChanged: false,
  });
}
