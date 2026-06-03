import "server-only";

import { signalSnapshotTableName } from "@/lib/signalSnapshots";
import {
  getSupabaseAdminClient,
  getSupabaseConfigStatus,
  isSupabaseConfigured,
} from "@/lib/supabaseAdmin";
import type {
  ActionSignal,
  FlowDataQualityGrade,
  ForwardWindowStats,
  PositionActionSignal,
  StockCandidate,
  ThresholdSimulationReport,
  ThresholdSimulationResult,
  ThresholdSimulationRuleSet,
  ThresholdSimulationSummary,
} from "@/types/stock";

const FORWARD_WINDOWS = [
  { key: "forward1D", field: "forward_1d_return_pct" },
  { key: "forward3D", field: "forward_3d_return_pct" },
  { key: "forward5D", field: "forward_5d_return_pct" },
  { key: "forward10D", field: "forward_10d_return_pct" },
  { key: "forward20D", field: "forward_20d_return_pct" },
] as const;

export const MIN_RECOMMENDED_THRESHOLD_SAMPLES = 30;
export const RULE_PROMOTION_ENDPOINT = "/api/debug/rule-promotion";
const HOLD_RECOMMENDATION =
  "Hold current production thresholds until forward return samples are sufficient.";

type ForwardWindowKey = (typeof FORWARD_WINDOWS)[number]["key"];

type SignalPerformanceRow = {
  signal_date: string;
  mode: string | null;
  source_bucket: string | null;
  ticker: string;
  signal: string | null;
  capital_flow_score: number | string | null;
  composite_score: number | string | null;
  flow_data_quality_grade: string | null;
  provider_used: string | null;
  raw_item?: StockCandidate | null;
  forward_1d_return_pct: number | string | null;
  forward_3d_return_pct: number | string | null;
  forward_5d_return_pct: number | string | null;
  forward_10d_return_pct: number | string | null;
  forward_20d_return_pct: number | string | null;
};

type SimulatedActions = {
  entryActionSignal: ActionSignal;
  positionActionSignal: PositionActionSignal;
};

type RuleEvaluator = (row: SignalPerformanceRow) => SimulatedActions;

export const productionRuleSet: ThresholdSimulationRuleSet = {
  id: "V1.7.6_ENTRY_POSITION_ACTION_RULES",
  name: "Current Production Entry / Position Action Rules",
  description: "Current production Entry / Position action rules.",
  entryRuleSummary:
    "Uses the active V1.7.6+ Entry action persisted in stored signal snapshots.",
  positionRuleSummary:
    "Uses the active V1.7.6+ Position action persisted in stored signal snapshots.",
  status: "ACTIVE_PRODUCTION",
  isProduction: true,
  autoActivationAllowed: false,
};

export const candidateRuleSets: ThresholdSimulationRuleSet[] = [
  {
    id: "V1.8.0_CONSERVATIVE_BUY_CANDIDATE",
    name: "Conservative Buy Candidate",
    description:
      "Higher composite and capital-flow thresholds with positive 3D and 5D capital flow and A-grade data.",
    entryRuleSummary:
      "Buy Candidate requires positive raw signal, composite >= 88, capitalFlowScore >= 90, normalizedFlowScore >= 82, positive 3D/5D flow, A-grade real provider data, and breadth >= 85.",
    positionRuleSummary:
      "Hold for candidate-quality rows; otherwise use conservative Reduce/Sell/Exit deterioration checks.",
    isProduction: false,
    autoActivationAllowed: false,
  },
  {
    id: "V1.8.0_BALANCED_BUY_CANDIDATE",
    name: "Balanced Buy Candidate",
    description:
      "Similar to current production rules but slightly tighter to test modest precision improvement.",
    entryRuleSummary:
      "Buy Candidate requires positive raw signal, composite >= 84, capitalFlowScore >= 87, normalizedFlowScore >= 78, A-grade real provider data, and breadth >= 80.",
    positionRuleSummary:
      "Hold for strong positive rows; Reduce/Sell/Exit remain simulation-only deterioration labels.",
    isProduction: false,
    autoActivationAllowed: false,
  },
  {
    id: "V1.8.0_AGGRESSIVE_BUY_CANDIDATE",
    name: "Aggressive Buy Candidate",
    description:
      "Slightly lower thresholds to increase Buy Candidate coverage with expected lower precision.",
    entryRuleSummary:
      "Buy Candidate allows positive raw signal, composite >= 78, capitalFlowScore >= 78, normalizedFlowScore >= 70, non-proxy A/B data, and breadth >= 65.",
    positionRuleSummary:
      "Hold for constructive rows; weaker rows remain Reduce/Sell/Exit in simulation.",
    isProduction: false,
    autoActivationAllowed: false,
  },
  {
    id: "V1.8.0_DATA_QUALITY_STRICT",
    name: "Data Quality Strict",
    description:
      "Only A-grade real provider rows can become Buy Candidate; proxy or B/C data can only be Watch or Avoid.",
    entryRuleSummary:
      "Buy Candidate requires A-grade real provider data plus positive raw signal, composite >= 82, capitalFlowScore >= 85, normalizedFlowScore >= 75, and breadth >= 80.",
    positionRuleSummary:
      "Proxy or B/C rows cannot be Buy Candidate; position labels are simulated from deterioration and hold checks.",
    isProduction: false,
    autoActivationAllowed: false,
  },
  {
    id: "V1.8.0_FLOW_MOMENTUM_STRICT",
    name: "Flow Momentum Strict",
    description:
      "Requires stronger 3D, 5D, and 9D capital-flow confirmation to test flow momentum quality.",
    entryRuleSummary:
      "Buy Candidate requires positive raw signal, composite >= 82, capitalFlowScore >= 86, normalizedFlowScore >= 78, positive 3D/5D/9D flow, A-grade data, and breadth >= 85.",
    positionRuleSummary:
      "Hold requires sustained positive 3D/5D/9D or medium-term flow; deterioration labels are simulation-only.",
    isProduction: false,
    autoActivationAllowed: false,
  },
];

function parseLimit(limit: number | undefined) {
  return Number.isFinite(limit)
    ? Math.min(Math.max(Math.floor(limit as number), 1), 500)
    : 500;
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;

  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function roundPct(value: number) {
  return Math.round(value * 100) / 100;
}

function median(values: number[]) {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function emptyWindowStats(): ForwardWindowStats {
  return {
    sampleCount: 0,
    winCount: 0,
    lossCount: 0,
    winRatePct: null,
    avgReturnPct: null,
    medianReturnPct: null,
    bestReturnPct: null,
    worstReturnPct: null,
  };
}

function calculateWindowStats(values: number[]): ForwardWindowStats {
  if (values.length === 0) return emptyWindowStats();

  const winCount = values.filter((value) => value > 0).length;
  const total = values.reduce((sum, value) => sum + value, 0);

  return {
    sampleCount: values.length,
    winCount,
    lossCount: values.length - winCount,
    winRatePct: roundPct((winCount / values.length) * 100),
    avgReturnPct: roundPct(total / values.length),
    medianReturnPct: roundPct(median(values) ?? 0),
    bestReturnPct: roundPct(Math.max(...values)),
    worstReturnPct: roundPct(Math.min(...values)),
  };
}

function hasAnyForwardReturn(row: SignalPerformanceRow) {
  return FORWARD_WINDOWS.some(
    (window) => numberOrNull(row[window.field]) != null,
  );
}

function rawItem(row: SignalPerformanceRow) {
  return row.raw_item && typeof row.raw_item === "object" ? row.raw_item : null;
}

function positiveRawSignal(signal: string | null) {
  return signal === "Strong Accumulation" || signal === "Accumulation";
}

function isRealProvider(row: SignalPerformanceRow) {
  const item = rawItem(row);

  return (
    item?.capitalFlowQuality === "REAL_PROVIDER" ||
    !String(item?.providerUsed ?? row.provider_used ?? "").includes("YFINANCE")
  );
}

function grade(row: SignalPerformanceRow) {
  return (
    rawItem(row)?.flowDataQualityGrade ??
    (row.flow_data_quality_grade as FlowDataQualityGrade | null) ??
    null
  );
}

function metric(row: SignalPerformanceRow, key: keyof StockCandidate) {
  return numberOrNull(rawItem(row)?.[key]);
}

function compositeScore(row: SignalPerformanceRow) {
  return metric(row, "compositeScore") ?? numberOrNull(row.composite_score) ?? 0;
}

function capitalFlowScore(row: SignalPerformanceRow) {
  return (
    metric(row, "capitalFlowScore") ?? numberOrNull(row.capital_flow_score) ?? 0
  );
}

function normalizedFlowScore(row: SignalPerformanceRow) {
  return metric(row, "normalizedFlowScore") ?? capitalFlowScore(row);
}

function flowDirectionBreadth(row: SignalPerformanceRow) {
  return metric(row, "flowDirectionBreadth") ?? 0;
}

function capitalFlow(row: SignalPerformanceRow, key: keyof StockCandidate) {
  return metric(row, key) ?? 0;
}

function providerIsProxy(row: SignalPerformanceRow) {
  const item = rawItem(row);
  const provider = String(item?.providerUsed ?? row.provider_used ?? "");

  return (
    item?.capitalFlowQuality === "LIVE_PROXY" ||
    item?.capitalFlowDataSource === "YFINANCE_COMPOSITE_PROXY" ||
    provider === "YFINANCE_COMPOSITE_PROXY"
  );
}

function productionActions(row: SignalPerformanceRow): SimulatedActions {
  const item = rawItem(row);

  return {
    entryActionSignal:
      item?.entryActionSignal ?? item?.actionSignal ?? "Insufficient Data",
    positionActionSignal: item?.positionActionSignal ?? "Insufficient Data",
  };
}

function simulatedPosition(row: SignalPerformanceRow, entry: ActionSignal) {
  const cfs = capitalFlowScore(row);
  const nfs = normalizedFlowScore(row);
  const composite = compositeScore(row);
  const breadth = flowDirectionBreadth(row);
  const flow3D = capitalFlow(row, "capitalFlow3D");
  const flow5D = capitalFlow(row, "capitalFlow5D");
  const flow9D = capitalFlow(row, "capitalFlow9D");

  if (composite < 55 || cfs < 45 || nfs < 35 || breadth < 30) {
    return "Exit";
  }

  if (
    row.signal === "Weak / Avoid" ||
    cfs < 65 ||
    nfs < 50 ||
    composite < 70 ||
    (flow3D < 0 && flow5D < 0 && flow9D < 0)
  ) {
    return "Sell Candidate";
  }

  if (
    entry === "Buy Candidate" ||
    (positiveRawSignal(row.signal) && cfs >= 75 && nfs >= 65 && breadth >= 60)
  ) {
    return "Hold";
  }

  return "Reduce";
}

function makeCandidateEvaluator(ruleSetId: string): RuleEvaluator {
  return (row) => {
    const composite = compositeScore(row);
    const cfs = capitalFlowScore(row);
    const nfs = normalizedFlowScore(row);
    const breadth = flowDirectionBreadth(row);
    const flow3D = capitalFlow(row, "capitalFlow3D");
    const flow5D = capitalFlow(row, "capitalFlow5D");
    const flow9D = capitalFlow(row, "capitalFlow9D");
    const qualityGrade = grade(row);
    const realProvider = isRealProvider(row);
    const proxy = providerIsProxy(row);
    const positiveSignal = positiveRawSignal(row.signal);
    const severeAvoid =
      row.signal === "Weak / Avoid" ||
      composite < 55 ||
      cfs < 45 ||
      nfs < 35 ||
      (flow3D < 0 && flow5D < 0 && flow9D < 0);
    let buyCandidate = false;

    if (severeAvoid) {
      return {
        entryActionSignal: "Avoid",
        positionActionSignal: simulatedPosition(row, "Avoid"),
      };
    }

    if (ruleSetId === "V1.8.0_CONSERVATIVE_BUY_CANDIDATE") {
      buyCandidate =
        positiveSignal &&
        composite >= 88 &&
        cfs >= 90 &&
        nfs >= 82 &&
        flow3D > 0 &&
        flow5D > 0 &&
        qualityGrade === "A" &&
        realProvider &&
        !proxy &&
        breadth >= 85;
    } else if (ruleSetId === "V1.8.0_BALANCED_BUY_CANDIDATE") {
      buyCandidate =
        positiveSignal &&
        composite >= 84 &&
        cfs >= 87 &&
        nfs >= 78 &&
        qualityGrade === "A" &&
        realProvider &&
        !proxy &&
        breadth >= 80;
    } else if (ruleSetId === "V1.8.0_AGGRESSIVE_BUY_CANDIDATE") {
      buyCandidate =
        positiveSignal &&
        composite >= 78 &&
        cfs >= 78 &&
        nfs >= 70 &&
        (qualityGrade === "A" || qualityGrade === "B") &&
        !proxy &&
        breadth >= 65;
    } else if (ruleSetId === "V1.8.0_DATA_QUALITY_STRICT") {
      buyCandidate =
        positiveSignal &&
        composite >= 82 &&
        cfs >= 85 &&
        nfs >= 75 &&
        qualityGrade === "A" &&
        realProvider &&
        !proxy &&
        breadth >= 80;
    } else if (ruleSetId === "V1.8.0_FLOW_MOMENTUM_STRICT") {
      buyCandidate =
        positiveSignal &&
        composite >= 82 &&
        cfs >= 86 &&
        nfs >= 78 &&
        flow3D > 0 &&
        flow5D > 0 &&
        flow9D > 0 &&
        qualityGrade === "A" &&
        realProvider &&
        !proxy &&
        breadth >= 85;
    }

    const entryActionSignal: ActionSignal = buyCandidate
      ? "Buy Candidate"
      : "Watch";

    return {
      entryActionSignal,
      positionActionSignal: simulatedPosition(row, entryActionSignal),
    };
  };
}

function countsFor(rows: SignalPerformanceRow[], evaluator: RuleEvaluator) {
  return rows.reduce(
    (counts, row) => {
      const actions = evaluator(row);

      counts.signalCount += 1;

      if (actions.entryActionSignal === "Buy Candidate") counts.buyCandidateCount += 1;
      if (actions.entryActionSignal === "Watch") counts.watchCount += 1;
      if (actions.entryActionSignal === "Avoid") counts.avoidCount += 1;
      if (actions.positionActionSignal === "Hold") counts.holdCount += 1;
      if (actions.positionActionSignal === "Reduce") counts.reduceCount += 1;
      if (actions.positionActionSignal === "Sell Candidate") {
        counts.sellCandidateCount += 1;
      }
      if (actions.positionActionSignal === "Exit") counts.exitCount += 1;

      return counts;
    },
    {
      signalCount: 0,
      buyCandidateCount: 0,
      watchCount: 0,
      avoidCount: 0,
      holdCount: 0,
      reduceCount: 0,
      sellCandidateCount: 0,
      exitCount: 0,
    },
  );
}

function buildResult({
  ruleSet,
  rows,
  window,
  evaluator,
  productionResult,
  minRecommendedSamples,
}: {
  ruleSet: ThresholdSimulationRuleSet;
  rows: SignalPerformanceRow[];
  window: (typeof FORWARD_WINDOWS)[number];
  evaluator: RuleEvaluator;
  productionResult?: ThresholdSimulationResult;
  minRecommendedSamples: number;
}): ThresholdSimulationResult {
  const actionCounts = countsFor(rows, evaluator);
  const values = rows
    .filter((row) => evaluator(row).entryActionSignal === "Buy Candidate")
    .map((row) => numberOrNull(row[window.field]))
    .filter((value): value is number => value != null);
  const stats = calculateWindowStats(values);
  const coveragePct =
    rows.length > 0 ? roundPct((actionCounts.buyCandidateCount / rows.length) * 100) : 0;

  let reason = "Production baseline.";
  let isBetterThanProduction = false;

  if (!ruleSet.isProduction) {
    if (
      stats.sampleCount < minRecommendedSamples ||
      !productionResult ||
      productionResult.sampleCount < minRecommendedSamples
    ) {
      reason = "Insufficient forward return samples.";
    } else {
      const winRateDelta =
        (stats.winRatePct ?? 0) - (productionResult.winRatePct ?? 0);
      const avgReturnDelta =
        (stats.avgReturnPct ?? 0) - (productionResult.avgReturnPct ?? 0);
      const worstReturnDelta =
        (stats.worstReturnPct ?? 0) - (productionResult.worstReturnPct ?? 0);
      const sampleCountNotTooSmall =
        stats.sampleCount >= Math.max(minRecommendedSamples, productionResult.sampleCount * 0.75);

      isBetterThanProduction =
        winRateDelta > 0 &&
        avgReturnDelta > 0 &&
        worstReturnDelta >= -2 &&
        sampleCountNotTooSmall;
      reason = isBetterThanProduction
        ? "Candidate improves win rate and average return without material downside deterioration."
        : "Candidate does not clear improvement, downside, and sample-size gates.";
    }
  }

  const comparisonToProduction = productionResult
    ? {
        winRateDeltaPct:
          stats.winRatePct == null || productionResult.winRatePct == null
            ? null
            : roundPct(stats.winRatePct - productionResult.winRatePct),
        avgReturnDeltaPct:
          stats.avgReturnPct == null || productionResult.avgReturnPct == null
            ? null
            : roundPct(stats.avgReturnPct - productionResult.avgReturnPct),
        medianReturnDeltaPct:
          stats.medianReturnPct == null || productionResult.medianReturnPct == null
            ? null
            : roundPct(stats.medianReturnPct - productionResult.medianReturnPct),
        worstReturnDeltaPct:
          stats.worstReturnPct == null || productionResult.worstReturnPct == null
            ? null
            : roundPct(stats.worstReturnPct - productionResult.worstReturnPct),
        sampleCountDelta: stats.sampleCount - productionResult.sampleCount,
        coverageDeltaPct: roundPct(coveragePct - productionResult.coveragePct),
        isBetterThanProduction,
        reason,
      }
    : {
        winRateDeltaPct: null,
        avgReturnDeltaPct: null,
        medianReturnDeltaPct: null,
        worstReturnDeltaPct: null,
        sampleCountDelta: 0,
        coverageDeltaPct: 0,
        isBetterThanProduction,
        reason,
      };

  return {
    ruleSetId: ruleSet.id,
    ruleSetName: ruleSet.name,
    window: window.key,
    ...stats,
    maxDrawdownProxy: stats.worstReturnPct,
    ...actionCounts,
    coveragePct,
    comparisonToProduction,
  };
}

function emptyReport({
  generatedAt,
  totalRowsScanned = 0,
  availableForwardReturnRows = 0,
  error,
}: {
  generatedAt: string;
  totalRowsScanned?: number;
  availableForwardReturnRows?: number;
  error?: string;
}): ThresholdSimulationReport {
  return {
    ok: error == null,
    generatedAt,
    totalRowsScanned,
    availableForwardReturnRows,
    insufficientForwardReturnRows:
      totalRowsScanned - availableForwardReturnRows,
    minRecommendedSamples: MIN_RECOMMENDED_THRESHOLD_SAMPLES,
    isReadyForThresholdSimulation: false,
    readyWindows: [],
    notReadyReason:
      "Forward return samples are still insufficient for reliable threshold simulation.",
    productionRuleSet,
    candidateRuleSets,
    simulationResults: [],
    bestCandidate: null,
    recommendation: HOLD_RECOMMENDATION,
    promotionWorkflowAvailable: true,
    promotionEndpoint: RULE_PROMOTION_ENDPOINT,
    promotionAllowed: false,
    safetyWarnings: [
      "Simulation only: production thresholds are not changed.",
      "Automatic activation is disabled for all rule sets.",
      "Production threshold changes require explicit approval through a later Risk Gate workflow.",
    ],
    error,
  };
}

export function buildThresholdSimulationSummary(
  report: ThresholdSimulationReport,
): ThresholdSimulationSummary {
  return {
    available: true,
    endpoint: "/api/debug/threshold-simulation?limit=500",
    status: report.isReadyForThresholdSimulation ? "Ready" : "Not Ready",
    samples: report.availableForwardReturnRows,
    minRecommendedSamples: report.minRecommendedSamples,
    readyWindows: report.readyWindows,
    bestCandidate: report.bestCandidate,
    recommendation: report.recommendation,
    notReadyReason: report.notReadyReason,
    promotionWorkflowAvailable: report.promotionWorkflowAvailable,
    promotionEndpoint: report.promotionEndpoint,
    promotionAllowed: report.promotionAllowed,
  };
}

export async function buildThresholdSimulationReport({
  limit,
}: {
  limit?: number;
} = {}): Promise<ThresholdSimulationReport> {
  const parsedLimit = parseLimit(limit);
  const generatedAt = new Date().toISOString();

  if (!isSupabaseConfigured()) {
    return emptyReport({
      generatedAt,
      error: getSupabaseConfigStatus().reason ?? "SUPABASE_ENV_MISSING",
    });
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return emptyReport({ generatedAt, error: "SUPABASE_UNAVAILABLE" });
  }

  const { data, error } = await supabase
    .from(signalSnapshotTableName)
    .select(
      [
        "signal_date",
        "mode",
        "source_bucket",
        "ticker",
        "signal",
        "capital_flow_score",
        "composite_score",
        "flow_data_quality_grade",
        "provider_used",
        "raw_item",
        ...FORWARD_WINDOWS.map((window) => window.field),
      ].join(","),
    )
    .order("signal_date", { ascending: false })
    .limit(parsedLimit);

  if (error) {
    return emptyReport({ generatedAt, error: error.message });
  }

  const rows = (data ?? []) as unknown as SignalPerformanceRow[];
  const totalRowsScanned = rows.length;
  const availableForwardReturnRows = rows.filter(hasAnyForwardReturn).length;
  const readyWindows = FORWARD_WINDOWS.map((window) => {
    const sampleCount = rows.filter(
      (row) => numberOrNull(row[window.field]) != null,
    ).length;

    return sampleCount >= MIN_RECOMMENDED_THRESHOLD_SAMPLES ? window.key : null;
  }).filter((key): key is ForwardWindowKey => key != null);
  const isReadyForThresholdSimulation = readyWindows.length > 0;
  const productionResults = new Map<ForwardWindowKey, ThresholdSimulationResult>();
  const simulationResults: ThresholdSimulationResult[] = [];

  FORWARD_WINDOWS.forEach((window) => {
    const productionResult = buildResult({
      ruleSet: productionRuleSet,
      rows,
      window,
      evaluator: productionActions,
      minRecommendedSamples: MIN_RECOMMENDED_THRESHOLD_SAMPLES,
    });

    productionResults.set(window.key, productionResult);
    simulationResults.push(productionResult);

    candidateRuleSets.forEach((ruleSet) => {
      simulationResults.push(
        buildResult({
          ruleSet,
          rows,
          window,
          evaluator: makeCandidateEvaluator(ruleSet.id),
          productionResult,
          minRecommendedSamples: MIN_RECOMMENDED_THRESHOLD_SAMPLES,
        }),
      );
    });
  });

  const eligibleCandidates = simulationResults.filter(
    (result) =>
      !result.ruleSetId.includes("V1.7.6") &&
      result.comparisonToProduction.isBetterThanProduction,
  );
  const bestCandidate =
    isReadyForThresholdSimulation && eligibleCandidates.length > 0
      ? eligibleCandidates.sort(
          (a, b) =>
            (b.avgReturnPct ?? -Infinity) - (a.avgReturnPct ?? -Infinity) ||
            (b.winRatePct ?? -Infinity) - (a.winRatePct ?? -Infinity) ||
            b.sampleCount - a.sampleCount,
        )[0]
      : null;

  return {
    ok: true,
    generatedAt,
    totalRowsScanned,
    availableForwardReturnRows,
    insufficientForwardReturnRows:
      totalRowsScanned - availableForwardReturnRows,
    minRecommendedSamples: MIN_RECOMMENDED_THRESHOLD_SAMPLES,
    isReadyForThresholdSimulation,
    readyWindows,
    notReadyReason: isReadyForThresholdSimulation
      ? null
      : "Forward return samples are still insufficient for reliable threshold simulation.",
    productionRuleSet,
    candidateRuleSets,
    simulationResults: isReadyForThresholdSimulation ? simulationResults : [],
    bestCandidate,
    recommendation: bestCandidate
      ? `Candidate ${bestCandidate.ruleSetName} is eligible for human review; production thresholds remain unchanged until explicit approval.`
      : HOLD_RECOMMENDATION,
    promotionWorkflowAvailable: true,
    promotionEndpoint: RULE_PROMOTION_ENDPOINT,
    promotionAllowed: false,
    safetyWarnings: [
      "Simulation only: production thresholds are not changed.",
      "Automatic activation is disabled for all rule sets.",
      "Production threshold changes require explicit approval through a later Risk Gate workflow.",
    ],
  };
}
