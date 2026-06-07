"use client";

import { APP_TITLE } from "@/lib/version";
import {
  FLOW_SIGNAL_CATEGORIES,
  getFlowStateFromNetFlow,
  type FlowState,
} from "@/lib/flowSignalDefinitions";
import { FIXED_WATCHLIST_SYMBOLS } from "@/lib/marketUniverse";
import {
  formatCurrency,
  formatLargeCurrency,
  formatMarketCap,
  formatPercent,
  getDataStatusLabel,
  getPoolLabel,
} from "@/lib/scoring";
import type {
  ActionHistoryReport,
  SnapshotResponse,
  StockCandidate,
  StockPool,
  WinRateReport,
} from "@/types/stock";
import { useMemo, useState } from "react";

type RuleControlResearchSignal = {
  signalName: string;
  category: string;
  horizon: string;
  sampleSize: number;
  winRate: number | null;
  avgReturn: number | null;
  medianReturn: number | null;
  profitFactor: number | null;
  readyStatus: string;
  bucket: string;
  selectionReason: string;
};

type SignalMatchCategory = {
  category: string;
  status: string;
  latestDate: string | null;
  winRate1D: number | null;
  winRate3D: number | null;
  winRate5D: number | null;
  winRate10D: number | null;
  winRate20D: number | null;
  totalWins: number;
  totalFails: number;
  validSamples: number;
  trend: string;
};

type SignalMatchWindowStat = {
  wins: number;
  fails: number;
  valid: number;
  winRate: number | null;
  daysIncluded: number;
};

type FixedTickerWindowSummary = {
  definition: string;
  sum: {
    rank: "SUM";
    ticker: "Fixed List Total";
    windows: Record<string, SignalMatchWindowStat>;
  };
  tickers: Array<{
    ticker: string;
    windows: Record<string, SignalMatchWindowStat>;
  }>;
};

type RuleControlResearch = {
  researchOnly: true;
  productionRuleChanged: false;
  version: string;
  researchVersion: string;
  candidateCount: number;
  watchCount: number;
  rejectedCount: number;
  riskSignalCount: number;
  forwardReturnRows: number;
  priceRows: number;
  metricsCount: number;
  readyStatusSummary: Record<string, number>;
  topCandidates: RuleControlResearchSignal[];
  leaderboardRows: RuleControlResearchSignal[];
  signalMatch: {
    status: string;
    latestDate: string | null;
    definition: string;
    categories: SignalMatchCategory[];
    fixedTickerWindowSummary: FixedTickerWindowSummary | null;
    latestDayDetails: Array<{
      ticker: string;
      flowState: string;
      signalDirection: string;
      closeDirection: string;
      result: string;
    }>;
    latestFlowDirectionSummary: {
      checkedTickers: number;
      validSamples: number;
      wins: number;
      fails: number;
      excluded: number;
      dailyWinRate: number | null;
    } | null;
  };
  forwardReturns: {
    status: string;
    checkedRows: number;
    updatedRows: number;
    insufficient: number;
    priceRows: number;
    metricsCount: number;
  };
  promotionGate: {
    status: string;
    promotable: number;
    reason: string;
  };
  recommendation: string;
  recommendedNextStep: string;
  missingDependencies: string[];
};

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
  "1D",
  "3D",
  "5D",
  "10D",
  "20D",
  "5W",
  "6W",
  "9W",
  "12W",
  "Composite",
  "Margin Δ",
  "FCF Δ",
  "Est.Flow Δ",
  "Entry Act.",
  "Position Act.",
  "Conf.",
  "Flow State",
  "Data Q",
  "Source",
];
const estimatedFlowWindowHeaders = new Set([
  "1D",
  "3D",
  "5D",
  "10D",
  "20D",
  "5W",
  "6W",
  "9W",
  "12W",
]);

const stickyHeaderClass =
  "sticky top-0 z-30 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-1.5 py-1.5 text-left text-[9px] font-bold uppercase text-slate-500";
const normalHeaderClass =
  "sticky top-0 z-20 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-1.5 py-1.5 text-left text-[9px] font-bold uppercase text-slate-500";
const rankStickyCellClass =
  "sticky left-0 z-10 w-12 min-w-12 border-r border-slate-200 bg-white px-1.5 py-1.5 text-left text-[10px] font-semibold tabular-nums text-slate-900 shadow-[2px_0_3px_rgba(15,23,42,0.05)]";
const changeStickyCellClass =
  "sticky left-12 z-10 w-10 min-w-10 border-r border-slate-200 bg-white px-1.5 py-1.5 shadow-[2px_0_3px_rgba(15,23,42,0.05)]";
const tickerStickyCellClass =
  "sticky left-[5.5rem] z-10 w-20 min-w-20 border-r border-slate-200 bg-white px-1.5 py-1.5 text-[11px] font-bold text-slate-950 shadow-[2px_0_3px_rgba(15,23,42,0.05)]";
const estimatedFlowTooltip =
  "Estimated flow based on Enhanced OHLCV Proxy, not real buy/sell net flow.";
const moomooDirectFlowTooltip =
  "Moomoo Direct Flow from archived capital distribution data.";

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

function flowStateClass(flowState: FlowState) {
  if (flowState === "Inflow") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (flowState === "Outflow") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }

  if (flowState === "Reversal" || flowState === "Fluctuate") {
    return "bg-amber-50 text-amber-800 ring-amber-200";
  }

  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function compactActionSignal(action?: StockCandidate["actionSignal"]) {
  if (action === "Buy Candidate") return "Buy Cand.";
  if (action === "Insufficient Data") return "Insuff.";

  return action ?? "N/A";
}

function compactConfidence(confidence?: StockCandidate["actionConfidence"]) {
  if (confidence === "Medium") return "Med";

  return confidence ?? "N/A";
}

function actionClass(action?: StockCandidate["actionSignal"]) {
  if (action === "Buy Candidate") {
    return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  }

  if (action === "Watch") {
    return "bg-blue-50 text-blue-700 ring-blue-200";
  }

  if (action === "Avoid") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }

  if (action === "Insufficient Data") {
    return "bg-amber-50 text-amber-800 ring-amber-200";
  }

  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function compactPositionAction(
  action?: StockCandidate["positionActionSignal"],
) {
  if (action === "Sell Candidate") return "Sell Cand.";
  if (action === "Insufficient Data") return "Insuff.";

  return action ?? "N/A";
}

function positionActionClass(action?: StockCandidate["positionActionSignal"]) {
  if (action === "Hold") {
    return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  }

  if (action === "Reduce") {
    return "bg-amber-50 text-amber-800 ring-amber-200";
  }

  if (action === "Sell Candidate") {
    return "bg-orange-50 text-orange-800 ring-orange-200";
  }

  if (action === "Exit") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }

  if (action === "Insufficient Data") {
    return "bg-slate-100 text-slate-600 ring-slate-200";
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

function qualityClass(grade?: StockCandidate["flowDataQualityGrade"]) {
  if (grade === "A") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (grade === "B") return "bg-blue-50 text-blue-700 ring-blue-200";
  if (grade === "C") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (grade === "D") return "bg-rose-50 text-rose-700 ring-rose-200";

  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function providerShortLabel(provider?: StockCandidate["providerUsed"]) {
  const labels: Record<string, string> = {
    ALPHA_VANTAGE_ARCHIVE: "AV Archive",
    TWELVE_DATA_ARCHIVE: "TWELVE Archive",
    EODHD_ARCHIVE: "EODHD Archive",
    POLYGON_ARCHIVE: "Polygon Archive",
    MOOMOO_CAPITAL_DISTRIBUTION_ARCHIVE: "Moomoo Flow Archive",
    MOOMOO_HISTORICAL_XLSX_IMPORT: "Moomoo XLSX Import",
    MOOMOO_CAPITAL_DISTRIBUTION: "Moomoo Flow",
    ALPHA_VANTAGE: "Alpha",
    TWELVE_DATA: "TWELVE",
    EODHD: "EODHD",
    POLYGON: "Polygon Live",
    YFINANCE_COMPOSITE_PROXY: "YF Proxy",
    YFINANCE_CHAIKIN: "YFinance",
    MOCK: "Mock",
  };

  return provider ? (labels[provider] ?? provider) : "N/A";
}

function compactFlowVersion(version?: StockCandidate["flowCalculationVersion"]) {
  if (!version) return "N/A";
  if (version.includes("PROVIDER_LADDER")) return "Provider Ladder";
  if (version.includes("COMPOSITE_PROXY")) return "Composite Proxy";
  if (version.includes("YFINANCE")) return "YFinance";

  return version.replace(/^V/, "");
}

function formatMaybeNumber(value: number | null | undefined, suffix = "") {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value}${suffix}`
    : "N/A";
}

function uniqueTickers(items: StockCandidate[]) {
  return Array.from(new Set(items.map((item) => item.ticker).filter(Boolean)));
}

function quotaLabel(
  used: number | null | undefined,
  remaining: number | null | undefined,
) {
  return `Used ${formatMaybeNumber(used)} / Left ${formatMaybeNumber(remaining)}`;
}

function TickerList({
  label,
  tickers,
}: {
  label: string;
  tickers?: string[];
}) {
  return (
    <div className="min-w-0">
      <span className="text-slate-500">{label}</span>
      <p className="mt-0.5 truncate font-medium text-slate-800">
        {tickers && tickers.length > 0 ? tickers.join(", ") : "None"}
      </p>
    </div>
  );
}

function DiagnosticMetric({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div>
      <span className="text-slate-500">{label}</span>
      <p className="mt-0.5 font-semibold text-slate-950">
        {value ?? "N/A"}
      </p>
    </div>
  );
}

function hasUnavailableFinancials(candidate: StockCandidate) {
  return (
    candidate.financialDataSource !== "SEC" &&
    candidate.fcf === 0 &&
    candidate.fcfQoqChange === 0
  );
}

function financialDataLabel(candidate: StockCandidate) {
  return candidate.financialDataSource ?? "N/A";
}

function sourceLabel(candidate: StockCandidate) {
  return `${providerShortLabel(candidate.providerUsed)} / ${financialDataLabel(candidate)}`;
}

type RawFlowWindowItem = Partial<StockCandidate> & Partial<Record<string, unknown>>;

type FlowWindowCandidate = StockCandidate & {
  rawItem?: RawFlowWindowItem;
  raw_item?: RawFlowWindowItem;
} & Partial<Record<string, unknown>>;

const flowWindowFieldMap = {
  capitalFlow1D: "capital_flow_1d",
  capitalFlow3D: "capital_flow_3d",
  capitalFlow5D: "capital_flow_5d",
  capitalFlow10D: "capital_flow_10d",
  capitalFlow20D: "capital_flow_20d",
  capitalFlow5W: "capital_flow_5w",
  capitalFlow6W: "capital_flow_6w",
  capitalFlow9W: "capital_flow_9w",
  capitalFlow12W: "capital_flow_12w",
} as const;

function numberOrNull(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;

  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function getFlowWindowValue(
  candidate: StockCandidate,
  key: keyof typeof flowWindowFieldMap,
) {
  const item = candidate as FlowWindowCandidate;
  const snakeKey = flowWindowFieldMap[key];

  return (
    numberOrNull(item[key]) ??
    numberOrNull(item[snakeKey]) ??
    numberOrNull(item.rawItem?.[key]) ??
    numberOrNull(item.rawItem?.[snakeKey]) ??
    numberOrNull(item.raw_item?.[key]) ??
    numberOrNull(item.raw_item?.[snakeKey])
  );
}

function getOneDayFlowValue(candidate: StockCandidate) {
  if (candidate.moomooFlowAvailable && typeof candidate.moomooNetFlow === "number") {
    return candidate.moomooNetFlow;
  }

  return getFlowWindowValue(candidate, "capitalFlow1D");
}

function flow1DSourceLabel(candidate: StockCandidate) {
  if (candidate.moomooFlowAvailable && typeof candidate.moomooNetFlow === "number") {
    return "Moomoo Direct Flow";
  }

  return (
    candidate.flow1DSource ??
    candidate.oneDayFlowSource ??
    candidate.flowDataTierLabel ??
    candidate.estimatedFlowProxySource ??
    "Enhanced OHLCV Proxy"
  );
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
  const flow1D = getOneDayFlowValue(candidate);
  const flow1DSource = flow1DSourceLabel(candidate);
  const flow3D = getFlowWindowValue(candidate, "capitalFlow3D");
  const flow5D = getFlowWindowValue(candidate, "capitalFlow5D");
  const flow10D = getFlowWindowValue(candidate, "capitalFlow10D");
  const flow20D = getFlowWindowValue(candidate, "capitalFlow20D");
  const flow5W = getFlowWindowValue(candidate, "capitalFlow5W");
  const flow6W = getFlowWindowValue(candidate, "capitalFlow6W");
  const flow9W = getFlowWindowValue(candidate, "capitalFlow9W");
  const flow12W = getFlowWindowValue(candidate, "capitalFlow12W");
  const flowState = getFlowStateFromNetFlow(flow1D);

  return (
    <tr className="border-b border-slate-100 transition-colors hover:bg-slate-50/80">
      <td className={rankStickyCellClass}>
        #{candidate.rank}
      </td>
      <td className={changeStickyCellClass}>
        <span
          className={`inline-flex min-w-8 justify-center rounded px-1 py-0.5 text-[9px] font-bold tabular-nums ring-1 ${rankChangeClass(
            candidate.changeType,
          )}`}
        >
          {candidate.changeLabel ?? "-"}
        </span>
      </td>
      <td className={tickerStickyCellClass}>
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
        className={`${numericCell} ${toneForValue(flow1D)}`}
        title={`Window: 1D · Source: ${flow1DSource}. ${
          candidate.moomooFlowAvailable
            ? moomooDirectFlowTooltip
            : estimatedFlowTooltip
        }`}
      >
        {formatLargeCurrency(flow1D)}
      </td>
      <td
        className={`${numericCell} ${toneForValue(flow3D)}`}
        title={`${estimatedFlowTooltip} Window: 3D`}
      >
        {formatLargeCurrency(flow3D)}
      </td>
      <td
        className={`${numericCell} ${toneForValue(flow5D)}`}
        title={`${estimatedFlowTooltip} Window: 5D`}
      >
        {formatLargeCurrency(flow5D)}
      </td>
      <td
        className={`${numericCell} ${toneForValue(flow10D)}`}
        title={`${estimatedFlowTooltip} Window: 10D`}
      >
        {formatLargeCurrency(flow10D)}
      </td>
      <td
        className={`${numericCell} ${toneForValue(flow20D)}`}
        title={`${estimatedFlowTooltip} Window: 20D`}
      >
        {formatLargeCurrency(flow20D)}
      </td>
      <td
        className={`${numericCell} ${toneForValue(flow5W)}`}
        title={`${estimatedFlowTooltip} Window: 5W`}
      >
        {formatLargeCurrency(flow5W)}
      </td>
      <td
        className={`${numericCell} ${toneForValue(flow6W)}`}
        title={`${estimatedFlowTooltip} Window: 6W`}
      >
        {formatLargeCurrency(flow6W)}
      </td>
      <td
        className={`${numericCell} ${toneForValue(flow9W)}`}
        title={`${estimatedFlowTooltip} Window: 9W`}
      >
        {formatLargeCurrency(flow9W)}
      </td>
      <td
        className={`${numericCell} ${toneForValue(flow12W)}`}
        title={`${estimatedFlowTooltip} Window: 12W`}
      >
        {formatLargeCurrency(flow12W)}
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
          title={`Confidence: ${candidate.actionConfidence ?? "N/A"} · Reasons: ${
            candidate.actionReasons?.join("; ") ?? "None"
          } · Risk: ${candidate.actionRiskFlags?.join(", ") ?? "None"}`}
          className={`inline-flex max-w-28 truncate rounded px-1 py-0.5 text-[9px] font-bold ring-1 ${actionClass(
            candidate.entryActionSignal ?? candidate.actionSignal,
          )}`}
        >
          {compactActionSignal(candidate.entryActionSignal ?? candidate.actionSignal)}
        </span>
      </td>
      <td className="px-1.5 py-1.5">
        <span
          title={`Confidence: ${candidate.positionActionConfidence ?? "N/A"} · Reasons: ${
            candidate.actionReasons?.join("; ") ?? "None"
          } · Risk: ${candidate.actionRiskFlags?.join(", ") ?? "None"}`}
          className={`inline-flex max-w-28 truncate rounded px-1 py-0.5 text-[9px] font-bold ring-1 ${positionActionClass(
            candidate.positionActionSignal,
          )}`}
        >
          {compactPositionAction(candidate.positionActionSignal)}
        </span>
      </td>
      <td className="px-1.5 py-1.5">
        <span className="inline-flex min-w-10 justify-center rounded bg-slate-100 px-1 py-0.5 text-[9px] font-bold text-slate-700 ring-1 ring-slate-200">
          {compactConfidence(candidate.entryActionConfidence ?? candidate.actionConfidence)}
        </span>
      </td>
      <td className="px-1.5 py-1.5">
        <span
          title={`Flow state from 1D net flow. Raw action signal: ${candidate.signal}`}
          className={`inline-flex rounded px-1 py-0.5 text-[9px] font-semibold ring-1 ${flowStateClass(
            flowState,
          )}`}
        >
          {flowState}
        </span>
      </td>
      <td className="px-1.5 py-1.5">
        <span
          className={`inline-flex min-w-10 justify-center rounded px-1 py-0.5 text-[9px] font-bold tabular-nums ring-1 ${qualityClass(
            candidate.flowDataQualityGrade,
          )}`}
        >
          {candidate.flowDataQualityGrade
            ? `${candidate.flowDataQualityGrade} ${candidate.flowDataQualityScore ?? ""}`
            : "N/A"}
        </span>
      </td>
      <td className="px-1.5 py-1.5">
        <span
          title={`${candidate.archiveStatus ?? "NO_ARCHIVE_STATUS"} · ${compactFlowVersion(candidate.flowCalculationVersion)}`}
          className="inline-flex max-w-32 truncate rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold text-slate-600 ring-1 ring-slate-200"
        >
          {sourceLabel(candidate)}
        </span>
      </td>
    </tr>
  );
}

function ControlPill({
  label,
  active = false,
  disabled = false,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`h-6 whitespace-nowrap rounded-full border px-2.5 text-[10px] font-semibold transition-colors ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : disabled
            ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );
}

function ControlStat({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium text-slate-500">{label}:</span>{" "}
      <span className="font-semibold text-slate-800">{value ?? "N/A"}</span>
    </span>
  );
}

function matchRate(value: number | null | undefined) {
  return value == null ? "N/A" : `${(value * 100).toFixed(1)}%`;
}

function fixedMatchCell(value: SignalMatchWindowStat | undefined) {
  if (!value) {
    return "missing input";
  }
  if (value.valid === 0 || value.winRate == null) {
    return "no valid samples";
  }

  return `${value.wins} / ${value.valid} = ${matchRate(value.winRate)}`;
}

function WinRateSection({
  report,
  ruleControlResearch,
  expanded,
  onToggle,
}: {
  report?: WinRateReport;
  ruleControlResearch?: RuleControlResearch;
  expanded: boolean;
  onToggle: () => void;
}) {
  const readiness = report?.calibrationReadiness;
  const researchReady = (ruleControlResearch?.forwardReturnRows ?? 0) > 0;
  const readinessStatus = researchReady
    ? "Research Ready / Production Locked"
    : readiness?.isReadyForRuleCalibration
      ? "Ready"
      : "Missing Research Data";
  const thresholdSummary = report?.thresholdSimulationSummary;
  const thresholdStatus = researchReady
    ? "Research Ready / Simulation Prep"
    : thresholdSummary?.status ?? "Missing Research Data";
  const sampleCount =
    ruleControlResearch?.forwardReturnRows ??
    thresholdSummary?.samples ??
    readiness?.availableForwardReturnRows ??
    0;
  const minSamples =
    thresholdSummary?.minRecommendedSamples ??
    readiness?.minRecommendedSamples ??
    30;
  const promotionStatus = ruleControlResearch
    ? "Research Ready / Production Locked"
    : thresholdSummary?.promotionAllowed
      ? "Ready"
      : "Locked / Not Ready";
  const candidatePills = FLOW_SIGNAL_CATEGORIES;
  const selectedCategory = candidatePills[0];
  const bestCandidate = ruleControlResearch?.topCandidates?.[0];
  const signalMatchRows = ruleControlResearch?.signalMatch.categories ?? [];
  const selectedMatchRow = signalMatchRows.find(
    (row) => row.category === selectedCategory.label,
  );
  const flowDirectionSummary =
    ruleControlResearch?.signalMatch.latestFlowDirectionSummary;
  const abSamplesLabel = bestCandidate
    ? String(bestCandidate.sampleSize)
    : `${sampleCount} / ${minSamples}`;
  const forwardColumns = ["1D", "3D", "5D", "10D", "20D"];
  const fixedWindowColumns = ["1D", "3D", "5D", "10D", "20D", "5W", "6W", "9W", "12W"];
  const fixedTickerWindowSummary =
    ruleControlResearch?.signalMatch.fixedTickerWindowSummary;
  const insufficientMetrics =
    ruleControlResearch?.readyStatusSummary?.["Not Ready"] ?? 0;

  return (
    <section className="mt-1 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-semibold text-slate-950">
          Win Rate / Rule Optimization Center
        </h2>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
          <span className="font-medium text-slate-500">
            Samples {sampleCount} forward return rows
          </span>
          <button
            type="button"
            onClick={onToggle}
            className="min-h-8 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            {expanded ? "Win Rate ▴" : "Win Rate ▾"}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-1.5 space-y-2">
          <article className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px]">
            <div className="flex flex-col gap-1 border-b border-slate-200 pb-1.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-slate-900">Rule Control Center</p>
                <p className="text-slate-500">Rule selection, A/B review, promotion gate, and rolling recommendation.</p>
              </div>
              <p className="font-medium text-slate-600">
                Signal Match: {matchRate(flowDirectionSummary?.dailyWinRate)} 1D · Status: {readinessStatus}
              </p>
            </div>

            <div className="mt-2 grid gap-2 lg:grid-cols-5">
              <div className="rounded border border-slate-200 bg-white p-2">
                <p className="font-semibold text-slate-900">Production Rule</p>
                <div className="mt-1 space-y-0.5 text-slate-600">
                  <p>Current: V1.7.6 Production</p>
                  <p>Status: Active · Locked</p>
                  <p>Auto Activation: Disabled</p>
                  <p>Risk Gate Required</p>
                  <p>Research Candidate Set: V2.0.2.2 Signal Direction Match Rate</p>
                  <p>Candidates: {ruleControlResearch?.candidateCount ?? "N/A"} · Watch: {ruleControlResearch?.watchCount ?? "N/A"} · Rejected: {ruleControlResearch?.rejectedCount ?? "N/A"}</p>
                  <p>Latest Match Date: {ruleControlResearch?.signalMatch.latestDate ?? "N/A"}</p>
                  <p>Production Rule Changed: false</p>
                </div>
              </div>

              <div className="rounded border border-slate-200 bg-white p-2 lg:col-span-2">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-semibold text-slate-900">Candidate Threshold Selection</p>
                  <p className="font-medium text-slate-600">{thresholdStatus}</p>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {candidatePills.map((item) => (
                    <ControlPill
                      key={item.label}
                      label={item.label}
                      active={item.label === selectedCategory.label}
                    />
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-slate-600">
                  <ControlStat label="Selected" value={selectedCategory.label} />
                  <ControlStat label="Definition" value={selectedCategory.definition} />
                  <ControlStat label="1D Match" value={matchRate(selectedMatchRow?.winRate1D)} />
                  <ControlStat label="3D Avg" value={matchRate(selectedMatchRow?.winRate3D)} />
                  <ControlStat label="5D Avg" value={matchRate(selectedMatchRow?.winRate5D)} />
                  <ControlStat label="Recommendation" value="Research Ready / Simulation Prep" />
                </div>
              </div>

              <div className="rounded border border-slate-200 bg-white p-2">
                <p className="font-semibold text-slate-900">A/B Comparison</p>
                <p className="mt-1 text-slate-600">A: Current Production · B: {selectedCategory.label} Match Signal</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <ControlPill label="Simulation Required" disabled />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-slate-600">
                  <ControlStat label="Status" value="Research Only / Simulation Not Yet Promoted" />
                  <ControlStat label="Samples" value={flowDirectionSummary?.validSamples ?? abSamplesLabel} />
                </div>
              </div>

              <div className="rounded border border-slate-200 bg-white p-2">
                <p className="font-semibold text-slate-900">Rule Promotion Gate</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-slate-600">
                  <span>{promotionStatus}</span>
                  <span>Approval Required</span>
                  <span>Auto Activation Disabled</span>
                  <span>Promotable {ruleControlResearch?.promotionGate.promotable ?? 0}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <ControlPill label="Approve New Threshold" disabled />
                  <ControlPill label="Reject Candidate" disabled />
                  <ControlPill label="Keep Current Rules" active />
                </div>
                <p className="mt-1 text-slate-500">
                  Reason: {ruleControlResearch?.promotionGate.reason ?? `Need at least ${minSamples} forward return samples.`}
                </p>
              </div>
            </div>

            <div className="mt-2 rounded border border-slate-200 bg-white p-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-semibold text-slate-900">Rolling Recommendation</p>
                <p className="font-medium text-slate-600">
                  {ruleControlResearch?.recommendation ?? "No Change · Auto Activation Disabled · Confidence: Low"}
                </p>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <ControlPill label="Review Candidate" disabled />
                <ControlPill label="Promote to Approval" disabled />
                <ControlPill label="Keep Current Rules" active />
              </div>
            </div>
          </article>

          <article className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px]">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-slate-900">Signal Match Rate</p>
                <p className="text-slate-500">Win = signal direction matches same-day close price direction</p>
              </div>
              <p className="font-medium text-slate-600">
                {ruleControlResearch
                  ? `Latest ${ruleControlResearch.signalMatch.latestDate ?? "N/A"} · Fixed tickers ${flowDirectionSummary?.checkedTickers ?? 9} · Not Ready metrics ${insufficientMetrics}`
                  : "Missing research dependency"}
              </p>
            </div>

            <div className="mt-1.5 max-h-80 overflow-auto rounded border border-slate-200 bg-white">
              <table className="w-full min-w-[900px] text-left">
                <thead className="text-[9px] uppercase text-slate-500">
                  <tr>
                    <th className="sticky left-0 top-0 z-30 w-12 min-w-12 border-r border-slate-200 bg-slate-50 px-2 py-1 shadow-[2px_0_3px_rgba(15,23,42,0.05)]">Rank</th>
                    <th className="sticky left-12 top-0 z-30 min-w-48 border-r border-slate-200 bg-slate-50 px-2 py-1 shadow-[2px_0_3px_rgba(15,23,42,0.05)]">Flow Category</th>
                    {forwardColumns.map((label) => (
                      <th key={label} className="sticky top-0 z-20 bg-slate-50 px-2 py-1">{label} Win Rate</th>
                    ))}
                    <th className="sticky top-0 z-20 bg-slate-50 px-2 py-1">Valid Samples</th>
                    <th className="sticky top-0 z-20 bg-slate-50 px-2 py-1">Trend</th>
                    <th className="sticky top-0 z-20 bg-slate-50 px-2 py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {signalMatchRows.slice(0, 5).map((row, index) => (
                    <tr key={row.category} className="border-t border-slate-100">
                      <td className="sticky left-0 z-10 w-12 min-w-12 border-r border-slate-200 bg-white px-2 py-1.5 font-bold text-slate-900 shadow-[2px_0_3px_rgba(15,23,42,0.05)]">
                        #{index + 1}
                      </td>
                      <td className="sticky left-12 z-10 min-w-48 border-r border-slate-200 bg-white px-2 py-1.5 font-semibold text-slate-900 shadow-[2px_0_3px_rgba(15,23,42,0.05)]">
                        <span className="block max-w-48 truncate">{row.category}</span>
                        <span className="text-[9px] font-medium text-slate-500">Same-Day Match</span>
                      </td>
                      <td className="px-2 py-1.5 font-semibold text-slate-800">{matchRate(row.winRate1D)}</td>
                      <td className="px-2 py-1.5 text-slate-700">{matchRate(row.winRate3D)}</td>
                      <td className="px-2 py-1.5 text-slate-700">{matchRate(row.winRate5D)}</td>
                      <td className="px-2 py-1.5 text-slate-700">{matchRate(row.winRate10D)}</td>
                      <td className="px-2 py-1.5 text-slate-700">{matchRate(row.winRate20D)}</td>
                      <td className="px-2 py-1.5 text-slate-600">{row.validSamples}</td>
                      <td className="px-2 py-1.5 text-slate-700">{row.trend}</td>
                      <td className="px-2 py-1.5">
                        <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {signalMatchRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-2 py-3 text-slate-500">
                        Missing research dependency: {ruleControlResearch?.missingDependencies?.join(", ") || "signal_match_win_rate_v2022.json"}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {fixedTickerWindowSummary ? (
              <div className="mt-2 rounded border border-slate-200 bg-white p-2">
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-900">Signal Match for Fixed List</p>
                    <p className="text-slate-500">
                      Ticker-level match rate across time windows · Win = signal direction matches same-day close direction
                    </p>
                  </div>
                  <p className="text-slate-600">
                    Latest {ruleControlResearch?.signalMatch.latestDate ?? "N/A"}
                  </p>
                </div>
                <div className="mt-1 max-h-72 overflow-auto rounded border border-slate-200">
                  <table className="w-full min-w-[900px] text-left text-[10px]">
                    <thead className="text-[9px] uppercase text-slate-500">
                      <tr>
                        <th className="sticky left-0 top-0 z-30 w-16 min-w-16 border-r border-slate-200 bg-slate-50 px-2 py-1">Rank</th>
                        <th className="sticky left-16 top-0 z-30 min-w-36 border-r border-slate-200 bg-slate-50 px-2 py-1">Ticker</th>
                        {fixedWindowColumns.map((label) => (
                          <th key={label} className="sticky top-0 z-20 bg-slate-50 px-2 py-1">{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        fixedTickerWindowSummary.sum,
                        ...fixedTickerWindowSummary.tickers.map((row, index) => ({
                          rank: String(index + 1),
                          ticker: row.ticker,
                          windows: row.windows,
                        })),
                      ].map((row) => (
                        <tr key={row.ticker} className="border-t border-slate-100">
                          <td className="sticky left-0 z-10 w-16 min-w-16 border-r border-slate-200 bg-white px-2 py-1.5 font-bold text-slate-900">
                            {row.rank}
                          </td>
                          <td className="sticky left-16 z-10 min-w-36 border-r border-slate-200 bg-white px-2 py-1.5 font-semibold text-slate-900">
                            {row.ticker}
                          </td>
                          {fixedWindowColumns.map((label) => (
                            <td key={label} className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums text-slate-800">
                              {fixedMatchCell(row.windows[label])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">
                Signal Match for Fixed List missing input: fixedTickerWindowSummary
              </div>
            )}

            {ruleControlResearch?.signalMatch.latestDayDetails?.length ? (
              <div className="mt-2 rounded border border-slate-200 bg-white p-2">
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-semibold text-slate-900">
                    Latest Day Details · Flow State · {ruleControlResearch.signalMatch.latestDate}
                  </p>
                  <p className="text-slate-600">
                    {flowDirectionSummary?.wins ?? 0} wins / {flowDirectionSummary?.validSamples ?? 0} valid
                  </p>
                </div>
                <div className="mt-1 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-[10px]">
                    <thead className="text-[9px] uppercase text-slate-500">
                      <tr>
                        <th className="px-2 py-1">Ticker</th>
                        <th className="px-2 py-1">Flow State / Signal Direction</th>
                        <th className="px-2 py-1">Close Direction</th>
                        <th className="px-2 py-1">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ruleControlResearch.signalMatch.latestDayDetails.map((row) => (
                        <tr key={row.ticker} className="border-t border-slate-100">
                          <td className="px-2 py-1 font-bold text-slate-900">{row.ticker}</td>
                          <td className="px-2 py-1 text-slate-700">
                            {row.flowState ? `${row.flowState} / ${row.signalDirection}` : row.signalDirection}
                          </td>
                          <td className="px-2 py-1 text-slate-700">{row.closeDirection}</td>
                          <td className={row.result === "Win" ? "px-2 py-1 font-semibold text-emerald-700" : row.result === "Fail" ? "px-2 py-1 font-semibold text-rose-700" : "px-2 py-1 text-slate-500"}>
                            {row.result}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <p className="mt-1.5 text-slate-500">
              Signal Match Definition: Bullish wins when same-day close is up; Bearish wins when same-day close is down. Neutral or missing signal/price directions are excluded. Forward Returns Research remains separate.
            </p>
          </article>
        </div>
      ) : null}
    </section>
  );
}

function DiagnosticsSection({
  snapshot,
  ruleControlResearch,
  updatedAt,
  expanded,
}: {
  snapshot: SnapshotResponse;
  ruleControlResearch?: RuleControlResearch;
  updatedAt: string;
  expanded: boolean;
}) {
  const coverage = snapshot.providerCoverageSummary;
  const quality = coverage?.dataQualitySummary;
  const used = coverage?.providerCallsUsed;
  const remaining = coverage?.providerCallsRemaining;
  const signalCoverage = snapshot.signalSnapshotCoverageSummary;
  const entrySummary = snapshot.entryActionSummary ?? snapshot.actionSignalSummary;
  const positionSummary = snapshot.positionActionSummary;
  const universeCoverage = snapshot.universeCoverageSummary;
  const estimatedFlowSummary = snapshot.estimatedFlowProxyDisplaySummary;
  const moomooGuard = estimatedFlowSummary?.moomooQuotaGuard;
  const allDiagnosticsItems = [
    ...snapshot.items,
    ...(snapshot.fixedSnapshot?.items ?? []),
  ];
  const scopedMoomooCount =
    estimatedFlowSummary?.scopedTickerCount ??
    moomooGuard?.scopedSymbolCount ??
    uniqueTickers(allDiagnosticsItems).length;
  const moomooDirectCount =
    estimatedFlowSummary?.moomooDirectFlowAvailableCount ??
    uniqueTickers(
      allDiagnosticsItems.filter((item) => item.moomooFlowAvailable),
    ).length;
  const moomooArchiveCount =
    estimatedFlowSummary?.moomooArchiveTickerCount ?? moomooDirectCount;
  const moomooFallbackCount =
    estimatedFlowSummary?.moomooFallbackCount ??
    Math.max(scopedMoomooCount - moomooDirectCount, 0);
  const moomooDirectPct =
    scopedMoomooCount > 0
      ? `${Math.round((moomooDirectCount / scopedMoomooCount) * 100)}%`
      : "N/A";
  const moomooDirectTickers = uniqueTickers(
    allDiagnosticsItems.filter((item) => item.moomooFlowAvailable),
  );
  const moomooDateCoverage = estimatedFlowSummary?.moomooArchiveDateCoverage;
  const moomooDateCoverageEntries =
    moomooDateCoverage && Object.keys(moomooDateCoverage).length > 0
      ? Object.entries(moomooDateCoverage).sort(([a], [b]) => b.localeCompare(a))
      : [];
  const moomooLatestDate = moomooDateCoverageEntries[0]?.[0] ?? "N/A";
  const moomooOldestDate =
    moomooDateCoverageEntries.at(-1)?.[0] ?? moomooLatestDate;
  const moomooLatestCoverage = moomooDateCoverageEntries[0]?.[1] ?? null;
  const moomooRecentDateCoverageLabel =
    moomooDateCoverageEntries.length > 0
      ? moomooDateCoverageEntries
          .slice(0, 5)
          .map(([date, count]) => `${date}:${count}`)
          .join(" · ")
      : "N/A";
  const moomooMoreDatesLabel =
    moomooDateCoverageEntries.length > 5
      ? `+ ${moomooDateCoverageEntries.length - 5} more dates`
      : "All shown";
  const moomooUsedLabel = moomooGuard
    ? `Used ${moomooGuard.liveProviderCallCount} / Limit ${moomooGuard.maxSymbolsPerRun}`
    : "Used 0 / Limit 20";
  const moomooStatus =
    moomooGuard?.status ??
    (estimatedFlowSummary?.moomooCapitalDistributionAvailable
      ? "Fallback Proxy"
      : "Unavailable");
  const moomooStatusMessage =
    moomooGuard?.statusMessage ??
    "Moomoo Direct Flow unavailable; using Enhanced OHLCV Proxy fallback.";
  const researchForwardReturns = ruleControlResearch?.forwardReturns;

  if (!expanded) {
    return null;
  }

  return (
    <section className="mt-2.5 rounded border border-slate-200 bg-white p-2.5 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">
            Flow Data Diagnostics
          </h2>
          <p className="text-[11px] text-slate-600">
            Provider coverage, archive usage, data quality, quota, and timeout
            guard status.
          </p>
        </div>
        <p className="text-[11px] font-medium text-slate-500">
          Snapshot {updatedAt} UTC
        </p>
      </div>

      <div className="mt-2 grid gap-1.5 md:grid-cols-2 xl:grid-cols-6">
        <article className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px]">
          <p className="mb-1 font-semibold text-slate-800">Universe Coverage</p>
          <div className="grid grid-cols-2 gap-1.5">
            <DiagnosticMetric
              label="Deduped"
              value={universeCoverage?.dedupedUniverseCount}
            />
            <DiagnosticMetric
              label="50-300B"
              value={universeCoverage?.marketCap50To300BPoolCount}
            />
            <DiagnosticMetric
              label="Price >800"
              value={universeCoverage?.highPriceOver800PoolCount}
            />
            <DiagnosticMetric
              label="Overlap"
              value={universeCoverage?.overlappingTickerCount}
            />
            <DiagnosticMetric
              label="Missing MC"
              value={universeCoverage?.missingMarketCapCount}
            />
            <DiagnosticMetric
              label="Missing Price"
              value={universeCoverage?.missingPriceCount}
            />
            <DiagnosticMetric
              label="Timeout Skip"
              value={universeCoverage?.skippedByTimeoutCount}
            />
            <DiagnosticMetric
              label="Proxy"
              value={universeCoverage?.yfinanceProxyFallbackCount}
            />
            <DiagnosticMetric
              label="Quota Exhaust"
              value={universeCoverage?.providerQuotaExhaustedCount}
            />
            <DiagnosticMetric
              label="Deep Scored"
              value={universeCoverage?.deepScoringCandidateCount}
            />
          </div>
        </article>

        <article className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px]">
          <p className="mb-1 font-semibold text-slate-800">Refresh Health</p>
          <div className="grid grid-cols-2 gap-1.5">
            <DiagnosticMetric label="Status" value={getDataStatusLabel(snapshot.status)} />
            <DiagnosticMetric label="Saved" value={getPersistenceLabel(snapshot)} />
            <DiagnosticMetric
              label="Timeout Guard"
              value={snapshot.timeoutGuardTriggered ? "Triggered" : "Clear"}
            />
            <DiagnosticMetric label="Elapsed" value={formatMaybeNumber(snapshot.elapsedMs, "ms")} />
            <DiagnosticMetric
              label="Final Coverage"
              value={snapshot.finalCoverageTickerCount ?? coverage?.dedupedCoverageCount}
            />
            <DiagnosticMetric
              label="Deduped"
              value={snapshot.dedupedCoverageTickerCount ?? coverage?.dedupedCoverageCount}
            />
            <DiagnosticMetric
              label="Signal Snapshots"
              value={snapshot.signalSnapshotPersistenceStatus}
            />
            <DiagnosticMetric
              label="Rows Saved"
              value={snapshot.signalSnapshotRowsSaved}
            />
            <DiagnosticMetric
              label="Signal Date"
              value={snapshot.signalSnapshotLatestDate}
            />
            <DiagnosticMetric
              label="Fixed Rows"
              value={signalCoverage?.fixedWatchlistRowsSaved}
            />
            <DiagnosticMetric
              label="Market Rows"
              value={signalCoverage?.marketScanRowsSaved}
            />
            <DiagnosticMetric
              label="Unique Tickers"
              value={signalCoverage?.uniqueTickersSaved}
            />
            <DiagnosticMetric
              label="Overlap"
              value={signalCoverage?.overlappingTickers.length}
            />
            <DiagnosticMetric
              label="Entry Buy"
              value={entrySummary?.buyCandidateCount}
            />
            <DiagnosticMetric
              label="Entry Watch"
              value={entrySummary?.watchCount}
            />
            <DiagnosticMetric label="Entry Avoid" value={entrySummary?.avoidCount} />
            <DiagnosticMetric
              label="Entry Insuff."
              value={entrySummary?.insufficientDataCount}
            />
            <DiagnosticMetric label="Hold" value={positionSummary?.holdCount} />
            <DiagnosticMetric label="Reduce" value={positionSummary?.reduceCount} />
            <DiagnosticMetric
              label="Sell Cand."
              value={positionSummary?.sellCandidateCount}
            />
            <DiagnosticMetric label="Exit" value={positionSummary?.exitCount} />
            <DiagnosticMetric
              label="Pos. Insuff."
              value={positionSummary?.insufficientDataCount}
            />
          </div>
        </article>

        <article className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px]">
          <p className="mb-1 font-semibold text-slate-800">Provider Coverage</p>
          <div className="grid grid-cols-2 gap-1.5">
            <DiagnosticMetric label="Moomoo Direct %" value={moomooDirectPct} />
            <DiagnosticMetric
              label="Moomoo Direct Count"
              value={`${moomooDirectCount} / ${scopedMoomooCount}`}
            />
            <DiagnosticMetric label="Moomoo Archive" value={moomooArchiveCount} />
            <DiagnosticMetric label="Moomoo Fallback" value={moomooFallbackCount} />
            <DiagnosticMetric
              label="Legacy Real %"
              value={
                coverage ? `${coverage.realProviderCoveragePct}%` : "N/A"
              }
            />
            <DiagnosticMetric label="Legacy Real Count" value={coverage?.realProviderCoverageCount} />
            <DiagnosticMetric
              label="Tickers"
              value={
                coverage
                  ? `${coverage.totalTickers}/${coverage.dedupedCoverageCount}`
                  : "N/A"
              }
            />
            <DiagnosticMetric label="OHLCV/Proxy Archive" value={coverage?.archiveHitCount} />
            <DiagnosticMetric label="AV Live" value={coverage?.alphaVantageLiveCount} />
            <DiagnosticMetric label="Twelve" value={coverage?.twelveDataLiveCount} />
            <DiagnosticMetric label="EODHD" value={coverage?.eodhdLiveCount} />
            <DiagnosticMetric label="YF Proxy" value={coverage?.yfinanceFallbackCount} />
            <DiagnosticMetric label="Composite" value={coverage?.compositeProxyFallbackCount} />
          </div>
        </article>

        <article className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px]">
          <p className="mb-1 font-semibold text-slate-800">Data Quality</p>
          <div className="grid grid-cols-2 gap-1.5">
            <DiagnosticMetric
              label="Avg"
              value={quality?.averageFlowDataQualityScore}
            />
            <DiagnosticMetric
              label="Grades"
              value={
                quality
                  ? `A${quality.gradeACount} B${quality.gradeBCount} C${quality.gradeCCount} D${quality.gradeDCount}`
                  : "N/A"
              }
            />
          </div>
          <div className="mt-1.5 space-y-1">
            <TickerList label="Low Quality" tickers={quality?.lowQualityTickers} />
            <TickerList label="Proxy Data" tickers={quality?.proxyDataTickers} />
            <TickerList label="Stale Data" tickers={quality?.staleDataTickers} />
          </div>
        </article>

        <article className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px]">
          <p className="mb-1 font-semibold text-slate-800">Provider Quota</p>
          <div className="grid grid-cols-2 gap-1.5">
            <DiagnosticMetric label="Moomoo" value={moomooUsedLabel} />
            <DiagnosticMetric label="Moomoo Status" value={moomooStatus} />
            <DiagnosticMetric
              label="Moomoo Source"
              value={estimatedFlowSummary?.moomooProvider ?? "MOOMOO_CAPITAL_DISTRIBUTION"}
            />
            <DiagnosticMetric label="Moomoo Latest" value={moomooLatestDate} />
            <DiagnosticMetric
              label="Moomoo Range"
              value={
                moomooDateCoverageEntries.length > 0
                  ? `${moomooOldestDate} -> ${moomooLatestDate}`
                  : "N/A"
              }
            />
            <DiagnosticMetric
              label="Covered Dates"
              value={
                moomooDateCoverageEntries.length > 0
                  ? `${moomooDateCoverageEntries.length}+`
                  : "N/A"
              }
            />
            <DiagnosticMetric
              label="Latest Coverage"
              value={
                moomooLatestCoverage != null
                  ? `${moomooLatestCoverage} / ${moomooGuard?.maxSymbolsPerRun ?? 20}`
                  : "N/A"
              }
            />
            <DiagnosticMetric
              label="Fixed Historical Rows"
              value={estimatedFlowSummary?.historicalRowsSaved ?? "N/A"}
            />
            <div className="col-span-2 min-w-0 rounded border border-slate-200 bg-white px-2 py-1">
              <span className="text-slate-500">Recent Moomoo Dates</span>
              <p className="mt-0.5 truncate font-semibold text-slate-950">
                {moomooRecentDateCoverageLabel}
              </p>
              <p className="mt-0.5 text-slate-500">{moomooMoreDatesLabel}</p>
            </div>
            <DiagnosticMetric
              label="Polygon"
              value={quotaLabel(used?.polygon, remaining?.polygon)}
            />
            <DiagnosticMetric
              label="Alpha Vantage"
              value={quotaLabel(used?.alphaVantage, remaining?.alphaVantage)}
            />
            <DiagnosticMetric
              label="Twelve Data"
              value={quotaLabel(used?.twelveData, remaining?.twelveData)}
            />
            <DiagnosticMetric
              label="EODHD"
              value={quotaLabel(used?.eodhd, remaining?.eodhd)}
            />
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
            {moomooStatusMessage}
          </p>
        </article>

        <article className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px]">
          <p className="mb-1 font-semibold text-slate-800">Forward Returns</p>
          <div className="grid grid-cols-2 gap-1.5">
            <DiagnosticMetric
              label="Status"
              value={
                researchForwardReturns?.status ??
                snapshot.forwardReturnUpdateStatus ??
                "Missing input: research payload"
              }
            />
            <DiagnosticMetric
              label="Updated Rows"
              value={
                researchForwardReturns?.updatedRows ??
                snapshot.forwardReturnUpdatedRows
              }
            />
            <DiagnosticMetric
              label="Checked Rows"
              value={
                researchForwardReturns?.checkedRows ??
                snapshot.forwardReturnCheckedRows
              }
            />
            <DiagnosticMetric
              label="Insufficient"
              value={
                researchForwardReturns?.insufficient ??
                snapshot.forwardReturnInsufficientFutureDataRows
              }
            />
            <DiagnosticMetric
              label="Last Updated"
              value={snapshot.forwardReturnLastUpdatedAt ?? "Research file generated"}
            />
            <DiagnosticMetric
              label="Price Rows"
              value={
                researchForwardReturns?.priceRows ??
                "Missing input: fixed close price archive"
              }
            />
            <DiagnosticMetric
              label="Metrics"
              value={
                researchForwardReturns?.metricsCount ??
                "Missing input: win-rate research"
              }
            />
          </div>
        </article>

        <article className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px]">
          <p className="mb-1 font-semibold text-slate-800">Source Lists</p>
          <div className="grid gap-1">
            <TickerList label="Moomoo Direct Archive" tickers={moomooDirectTickers} />
            <TickerList label="Enhanced OHLCV Proxy Archive" tickers={coverage?.archiveHitTickers} />
            <TickerList label="AV Live" tickers={coverage?.alphaVantageLiveTickers} />
            <TickerList label="Polygon Live" tickers={coverage?.polygonLiveTickers} />
            <TickerList label="Twelve Live" tickers={coverage?.twelveDataLiveTickers} />
            <TickerList label="EODHD Live" tickers={coverage?.eodhdLiveTickers} />
            <TickerList label="YF Proxy" tickers={coverage?.compositeProxyFallbackTickers} />
            <TickerList label="Errors" tickers={coverage?.providerErrorTickers} />
          </div>
          <div className="mt-2 rounded border border-slate-200 bg-white p-1.5 text-[10px] leading-snug text-slate-600">
            <p className="font-semibold text-slate-800">Flow Data Ladder</p>
            <p>
              1. Moomoo Direct Flow Archive · 2. Enhanced OHLCV Proxy Archive ·
              3. Alpha Vantage / Polygon / Twelve / EODHD OHLCV · 4. yfinance
              fallback · 5. unavailable.
            </p>
            <p className="mt-1">
              Moomoo Direct Flow is provider direct capital flow data. Other
              providers are OHLCV-based proxy sources unless explicitly upgraded.
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}

function ActionHistorySection({
  report,
  expanded,
  onToggle,
}: {
  report?: ActionHistoryReport;
  expanded: boolean;
  onToggle: () => void;
}) {
  const summary = report?.actionHistorySummary;

  return (
    <section className="mt-1.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
          <h2 className="font-semibold text-slate-950">Action History</h2>
          <span className="text-slate-500">
            New Buy {summary?.newBuyCandidateCount ?? 0} · Entry Up{" "}
            {summary?.entryUpgradeCount ?? 0} · Entry Down{" "}
            {summary?.entryDowngradeCount ?? 0} · Position Down{" "}
            {summary?.positionDowngradeCount ?? 0}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="min-h-8 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          {expanded ? "History ▴" : "History ▾"}
        </button>
      </div>

      {expanded ? (
        report?.rows.length ? (
          <div className="mt-1.5 overflow-x-auto rounded border border-slate-200">
            <table className="w-full min-w-[980px] text-left">
              <thead className="bg-slate-50 text-[9px] uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1">Ticker</th>
                  <th className="px-2 py-1">Entry</th>
                  <th className="px-2 py-1">Entry Change</th>
                  <th className="px-2 py-1">Position</th>
                  <th className="px-2 py-1">Position Change</th>
                  <th className="px-2 py-1">Rank</th>
                  <th className="px-2 py-1">Composite</th>
                  <th className="px-2 py-1">Signal</th>
                  <th className="px-2 py-1">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.slice(0, 20).map((row) => (
                  <tr
                    key={`${row.ticker}-${row.mode}-${row.sourceBucket}-${row.signalDate}`}
                    className="border-t border-slate-200"
                  >
                    <td className="px-2 py-1.5 font-bold text-slate-950">
                      {row.ticker}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.previousEntryActionSignal} → {row.entryActionSignal}
                    </td>
                    <td className="px-2 py-1.5">{row.entryActionChange}</td>
                    <td className="px-2 py-1.5">
                      {row.previousPositionActionSignal} →{" "}
                      {row.positionActionSignal}
                    </td>
                    <td className="px-2 py-1.5">{row.positionActionChange}</td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {row.previousRank ?? "N/A"} → {row.rank ?? "N/A"}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {row.previousCompositeScore ?? "N/A"} →{" "}
                      {row.compositeScore ?? "N/A"}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.previousSignal} → {row.signal}
                    </td>
                    <td className="px-2 py-1.5">{row.signalDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-1.5 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600">
            Action history is not available yet.
          </p>
        )
      ) : null}
    </section>
  );
}

export function Dashboard({
  allSnapshot,
  fixedSnapshot,
  winRateReport,
  actionHistoryReport,
  ruleControlResearch,
}: {
  allSnapshot: SnapshotResponse;
  fixedSnapshot: SnapshotResponse | null;
  winRateReport?: WinRateReport;
  actionHistoryReport?: ActionHistoryReport;
  ruleControlResearch?: RuleControlResearch;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("ALL");
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);
  const [winRateExpanded, setWinRateExpanded] = useState(false);
  const [actionHistoryExpanded, setActionHistoryExpanded] = useState(false);
  const activeTabLabel =
    tabs.find((tab) => tab.id === activeTab)?.label ?? "All";
  const updatedAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(allSnapshot.updatedAt));
  const displayedItems = useMemo(() => {
    if (activeTab === "FIXED_LIST") {
      const fixedItemsByTicker = new Map(
        (fixedSnapshot?.items ?? []).map((candidate) => [
          candidate.ticker.toUpperCase(),
          candidate,
        ]),
      );

      return FIXED_WATCHLIST_SYMBOLS.map((ticker) =>
        fixedItemsByTicker.get(ticker),
      ).filter((candidate): candidate is StockCandidate => candidate != null);
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
  const qualitySummary = providerCoverage?.dataQualitySummary;
  const entrySummary = allSnapshot.entryActionSummary ?? allSnapshot.actionSignalSummary;
  const positionSummary = allSnapshot.positionActionSummary;
  const universeCoverage = allSnapshot.universeCoverageSummary;
  const diagnosticsSummary = universeCoverage
    ? `Universe: deduped ${universeCoverage.dedupedUniverseCount} · MarketCap 50-300B: ${universeCoverage.marketCap50To300BPoolCount} · Price >800: ${universeCoverage.highPriceOver800PoolCount} · Overlap: ${universeCoverage.overlappingTickerCount} · Missing MC: ${universeCoverage.missingMarketCapCount} · Missing Price: ${universeCoverage.missingPriceCount} · Timeout skipped: ${universeCoverage.skippedByTimeoutCount} · Proxy fallback: ${universeCoverage.yfinanceProxyFallbackCount} · Quota exhausted: ${universeCoverage.providerQuotaExhaustedCount}`
    : providerCoverage
      ? `Real ${providerCoverage.realProviderCoveragePct}% · Quality A:${
          qualitySummary?.gradeACount ?? 0
        } B:${qualitySummary?.gradeBCount ?? 0} C:${
          qualitySummary?.gradeCCount ?? 0
        } D:${qualitySummary?.gradeDCount ?? 0} · Archive ${
          providerCoverage.archiveHitCount
        } · Proxy ${
          providerCoverage.compositeProxyFallbackCount
        }`
      : "Diagnostics pending";
  const summaryCards = [
    {
      label: "Universe",
      value: universeCoverage
        ? `Deduped ${universeCoverage.dedupedUniverseCount}`
        : "Market Scan",
      detail: universeCoverage
        ? `50-300B: ${universeCoverage.marketCap50To300BPoolCount} · >$800: ${universeCoverage.highPriceOver800PoolCount}`
        : "Market cap $50B-$300B or price > $800",
    },
    {
      label: "Top 11",
      value: `${allSnapshot.count} Candidates`,
      detail: `${allSnapshot.candidateCount ?? allSnapshot.count} passed quote filter from ${allSnapshot.scannedCount ?? "seed"} symbols`,
    },
    {
      label: "Data Status",
      value: getDataStatusLabel(allSnapshot.status),
      detail: `Snapshot: ${getPersistenceLabel(allSnapshot)}`,
    },
    {
      label: "Entry Actions",
      value: entrySummary
        ? `${entrySummary.buyCandidateCount} Buy · ${entrySummary.watchCount} Watch`
        : "N/A",
      detail: entrySummary
        ? `Avoid ${entrySummary.avoidCount} · Insufficient ${entrySummary.insufficientDataCount}`
        : "Awaiting entry action summary",
    },
    {
      label: "Position Actions",
      value: positionSummary
        ? `${positionSummary.holdCount} Hold · ${positionSummary.reduceCount} Reduce`
        : "N/A",
      detail: positionSummary
        ? `Sell ${positionSummary.sellCandidateCount} · Exit ${positionSummary.exitCount}`
        : "Awaiting position action summary",
    },
  ];

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <section className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-1.5 px-2.5 py-2 sm:px-3 lg:px-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Daily Close Snapshot
              </p>
              <h1 className="mt-0.5 whitespace-nowrap text-[21px] font-semibold tracking-normal text-slate-950 sm:text-2xl lg:text-[26px]">
                {APP_TITLE}
              </h1>
              <p className="mt-0.5 text-xs text-slate-600">
                Capital-flow-driven US stock candidate selection dashboard
              </p>
            </div>
            <div className="grid gap-x-3 gap-y-0.5 rounded border border-slate-200 bg-white px-2.5 py-2 text-[11px] shadow-sm sm:grid-cols-3 lg:min-w-[520px]">
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
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
              <span>
                <span className="font-semibold text-slate-950">Scoring:</span>{" "}
                <span className="font-normal text-slate-600">
                  Margin 30% · FCF 40% · Est.Flow 30%
                </span>
              </span>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
              <span className="truncate text-slate-500">
                {diagnosticsSummary}
              </span>
              <button
                type="button"
                onClick={() =>
                  setDiagnosticsExpanded((current) => !current)
                }
                className="min-h-8 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                {diagnosticsExpanded ? "Diagnostics ▴" : "Diagnostics ▾"}
              </button>
            </div>
          </div>
          <DiagnosticsSection
            snapshot={allSnapshot}
            ruleControlResearch={ruleControlResearch}
            updatedAt={updatedAt}
            expanded={diagnosticsExpanded}
          />
          <WinRateSection
            report={winRateReport}
            ruleControlResearch={ruleControlResearch}
            expanded={winRateExpanded}
            onToggle={() => setWinRateExpanded((current) => !current)}
          />
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1600px] px-2.5 py-1.5 sm:px-3 lg:px-4">
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

        <ActionHistorySection
          report={actionHistoryReport}
          expanded={actionHistoryExpanded}
          onToggle={() => setActionHistoryExpanded((current) => !current)}
        />

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
            <table className="w-full min-w-[1680px] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  {tableHeaders.map((header) => {
                    const stickyClass =
                      header === "Rank"
                        ? `${stickyHeaderClass} left-0 w-12 min-w-12 border-r shadow-[2px_0_3px_rgba(15,23,42,0.05)]`
                        : header === "Chg"
                          ? `${stickyHeaderClass} left-12 w-10 min-w-10 border-r shadow-[2px_0_3px_rgba(15,23,42,0.05)]`
                        : header === "Ticker"
                          ? `${stickyHeaderClass} left-[5.5rem] w-20 min-w-20 border-r shadow-[2px_0_3px_rgba(15,23,42,0.05)]`
                          : normalHeaderClass;

                    return (
                      <th
                        key={header}
                        className={stickyClass}
                        title={
                          estimatedFlowWindowHeaders.has(header)
                            ? estimatedFlowTooltip
                            : undefined
                        }
                      >
                        {header}
                      </th>
                    );
                  })}
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
