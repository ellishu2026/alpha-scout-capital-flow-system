import "server-only";

import {
  MIN_RECOMMENDED_THRESHOLD_SAMPLES,
  RULE_AB_ENDPOINT,
  buildThresholdSimulationReport,
  candidateRuleSets,
  productionRuleSet,
} from "@/lib/thresholdSimulation";
import type {
  RulePromotionCandidate,
  RulePromotionReport,
  RulePromotionStatus,
  ThresholdSimulationResult,
} from "@/types/stock";

const PROMOTION_RECOMMENDATION_NOT_READY =
  "No candidate rule can be promoted until forward return samples are sufficient.";

const promotionStatuses: RulePromotionStatus[] = [
  "DRAFT",
  "SIMULATED",
  "RECOMMENDED",
  "APPROVED",
  "REJECTED",
  "ACTIVE_PRODUCTION",
];

const safetyWarnings = [
  "Read-only debug workflow: production thresholds are not changed.",
  "Automatic promotion and activation are disabled.",
  "Production rule changes require explicit Risk Gate approval.",
  "No real trading or order execution is implemented.",
];

function approvalGate() {
  return {
    explicitApprovalRequired: true,
    autoPromotionAllowed: false,
    minimumSampleRequired: MIN_RECOMMENDED_THRESHOLD_SAMPLES,
    requiresWinRateImprovement: true,
    requiresAverageReturnImprovement: true,
    requiresWorstReturnNotWorse: true,
    requiresRiskReview: true,
  } as const;
}

function promotionWorkflow() {
  return {
    statuses: promotionStatuses,
    sequence: "DRAFT -> SIMULATED -> RECOMMENDED -> APPROVED -> ACTIVE_PRODUCTION",
    description:
      "Candidate rules must be simulated, pass performance gates, be recommended for review, and receive explicit Risk Gate approval before any future production activation.",
  };
}

function currentProductionRuleSet() {
  return {
    id: productionRuleSet.id,
    name: productionRuleSet.name,
    status: "ACTIVE_PRODUCTION" as const,
    autoActivationAllowed: false as const,
    activatedAt: null,
  };
}

function bestCandidateByRuleSet(
  bestCandidate: ThresholdSimulationResult | null,
  ruleSetId: string,
) {
  return bestCandidate?.ruleSetId === ruleSetId;
}

function candidateStatus({
  isReady,
  bestCandidate,
  ruleSetId,
}: {
  isReady: boolean;
  bestCandidate: ThresholdSimulationResult | null;
  ruleSetId: string;
}): Pick<
  RulePromotionCandidate,
  "simulationStatus" | "approvalStatus" | "canBePromoted" | "promotionBlockedReason"
> {
  if (!isReady) {
    return {
      simulationStatus: "SIMULATED_NOT_READY",
      approvalStatus: "SIMULATED_NOT_READY",
      canBePromoted: false,
      promotionBlockedReason:
        "Forward return samples are still insufficient for reliable threshold simulation.",
    };
  }

  if (!bestCandidateByRuleSet(bestCandidate, ruleSetId)) {
    return {
      simulationStatus: "SIMULATED",
      approvalStatus: "DRAFT",
      canBePromoted: false,
      promotionBlockedReason:
        "Candidate has not passed the win-rate, average-return, downside, and sample-size gates.",
    };
  }

  return {
    simulationStatus: "RECOMMENDED",
    approvalStatus: "RECOMMENDED",
    canBePromoted: true,
    promotionBlockedReason:
      "Awaiting explicit Risk Gate approval; auto-activation remains disabled.",
  };
}

export async function buildRulePromotionReport(): Promise<RulePromotionReport> {
  const generatedAt = new Date().toISOString();
  const simulation = await buildThresholdSimulationReport({ limit: 500 });
  const abComparisonReady =
    simulation.availableForwardReturnRows >= MIN_RECOMMENDED_THRESHOLD_SAMPLES &&
    simulation.readyWindows.length > 0;
  const candidatePromotions = candidateRuleSets.map((ruleSet) => ({
    id: ruleSet.id,
    name: ruleSet.name,
    description: ruleSet.description,
    autoActivationAllowed: false as const,
    ...candidateStatus({
      isReady: simulation.isReadyForThresholdSimulation,
      bestCandidate: simulation.bestCandidate,
      ruleSetId: ruleSet.id,
    }),
  }));
  const hasPromotableCandidate = candidatePromotions.some(
    (candidate) => candidate.canBePromoted,
  );

  return {
    ok: simulation.ok,
    generatedAt,
    currentProductionRuleSet: currentProductionRuleSet(),
    candidateRuleSets: candidatePromotions,
    promotionWorkflow: promotionWorkflow(),
    approvalGate: approvalGate(),
    abComparisonRequired: true,
    abComparisonEndpoint: RULE_AB_ENDPOINT,
    abComparisonReady,
    recommendation: hasPromotableCandidate
      ? "A candidate may be reviewed through the approval workflow, but production remains unchanged until explicit Risk Gate approval."
      : PROMOTION_RECOMMENDATION_NOT_READY,
    safetyWarnings,
    error: simulation.error,
  };
}
