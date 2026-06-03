import "server-only";

import {
  MIN_RECOMMENDED_THRESHOLD_SAMPLES,
  ROLLING_RECOMMENDATION_ENDPOINT,
  RULE_AB_ENDPOINT,
  RULE_PROMOTION_ENDPOINT,
  WIN_RATE_TREND_ENDPOINT,
  buildThresholdSimulationReport,
  candidateRuleSets,
  productionRuleSet,
} from "@/lib/thresholdSimulation";
import type {
  RollingCandidateRecommendation,
  RollingRecommendationReport,
  RollingRecommendationWindow,
  ThresholdSimulationReport,
  ThresholdSimulationResult,
  ThresholdSimulationRuleSet,
} from "@/types/stock";

const notReadyReason =
  "Forward return samples are insufficient for rolling recommendation.";
const notReadyRecommendation =
  "Collect more forward return samples before rule optimization.";

const rollingWindows = [
  { windowName: "last20Signals", signalLimit: 20 },
  { windowName: "last50Signals", signalLimit: 50 },
  { windowName: "last100Signals", signalLimit: 100 },
  { windowName: "last250Signals", signalLimit: 250 },
] as const;

const safetyWarnings = [
  "Rolling recommendation is advisory only; production thresholds are not changed.",
  "Automatic production activation is disabled.",
  "Candidate review requires threshold simulation, A/B comparison, rule promotion, and explicit Risk Gate approval.",
  "No real trading or order execution is implemented.",
];

function promotionGate() {
  return {
    autoActivationAllowed: false,
    explicitApprovalRequired: true,
    requiresRulePromotionWorkflow: true,
    requiresABComparison: true,
    requiresThresholdSimulation: true,
    requiresMinimumSamples: true,
    requiresRiskReview: true,
    canAutoActivate: false,
  } as const;
}

function relatedEndpoints() {
  return {
    thresholdSimulationEndpoint: "/api/debug/threshold-simulation?limit=500",
    ruleABEndpoint: `${RULE_AB_ENDPOINT}?limit=500`,
    rulePromotionEndpoint: RULE_PROMOTION_ENDPOINT,
  };
}

function bestCandidateFor(report: ThresholdSimulationReport) {
  if (!report.isReadyForThresholdSimulation) return null;

  return (
    report.simulationResults
      .filter(
        (result) =>
          result.ruleSetId !== productionRuleSet.id &&
          result.comparisonToProduction.isBetterThanProduction,
      )
      .sort(
        (a, b) =>
          (b.avgReturnPct ?? -Infinity) - (a.avgReturnPct ?? -Infinity) ||
          (b.winRatePct ?? -Infinity) - (a.winRatePct ?? -Infinity) ||
          b.sampleCount - a.sampleCount,
      )[0] ?? null
  );
}

function ruleSetFromResult(
  result: ThresholdSimulationResult | null,
): ThresholdSimulationRuleSet | null {
  if (!result) return null;

  return candidateRuleSets.find((ruleSet) => ruleSet.id === result.ruleSetId) ?? null;
}

function buildWindowSummary({
  report,
  windowName,
  signalLimit,
}: {
  report: ThresholdSimulationReport;
  windowName: RollingRecommendationWindow["windowName"];
  signalLimit: number;
}): RollingRecommendationWindow {
  const isReady =
    report.availableForwardReturnRows >= MIN_RECOMMENDED_THRESHOLD_SAMPLES &&
    report.readyWindows.length > 0;
  const bestCandidate = isReady ? bestCandidateFor(report) : null;
  const bestCandidateRuleSet = ruleSetFromResult(bestCandidate);

  return {
    windowName,
    signalLimit,
    signalCount: report.totalRowsScanned,
    availableForwardReturnRows: report.availableForwardReturnRows,
    minRecommendedSamples: MIN_RECOMMENDED_THRESHOLD_SAMPLES,
    isReady,
    readyWindows: report.readyWindows,
    bestCandidateRuleSet,
    productionBaseline: productionRuleSet,
    recommendation: isReady
      ? bestCandidateRuleSet
        ? "Review candidate rule through A/B comparison and promotion workflow."
        : "Keep current rules; no candidate clears rolling recommendation gates."
      : notReadyRecommendation,
    recommendedAction: isReady && bestCandidateRuleSet ? "REVIEW_CANDIDATE_RULE" : "NO_CHANGE",
    notReadyReason: isReady ? null : notReadyReason,
  };
}

function bestCandidateWindowResult({
  report,
  ruleSet,
}: {
  report: ThresholdSimulationReport;
  ruleSet: ThresholdSimulationRuleSet;
}) {
  return (
    report.simulationResults
      .filter((result) => result.ruleSetId === ruleSet.id)
      .sort(
        (a, b) =>
          (b.comparisonToProduction.avgReturnDeltaPct ?? -Infinity) -
            (a.comparisonToProduction.avgReturnDeltaPct ?? -Infinity) ||
          (b.comparisonToProduction.winRateDeltaPct ?? -Infinity) -
            (a.comparisonToProduction.winRateDeltaPct ?? -Infinity),
      )[0] ?? null
  );
}

function buildCandidateRecommendation({
  report,
  rollingWindow,
  ruleSet,
}: {
  report: ThresholdSimulationReport;
  rollingWindow: RollingRecommendationWindow["windowName"];
  ruleSet: ThresholdSimulationRuleSet;
}): RollingCandidateRecommendation {
  const isReady =
    report.availableForwardReturnRows >= MIN_RECOMMENDED_THRESHOLD_SAMPLES &&
    report.readyWindows.length > 0;
  const result = isReady
    ? bestCandidateWindowResult({ report, ruleSet })
    : null;
  const isCandidateBetter =
    result?.comparisonToProduction.isBetterThanProduction ?? false;

  return {
    ruleSetId: ruleSet.id,
    ruleSetName: ruleSet.name,
    rollingWindow,
    sampleCount: result?.sampleCount ?? 0,
    availableForwardReturnRows: report.availableForwardReturnRows,
    readiness: isReady ? "Ready" : "Not Ready",
    estimatedWinRateImprovement:
      result?.comparisonToProduction.winRateDeltaPct ?? null,
    estimatedAvgReturnImprovement:
      result?.comparisonToProduction.avgReturnDeltaPct ?? null,
    downsideRiskChange:
      result?.comparisonToProduction.worstReturnDeltaPct ?? null,
    confidenceLevel: isCandidateBetter ? "Medium" : "Low",
    recommendedAction: isCandidateBetter ? "REVIEW_CANDIDATE_RULE" : "NO_CHANGE",
    reason: isReady
      ? isCandidateBetter
        ? "Candidate clears rolling recommendation review gates; production remains unchanged."
        : "Candidate does not clear rolling recommendation review gates."
      : "Insufficient forward return samples.",
    autoActivationAllowed: false,
  };
}

export async function buildRollingRecommendationReport({
  limit,
}: {
  limit?: number;
} = {}): Promise<RollingRecommendationReport> {
  const generatedAt = new Date().toISOString();
  const requestedLimit = limit ?? 500;
  const [overallReport, ...windowReports] = await Promise.all([
    buildThresholdSimulationReport({ limit: requestedLimit }),
    ...rollingWindows.map((window) =>
      buildThresholdSimulationReport({ limit: window.signalLimit }),
    ),
  ]);
  const windows = rollingWindows.map((window, index) =>
    buildWindowSummary({
      report: windowReports[index],
      windowName: window.windowName,
      signalLimit: window.signalLimit,
    }),
  );
  const candidateRecommendations = rollingWindows.flatMap((window, index) =>
    candidateRuleSets.map((ruleSet) =>
      buildCandidateRecommendation({
        report: windowReports[index],
        rollingWindow: window.windowName,
        ruleSet,
      }),
    ),
  );
  const readyWindow = windows.find((window) => window.isReady);
  const selectedCandidateRuleSet = readyWindow?.bestCandidateRuleSet ?? null;

  return {
    ok: overallReport.ok,
    generatedAt,
    totalRowsScanned: overallReport.totalRowsScanned,
    availableForwardReturnRows: overallReport.availableForwardReturnRows,
    minRecommendedSamples: MIN_RECOMMENDED_THRESHOLD_SAMPLES,
    currentProductionRuleSet: productionRuleSet,
    rollingRecommendation: {
      status: selectedCandidateRuleSet ? "Ready" : "Not Ready",
      recommendedAction: selectedCandidateRuleSet
        ? "REVIEW_CANDIDATE_RULE"
        : "NO_CHANGE",
      selectedCandidateRuleSet,
      confidenceLevel: selectedCandidateRuleSet ? "Medium" : "Low",
      reason: selectedCandidateRuleSet
        ? "A candidate is ready for review, but production remains unchanged until Risk Gate approval."
        : notReadyReason,
      autoActivationAllowed: false,
      explicitApprovalRequired: true,
    },
    windows,
    candidateRecommendations,
    promotionGate: promotionGate(),
    relatedEndpoints: relatedEndpoints(),
    winRateTrendAvailable: true,
    winRateTrendEndpoint: WIN_RATE_TREND_ENDPOINT,
    safetyWarnings,
    error: overallReport.error,
  };
}

export { ROLLING_RECOMMENDATION_ENDPOINT };
