import { Dashboard } from "@/app/Dashboard";
import { buildActionHistoryReport } from "@/lib/actionHistory";
import { buildLatestSnapshotWithFixed } from "@/lib/refresh";
import { buildWinRateReport } from "@/lib/winRateReport";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [{ fixedSnapshot, ...allSnapshot }, winRateReport, actionHistoryReport] =
    await Promise.all([
      buildLatestSnapshotWithFixed(),
      buildWinRateReport({ limit: 500, minSamples: 1 }),
      buildActionHistoryReport({ limit: 20 }),
    ]);

  return (
    <Dashboard
      allSnapshot={allSnapshot}
      fixedSnapshot={fixedSnapshot ?? null}
      winRateReport={winRateReport}
      actionHistoryReport={actionHistoryReport}
    />
  );
}
