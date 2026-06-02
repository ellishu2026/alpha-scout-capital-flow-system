import { Dashboard } from "@/app/Dashboard";
import { buildLatestSnapshotWithFixed } from "@/lib/refresh";
import { buildWinRateReport } from "@/lib/winRateReport";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [{ fixedSnapshot, ...allSnapshot }, winRateReport] =
    await Promise.all([
      buildLatestSnapshotWithFixed(),
      buildWinRateReport({ limit: 500, minSamples: 1 }),
    ]);

  return (
    <Dashboard
      allSnapshot={allSnapshot}
      fixedSnapshot={fixedSnapshot ?? null}
      winRateReport={winRateReport}
    />
  );
}
