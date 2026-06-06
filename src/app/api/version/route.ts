import { APP_NAME, APP_VERSION } from "@/lib/version";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    appVersion: APP_VERSION,
    appName: APP_NAME,
    versionSource: "src/lib/version.ts",
    productionRuleChanged: false,
  });
}
