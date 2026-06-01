"use client";

import { FIXED_WATCHLIST_SYMBOLS } from "@/lib/marketUniverse";
import {
  formatCurrency,
  formatLargeCurrency,
  formatMarketCap,
  formatPercent,
  getDataStatusLabel,
  getPoolLabel,
} from "@/lib/scoring";
import type { SnapshotResponse, StockCandidate, StockPool } from "@/types/stock";
import { useMemo, useState } from "react";

type TabId = "ALL" | "FIXED_LIST" | "MID_CAP" | "HIGH_PRICE" | "OVERLAP";

const tabs: { id: TabId; label: string; pool?: StockPool }[] = [
  { id: "ALL", label: "All" },
  { id: "FIXED_LIST", label: "Fixed List", pool: "WATCHLIST" },
  { id: "MID_CAP", label: "Market Cap $50B-$300B", pool: "MID_CAP" },
  { id: "HIGH_PRICE", label: "Price > $800", pool: "HIGH_PRICE" },
  { id: "OVERLAP", label: "Overlap", pool: "OVERLAP" },
];

const tableHeaders = [
  "Rank",
  "Chg",
  "Ticker",
  "Pool",
  "Market Cap",
  "Price",
  "FCF",
  "FCF QoQ %",
  "Flow 3D",
  "Flow 5D",
  "Flow 9D",
  "Flow 3W",
  "Flow 5W",
  "Composite",
  "Margin Δ",
  "FCF Δ",
  "Flow Δ",
  "Signal",
  "Data",
];

const MID_CAP_MIN = 50_000_000_000;
const MID_CAP_MAX = 300_000_000_000;
const HIGH_PRICE_MIN = 800;
const fixedWatchlist = new Set<string>(FIXED_WATCHLIST_SYMBOLS);

function isMidCap(candidate: StockCandidate) {
  return (
    candidate.marketCap >= MID_CAP_MIN && candidate.marketCap <= MID_CAP_MAX
  );
}

function isHighPrice(candidate: StockCandidate) {
  return candidate.price > HIGH_PRICE_MIN;
}

function isOverlap(candidate: StockCandidate) {
  const overlapCount = [
    fixedWatchlist.has(candidate.ticker),
    isMidCap(candidate),
    isHighPrice(candidate),
  ].filter(Boolean).length;

  return overlapCount >= 2;
}

function toneForValue(value: number | null | undefined) {
  if (value == null) {
    return "text-slate-500";
  }

  if (value > 0) {
    return "font-semibold text-emerald-700";
  }

  if (value < 0) {
    return "font-semibold text-rose-700";
  }

  return "text-slate-500";
}

function poolClass(pool: StockPool) {
  const classes: Record<StockPool, string> = {
    MID_CAP: "bg-sky-50 text-sky-700 ring-sky-200",
    HIGH_PRICE: "bg-violet-50 text-violet-700 ring-violet-200",
    OVERLAP: "bg-amber-50 text-amber-800 ring-amber-200",
    WATCHLIST: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  };

  return classes[pool];
}

function scoreClass(score: number) {
  if (score >= 85) {
    return "bg-emerald-50 font-bold text-emerald-800 ring-emerald-200";
  }

  if (score >= 75) {
    return "bg-blue-50 font-bold text-blue-800 ring-blue-200";
  }

  if (score >= 65) {
    return "bg-amber-50 font-semibold text-amber-800 ring-amber-200";
  }

  return "bg-rose-50 font-semibold text-rose-800 ring-rose-200";
}

function compactSignal(signal: string) {
  const labels: Record<string, string> = {
    "Strong Accumulation": "Strong",
    Accumulation: "Accum.",
    Watchlist: "Watch",
    Watch: "Watch",
    Neutral: "Neutral",
    "Weak / Avoid": "Weak",
  };

  return labels[signal] ?? signal;
}

function signalClass(signal: string) {
  const label = compactSignal(signal);

  if (label === "Strong") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (label === "Accum.") {
    return "bg-blue-50 text-blue-700 ring-blue-200";
  }

  if (label === "Watch") {
    return "bg-amber-50 text-amber-800 ring-amber-200";
  }

  if (label === "Weak") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }

  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function rankChangeClass(changeType?: StockCandidate["changeType"]) {
  if (changeType === "NEW") {
    return "bg-violet-50 text-violet-700 ring-violet-200";
  }

  if (changeType === "UP") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (changeType === "DOWN") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }

  return "bg-slate-100 text-slate-500 ring-slate-200";
}

function hasUnavailableFinancials(candidate: StockCandidate) {
  return (
    candidate.financialDataSource !== "SEC" &&
    candidate.fcf === 0 &&
    candidate.fcfQoqChange === 0
  );
}

function financialDataLabel(candidate: StockCandidate) {
  if (candidate.financialDataSource === "SEC") {
    return "SEC";
  }

  if (candidate.financialDataSource === "N/A") {
    return "N/A";
  }

  return "Fallback";
}

function getPersistenceLabel(snapshot: SnapshotResponse) {
  if (snapshot.persistenceStatus === "SAVED") {
    return "Saved";
  }

  if (snapshot.persistenceStatus === "FAILED") {
    return "Failed";
  }

  return "Not Saved";
}

function TableRow({ candidate }: { candidate: StockCandidate }) {
  const numericCell = "px-1.5 py-1.5 text-left text-[10px] tabular-nums";
  const financialsUnavailable = hasUnavailableFinancials(candidate);

  return (
    <tr className="border-b border-slate-100 transition-colors hover:bg-slate-50/80">
      <td className="px-1.5 py-1.5 text-left text-[10px] font-semibold tabular-nums text-slate-900">
        #{candidate.rank}
      </td>
      <td className="px-1.5 py-1.5">
        <span
          className={`inline-flex min-w-8 justify-center rounded px-1 py-0.5 text-[9px] font-bold tabular-nums ring-1 ${rankChangeClass(
            candidate.changeType,
          )}`}
        >
          {candidate.changeLabel ?? "-"}
        </span>
      </td>
      <td className="px-1.5 py-1.5 text-[11px] font-bold text-slate-950">
        {candidate.ticker}
      </td>
      <td className="px-1.5 py-1.5">
        <span
          className={`inline-flex whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-semibold ring-1 ${poolClass(
            candidate.pool,
          )}`}
        >
          {getPoolLabel(candidate.pool)}
        </span>
      </td>
      <td className={`${numericCell} text-slate-700`}>
        {formatMarketCap(candidate.marketCap)}
      </td>
      <td className={`${numericCell} text-slate-700`}>
        {formatCurrency(candidate.price)}
      </td>
      <td className={`${numericCell} text-slate-700`}>
        {financialsUnavailable ? "N/A" : formatLargeCurrency(candidate.fcf)}
      </td>
      <td className={`${numericCell} ${toneForValue(candidate.fcfQoqChange)}`}>
        {financialsUnavailable ? "N/A" : formatPercent(candidate.fcfQoqChange)}
      </td>
      <td
        className={`${numericCell} ${toneForValue(candidate.capitalFlow3D)}`}
      >
        {formatLargeCurrency(candidate.capitalFlow3D)}
      </td>
      <td
        className={`${numericCell} ${toneForValue(candidate.capitalFlow5D)}`}
      >
        {formatLargeCurrency(candidate.capitalFlow5D)}
      </td>
      <td
        className={`${numericCell} ${toneForValue(candidate.capitalFlow9D)}`}
      >
        {formatLargeCurrency(candidate.capitalFlow9D)}
      </td>
      <td
        className={`${numericCell} ${toneForValue(candidate.capitalFlow3W)}`}
      >
        {formatLargeCurrency(candidate.capitalFlow3W)}
      </td>
      <td
        className={`${numericCell} ${toneForValue(candidate.capitalFlow5W)}`}
      >
        {formatLargeCurrency(candidate.capitalFlow5W)}
      </td>
      <td className="px-1.5 py-1.5 text-left">
        <span
          className={`inline-flex min-w-10 justify-center rounded px-1 py-0.5 text-[10px] tabular-nums ring-1 ${scoreClass(
            candidate.compositeScore,
          )}`}
        >
          {candidate.compositeScore.toFixed(1)}
        </span>
      </td>
      <td className={`${numericCell} ${toneForValue(candidate.marginChange)}`}>
        {formatPercent(candidate.marginChange)}
      </td>
      <td
        className={`${numericCell} ${toneForValue(
          candidate.cashFlowChangeRatio,
        )}`}
      >
        {financialsUnavailable
          ? "N/A"
          : formatPercent(candidate.cashFlowChangeRatio)}
      </td>
      <td
        className={`${numericCell} ${toneForValue(
          candidate.capitalFlowChangeRatio,
        )}`}
      >
        {formatPercent(candidate.capitalFlowChangeRatio)}
      </td>
      <td className="px-1.5 py-1.5">
        <span
          className={`inline-flex rounded px-1 py-0.5 text-[9px] font-semibold ring-1 ${signalClass(
            candidate.signal,
          )}`}
        >
          {compactSignal(candidate.signal)}
        </span>
      </td>
      <td className="px-1.5 py-1.5">
        <span className="inline-flex rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold text-slate-600 ring-1 ring-slate-200">
          {financialDataLabel(candidate)}
        </span>
      </td>
    </tr>
  );
}

export function Dashboard({
  allSnapshot,
  fixedSnapshot,
}: {
  allSnapshot: SnapshotResponse;
  fixedSnapshot: SnapshotResponse | null;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("ALL");
  const activeTabLabel =
    tabs.find((tab) => tab.id === activeTab)?.label ?? "All";
  const updatedAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(allSnapshot.updatedAt));
  const displayedItems = useMemo(() => {
    if (activeTab === "FIXED_LIST") {
      return fixedSnapshot?.items ?? [];
    }

    if (activeTab === "MID_CAP") {
      return allSnapshot.items.filter(isMidCap);
    }

    if (activeTab === "HIGH_PRICE") {
      return allSnapshot.items.filter(isHighPrice);
    }

    if (activeTab === "OVERLAP") {
      return allSnapshot.items.filter(isOverlap);
    }

    return allSnapshot.items;
  }, [activeTab, allSnapshot.items, fixedSnapshot?.items]);
  const movementSummary =
    activeTab === "FIXED_LIST"
      ? fixedSnapshot?.movementSummary
      : allSnapshot.movementSummary;
  const droppedSymbols =
    activeTab === "FIXED_LIST" ? [] : (allSnapshot.droppedSymbols ?? []);
  const providerCoverage = allSnapshot.providerCoverageSummary;
  const summaryCards = [
    {
      label: "Universe",
      value: "Market Scan",
      detail: "Market cap $50B-$300B or price > $800",
    },
    {
      label: "Top 11",
      value: `${allSnapshot.count} Candidates`,
      detail: `${allSnapshot.candidateCount ?? allSnapshot.count} passed quote filter from ${allSnapshot.scannedCount ?? "seed"} symbols`,
    },
    {
      label: "Scoring Model",
      value: "30 / 40 / 30",
      detail: "Margin, FCF, and capital flow weighted scoring",
    },
    {
      label: "Data Status",
      value: getDataStatusLabel(allSnapshot.status),
      detail: `Snapshot: ${getPersistenceLabel(allSnapshot)}`,
    },
    {
      label: "Provider Coverage",
      value:
        providerCoverage != null
          ? `${providerCoverage.realProviderCoveragePct}%`
          : "N/A",
      detail:
        providerCoverage != null
          ? `Archive ${providerCoverage.archiveHitCount} · Live ${
              providerCoverage.alphaVantageLiveCount +
              providerCoverage.polygonLiveCount
            } · Fallback ${providerCoverage.yfinanceFallbackCount}`
          : "Awaiting refresh coverage summary",
    },
  ];

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <section className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-2 px-2.5 py-2.5 sm:px-3 lg:px-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Daily Close Snapshot
              </p>
              <h1 className="mt-0.5 whitespace-nowrap text-[21px] font-semibold tracking-normal text-slate-950 sm:text-2xl lg:text-[26px]">
                AlphaScout Capital Flow System V1.6.7
              </h1>
              <p className="mt-0.5 text-xs text-slate-600">
                Capital-flow-driven US stock candidate selection dashboard
              </p>
            </div>
            <div className="grid gap-x-3 gap-y-0.5 rounded border border-slate-200 bg-white px-2.5 py-2 text-[11px] shadow-sm sm:grid-cols-4 lg:min-w-[620px]">
              <div>
                <span className="text-slate-500">Data Mode</span>
                <p className="font-medium text-slate-950">
                  {allSnapshot.dataMode}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Refresh Mode</span>
                <p className="font-medium text-slate-950">
                  {allSnapshot.refreshMode}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Last Updated</span>
                <p className="font-medium text-slate-950">{updatedAt} UTC</p>
              </div>
              <div>
                <span className="text-slate-500">Selected</span>
                <p className="font-medium text-slate-950">
                  Top {allSnapshot.count} ·{" "}
                  {getDataStatusLabel(allSnapshot.status)}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-0.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="font-medium text-slate-700">Scoring</span>
            <span className="text-slate-600">
              Margin 30% · FCF 40% · Capital Flow 30%
            </span>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1600px] px-2.5 py-2.5 sm:px-3 lg:px-4">
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
          {summaryCards.map((card) => (
            <article
              key={card.label}
              className="rounded border border-slate-200 bg-white px-2.5 py-2 shadow-sm"
            >
              <p className="text-[11px] font-medium text-slate-500">
                {card.label}
              </p>
              <p className="mt-0.5 text-base font-semibold text-slate-950">
                {card.value}
              </p>
              <p className="mt-0.5 truncate text-[11px] leading-3 text-slate-600">
                {card.detail}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-2.5 flex flex-col gap-1.5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-base font-semibold text-slate-950">
                Ranked Candidates · {activeTabLabel} · {displayedItems.length} shown
              </h2>
              {movementSummary ? (
                <p className="text-[11px] font-medium text-slate-500">
                  New {movementSummary.newCount} · Up {movementSummary.upCount} ·
                  Down {movementSummary.downCount} · Same{" "}
                  {movementSummary.sameCount}
                  {droppedSymbols.length > 0
                    ? ` · Dropped ${droppedSymbols.join(", ")}`
                    : ""}
                </p>
              ) : null}
            </div>
            <p className="text-[11px] text-slate-600">
              Composite score sorted descending after pool merge and deduplication.
            </p>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
                  activeTab === tab.id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-1.5 overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
          <div className="max-h-[calc(100vh-205px)] overflow-auto">
            <table className="w-full min-w-[1180px] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  {tableHeaders.map((header) => (
                    <th
                      key={header}
                      className="whitespace-nowrap border-b border-slate-200 px-1.5 py-1.5 text-left text-[9px] font-bold uppercase text-slate-500"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedItems.map((candidate) => (
                  <TableRow key={candidate.ticker} candidate={candidate} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
