import { buildLatestSnapshotWithFixed } from "@/lib/refresh";
import { NextResponse } from "next/server";

export async function GET() {
  const snapshot = await buildLatestSnapshotWithFixed();

  return NextResponse.json(snapshot);
}
