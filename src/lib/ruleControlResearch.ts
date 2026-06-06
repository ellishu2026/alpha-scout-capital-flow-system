import { readFile } from "node:fs/promises";
import path from "node:path";

type ResearchSignal = {
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

type CandidateSummary = {
  version: string;
  candidateCount: number;
  watchCount: number;
  riskSignalCount: number;
  rejectedCount: number;
  productionRuleChanged: boolean;
  readyStatusSummary: Record<string, number>;
  topCandidates: ResearchSignal[];
  topWatchSignals: ResearchSignal[];
  recommendedNextStep: string;
};

type WinRateSummary = {
  priceRows: number;
  forwardReturnRows: number;
  metricsCount: number;
  readyStatusSummary: Record<string, number>;
  forwardReturnRowsByHorizon: Record<string, number>;
  priceSourceCounts: Record<string, number>;
};

export type RuleControlResearch = {
  researchOnly: true;
  productionRuleChanged: false;
  version: "V2.0.1";
  researchVersion: string;
  candidateCount: number;
  watchCount: number;
  rejectedCount: number;
  riskSignalCount: number;
  forwardReturnRows: number;
  priceRows: number;
  metricsCount: number;
  readyStatusSummary: Record<string, number>;
  topCandidates: ResearchSignal[];
  leaderboardRows: ResearchSignal[];
  forwardReturns: {
    status: "Research Ready" | "Missing Research Data";
    checkedRows: number;
    updatedRows: number;
    insufficient: number;
    priceRows: number;
    metricsCount: number;
    readyStatusSummary: Record<string, number>;
  };
  productionRule: {
    current: "V1.7.6 Production";
    status: "Active · Locked";
    autoActivation: "Disabled";
    riskGateRequired: true;
  };
  promotionGate: {
    status: "Production Locked";
    riskGateRequired: true;
    autoActivation: false;
    promotable: 0;
    reason: string;
  };
  recommendation: string;
  recommendedNextStep: string;
  missingDependencies: string[];
};

async function readJson<T>(fileName: string): Promise<T> {
  const filePath = path.join(process.cwd(), "data", "research", fileName);
  return JSON.parse(await readFile(filePath, "utf-8")) as T;
}

export async function buildRuleControlResearch(): Promise<RuleControlResearch> {
  const missingDependencies: string[] = [];
  const [candidatePayload, winRatePayload] = await Promise.allSettled([
    readJson<{ summary: CandidateSummary }>(
      "moomoo_flow_signal_candidates_v200.json",
    ),
    readJson<{ summary: WinRateSummary }>(
      "moomoo_flow_win_rate_v199.json",
    ),
  ]);

  if (candidatePayload.status === "rejected") {
    missingDependencies.push("data/research/moomoo_flow_signal_candidates_v200.json");
  }
  if (winRatePayload.status === "rejected") {
    missingDependencies.push("data/research/moomoo_flow_win_rate_v199.json");
  }

  const candidateSummary =
    candidatePayload.status === "fulfilled"
      ? candidatePayload.value.summary
      : null;
  const winRateSummary =
    winRatePayload.status === "fulfilled" ? winRatePayload.value.summary : null;
  const topCandidates = candidateSummary?.topCandidates ?? [];
  const topWatch = candidateSummary?.topWatchSignals ?? [];
  const leaderboardRows = [...topCandidates.slice(0, 12), ...topWatch.slice(0, 8)];
  const readyStatusSummary =
    candidateSummary?.readyStatusSummary ??
    winRateSummary?.readyStatusSummary ??
    {};
  const insufficient =
    readyStatusSummary["Not Ready"] ??
    readyStatusSummary["Not ready"] ??
    0;

  return {
    researchOnly: true,
    productionRuleChanged: false,
    version: "V2.0.1",
    researchVersion: candidateSummary?.version ?? "V2.0.0",
    candidateCount: candidateSummary?.candidateCount ?? 0,
    watchCount: candidateSummary?.watchCount ?? 0,
    rejectedCount: candidateSummary?.rejectedCount ?? 0,
    riskSignalCount: candidateSummary?.riskSignalCount ?? 0,
    forwardReturnRows: winRateSummary?.forwardReturnRows ?? 0,
    priceRows: winRateSummary?.priceRows ?? 0,
    metricsCount: winRateSummary?.metricsCount ?? 0,
    readyStatusSummary,
    topCandidates,
    leaderboardRows,
    forwardReturns: {
      status:
        (winRateSummary?.forwardReturnRows ?? 0) > 0
          ? "Research Ready"
          : "Missing Research Data",
      checkedRows: winRateSummary?.forwardReturnRows ?? 0,
      updatedRows: winRateSummary?.forwardReturnRows ?? 0,
      insufficient,
      priceRows: winRateSummary?.priceRows ?? 0,
      metricsCount: winRateSummary?.metricsCount ?? 0,
      readyStatusSummary,
    },
    productionRule: {
      current: "V1.7.6 Production",
      status: "Active · Locked",
      autoActivation: "Disabled",
      riskGateRequired: true,
    },
    promotionGate: {
      status: "Production Locked",
      riskGateRequired: true,
      autoActivation: false,
      promotable: 0,
      reason:
        "Forward return samples available. Need threshold simulation and Risk Gate review.",
    },
    recommendation:
      "No Production Change · Research Candidates Available · Confidence: Medium",
    recommendedNextStep:
      candidateSummary?.recommendedNextStep ??
      "V2.0.2 Flow Threshold Simulation",
    missingDependencies,
  };
}
