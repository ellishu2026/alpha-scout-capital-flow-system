import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const filePath = path.join(
      process.cwd(),
      "data",
      "research",
      "signal_match_win_rate_v2025.json",
    );
    const payload = JSON.parse(await readFile(filePath, "utf-8"));

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
        version: "V2.0.2.5",
        error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      },
      { status: 500 },
    );
  }
}
