import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const filePath = path.join(
      process.cwd(),
      "data/research/moomoo_flow_win_rate_v199.json",
    );
    const payload = JSON.parse(await readFile(filePath, "utf-8"));
    const summary = payload.summary ?? {};

    return NextResponse.json({
      ok: true,
      researchOnly: true,
      productionRuleChanged: false,
      moomooFlowRows: summary.moomooFlowRows ?? null,
      priceRows: summary.priceRows ?? null,
      forwardReturnRows: summary.forwardReturnRows ?? null,
      metricsCount: summary.metricsCount ?? payload.metrics?.length ?? null,
      bestSignalGroups: summary.bestSignalGroups ?? null,
      readyStatusSummary: summary.readyStatusSummary ?? null,
      ...payload,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        researchOnly: true,
        productionRuleChanged: false,
        error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      },
      { status: 500 },
    );
  }
}
