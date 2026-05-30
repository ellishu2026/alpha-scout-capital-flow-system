import { Dashboard } from "@/app/Dashboard";
import { buildFixedWatchlistSnapshot } from "@/lib/liveMarketData";
import { buildLatestSnapshot } from "@/lib/refresh";
import type { SnapshotResponse } from "@/types/stock";

export const dynamic = "force-dynamic";

async function buildFixedSnapshotForTabs(): Promise<SnapshotResponse | null> {
  if (process.env.YAHOO_FINANCE_ENABLED !== "true") {
    return null;
  }

  try {
    return await buildFixedWatchlistSnapshot();
  } catch {
    return null;
  }
}

export default async function Home() {
  const [allSnapshot, fixedSnapshot] = await Promise.all([
    buildLatestSnapshot(),
    buildFixedSnapshotForTabs(),
  ]);

  return <Dashboard allSnapshot={allSnapshot} fixedSnapshot={fixedSnapshot} />;
}
