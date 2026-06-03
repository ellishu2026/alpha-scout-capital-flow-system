import "server-only";

import {
  DEFAULT_AB_CANDIDATE_RULE_SET,
  MIN_RECOMMENDED_THRESHOLD_SAMPLES,
  ROLLING_RECOMMENDATION_ENDPOINT,
  TRADE_WIN_RATE_LEADERBOARD_ENDPOINT,
  WIN_RATE_TREND_ENDPOINT,
  buildThresholdSimulationReport,
  candidateRuleSets,
  productionRuleSet,
} from "@/lib/thresholdSimulation";
import type {
  ForwardWindowKey,
  RuleABComparison,
  RuleABReport,
  ThresholdSimulationResult,
  ThresholdSimulationRuleSet,
} from "@/types/stock";

const FORWARD_WINDOWS: ForwardWindowKey[] = [
  "forward1D",
  "forward3D",
  "forward5D",
  "forward10D",
  "forward20D",
];

const recommendationNotReady =
  "A/B comparison framework is ready, but forward return samples are insufficient.";

const safetyWarnings = [
  "A/B comparison is reporting only; production thresholds are not changed.",
  "Candidate rules are not auto-promoted or activated.",
  "Production threshold changes require explicit Risk Gate approval.",
  "No real trading or order execution is implemented.",
];

function roundPct(value: number) {
  return Math.round(value * 100) / 100;
}

function delta(candidate: number | null, production: number | null) {
  return candidate == null || production == null
    ? null
    : roundPct(candidate - production);
}

function selectedCandidate(candidateId?: string | null) {
  return (
    candidateRuleSets.find((ruleSet) => ruleSet.id === candidateId) ??
    candidateRuleSets.find(
      (ruleSet) => ruleSet.id === DEFAULT_AB_CANDIDATE_RULE_SET,
    ) ??
    candidateRuleSets[0]
  );
}

function productionRuleSetForAB(): ThresholdSimulationRuleSet {
  return {
    ...productionRuleSet,
    name: "Current Production Rules",
    status: "ACTIVE_PRODUCTION",
    isProduction: true,
    autoActivationAllowed: false,
  };
}

function emptyComparison({
  selected,
  window,
}: {
  selected: ThresholdSimulationRuleSet;
  window: ForwardWindowKey;
}): RuleABComparison {
  return {
    candidateRuleSetId: selected.id,
    candidateRuleSetName: selected.name,
    window,
    productionSampleCount: 0,
    candidateSampleCount: 0,
    productionWinCount: 0,
    candidateWinCount: 0,
    productionLossCount: 0,
    candidateLossCount: 0,
    productionWinRatePct: null,
    candidateWinRatePct: null,
    winRateDeltaPct: null,
    productionAvgReturnPct: null,
    candidateAvgReturnPct: null,
    avgReturnDeltaPct: null,
    productionMedianReturnPct: null,
    candidateMedianReturnPct: null,
    medianReturnDeltaPct: null,
    productionWorstReturnPct: null,
    candidateWorstReturnPct: null,
    worstReturnDeltaPct: null,
    productionBestReturnPct: null,
    candidateBestReturnPct: null,
    productionCoverage: 0,
    candidateCoverage: 0,
    coverageDeltaPct: null,
    isCandidateBetter: false,
    reason: "Insufficient forward return samples.",
  };
}

function buildComparison({
  selected,
  window,
  production,
  candidate,
  isReady,
}: {
  selected: ThresholdSimulationRuleSet;
  window: ForwardWindowKey;
  production?: ThresholdSimulationResult;
  candidate?: ThresholdSimulationResult;
  isReady: boolean;
}): RuleABComparison {
  if (!production || !candidate) {
    return emptyComparison({ selected, window });
  }

  const winRateDeltaPct = delta(candidate.winRatePct, production.winRatePct);
  const avgReturnDeltaPct = delta(
    candidate.avgReturnPct,
    production.avgReturnPct,
  );
  const worstReturnDeltaPct = delta(
    candidate.worstReturnPct,
    production.worstReturnPct,
  );
  const sampleCountNotTooSmall =
    candidate.sampleCount >=
    Math.max(MIN_RECOMMENDED_THRESHOLD_SAMPLES, production.sampleCount * 0.75);
  const isCandidateBetter =
    isReady &&
    candidate.sampleCount >= MIN_RECOMMENDED_THRESHOLD_SAMPLES &&
    (candidate.winRatePct ?? -Infinity) > (production.winRatePct ?? -Infinity) &&
    (candidate.avgReturnPct ?? -Infinity) >
      (production.avgReturnPct ?? -Infinity) &&
    (worstReturnDeltaPct ?? -Infinity) >= -2 &&
    sampleCountNotTooSmall;

  return {
    candidateRuleSetId: selected.id,
    candidateRuleSetName: selected.name,
    window,
    productionSampleCount: production.sampleCount,
    candidateSampleCount: candidate.sampleCount,
    productionWinCount: production.winCount,
    candidateWinCount: candidate.winCount,
    productionLossCount: production.lossCount,
    candidateLossCount: candidate.lossCount,
    productionWinRatePct: production.winRatePct,
    candidateWinRatePct: candidate.winRatePct,
    winRateDeltaPct,
    productionAvgReturnPct: production.avgReturnPct,
    candidateAvgReturnPct: candidate.avgReturnPct,
    avgReturnDeltaPct,
    productionMedianReturnPct: production.medianReturnPct,
    candidateMedianReturnPct: candidate.medianReturnPct,
    medianReturnDeltaPct: delta(
      candidate.medianReturnPct,
      production.medianReturnPct,
    ),
    productionWorstReturnPct: production.worstReturnPct,
    candidateWorstReturnPct: candidate.worstReturnPct,
    worstReturnDeltaPct,
    productionBestReturnPct: production.bestReturnPct,
    candidateBestReturnPct: candidate.bestReturnPct,
    productionCoverage: production.coveragePct,
    candidateCoverage: candidate.coveragePct,
    coverageDeltaPct: delta(candidate.coveragePct, production.coveragePct),
    isCandidateBetter,
    reason: isReady
      ? isCandidateBetter
        ? "Candidate improves win rate and average return without material downside deterioration."
        : "Candidate does not clear improvement, downside, and sample-size gates."
      : "Insufficient forward return samples.",
  };
}

function winRateDefinitions() {
  return {
    validSample:
      "A row is valid for a window only if corresponding forward_Xd_return_pct is not null.",
    entryAction: {
      buyCandidate: "Buy Candidate wins if forward_Xd_return_pct > 0.",
      watch: "Watch is tracked separately, not primary buy win rate.",
      avoid: "Avoid wins if forward_Xd_return_pct <= 0.",
    },
    positionAction: {
      hold: "Hold wins if forward_Xd_return_pct > 0.",
      reduce: "Reduce wins if forward_Xd_return_pct <= 0.",
      sellCandidate: "Sell Candidate wins if forward_Xd_return_pct <= 0.",
      exit: "Exit wins if forward_Xd_return_pct <= 0.",
    },
    general: "Win Rate = winCount / validSampleCount. Sample count is reported clearly for each window.",
  };
}

export async function buildRuleABReport({
  limit,
  candidate,
}: {
  limit?: number;
  candidate?: string | null;
} = {}): Promise<RuleABReport> {
  const generatedAt = new Date().toISOString();
  const selected = selectedCandidate(candidate);
  const simulation = await buildThresholdSimulationReport({ limit });
  const isReadyForABComparison =
    simulation.availableForwardReturnRows >= MIN_RECOMMENDED_THRESHOLD_SAMPLES &&
    simulation.readyWindows.length > 0;
  const abComparisons = FORWARD_WINDOWS.map((window) => {
    const production = simulation.simulationResults.find(
      (result) =>
        result.ruleSetId === productionRuleSet.id && result.window === window,
    );
    const selectedResult = simulation.simulationResults.find(
      (result) => result.ruleSetId === selected.id && result.window === window,
    );

    return buildComparison({
      selected,
      window,
      production,
      candidate: selectedResult,
      isReady: isReadyForABComparison,
    });
  });

  return {
    ok: simulation.ok,
    generatedAt,
    totalRowsScanned: simulation.totalRowsScanned,
    availableForwardReturnRows: simulation.availableForwardReturnRows,
    insufficientForwardReturnRows: simulation.insufficientForwardReturnRows,
    minRecommendedSamples: MIN_RECOMMENDED_THRESHOLD_SAMPLES,
    isReadyForABComparison,
    readyWindows: simulation.readyWindows,
    notReadyReason: isReadyForABComparison
      ? null
      : "Forward return samples are still insufficient for reliable A/B comparison.",
    productionRuleSet: productionRuleSetForAB(),
    candidateRuleSets,
    selectedCandidateRuleSet: selected,
    abComparisons,
    winRateDefinitions: winRateDefinitions(),
    recommendation: isReadyForABComparison
      ? "A/B comparison is ready for review; production thresholds remain unchanged."
      : recommendationNotReady,
    rollingRecommendationAvailable: true,
    rollingRecommendationEndpoint: ROLLING_RECOMMENDATION_ENDPOINT,
    winRateTrendAvailable: true,
    winRateTrendEndpoint: WIN_RATE_TREND_ENDPOINT,
    tradeWinRateLeaderboardAvailable: true,
    tradeWinRateLeaderboardEndpoint: TRADE_WIN_RATE_LEADERBOARD_ENDPOINT,
    safetyWarnings,
    error: simulation.error,
  };
}
