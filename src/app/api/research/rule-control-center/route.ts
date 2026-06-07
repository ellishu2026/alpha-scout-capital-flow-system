import { buildRuleControlResearch } from "@/lib/ruleControlResearch";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const payload = await buildRuleControlResearch();
    return NextResponse.json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        researchOnly: true,
        productionRuleChanged: false,
        version: "V2.0.2.1",
        error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      },
      { status: 500 },
    );
  }
}
