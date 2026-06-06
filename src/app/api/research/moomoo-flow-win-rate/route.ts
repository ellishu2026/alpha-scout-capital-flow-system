import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const filePath = path.join(
      process.cwd(),
      "data/research/moomoo_flow_win_rate_v1978.json",
    );
    const payload = JSON.parse(await readFile(filePath, "utf-8"));

    return NextResponse.json({
      ok: true,
      researchOnly: true,
      productionRuleChanged: false,
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
