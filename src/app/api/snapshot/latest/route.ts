import { buildLatestSnapshot } from "@/lib/refresh";
import { NextResponse } from "next/server";

export async function GET() {
  const snapshot = await buildLatestSnapshot();

  return NextResponse.json(snapshot);
}
