import { Dashboard } from "@/app/Dashboard";
import { buildLatestSnapshotWithFixed } from "@/lib/refresh";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { fixedSnapshot, ...allSnapshot } = await buildLatestSnapshotWithFixed();

  return (
    <Dashboard
      allSnapshot={allSnapshot}
      fixedSnapshot={fixedSnapshot ?? null}
    />
  );
}
