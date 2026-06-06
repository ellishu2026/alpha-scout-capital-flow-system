import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const filePath = path.join(
      process.cwd(),
      "data/research/moomoo_flow_signal_candidates_v200.json",
    );
    const payload = JSON.parse(await readFile(filePath, "utf-8"));
    const summary = payload.summary ?? {};

    return NextResponse.json({
      ok: true,
      researchOnly: true,
      productionRuleChanged: false,
      version: "V2.0.0",
      candidateCount: summary.candidateCount ?? null,
      watchCount: summary.watchCount ?? null,
      riskSignalCount: summary.riskSignalCount ?? null,
      rejectedCount: summary.rejectedCount ?? null,
      topCandidates: summary.topCandidates ?? [],
      readyStatusSummary: summary.readyStatusSummary ?? null,
      recommendedNextStep:
        summary.recommendedNextStep ?? "V2.0.1 Flow Threshold Simulation",
      ...payload,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        researchOnly: true,
        productionRuleChanged: false,
        version: "V2.0.0",
        error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      },
      { status: 500 },
    );
  }
}
