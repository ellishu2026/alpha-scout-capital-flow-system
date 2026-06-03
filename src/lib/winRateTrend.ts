import "server-only";

import { signalSnapshotTableName } from "@/lib/signalSnapshots";
import {
  getSupabaseAdminClient,
  getSupabaseConfigStatus,
  isSupabaseConfigured,
} from "@/lib/supabaseAdmin";
import {
  DEFAULT_AB_CANDIDATE_RULE_SET,
  FORWARD_WINDOWS,
  MIN_RECOMMENDED_THRESHOLD_SAMPLES,
  TRADE_WIN_RATE_LEADERBOARD_ENDPOINT,
  WIN_RATE_TREND_ENDPOINT,
  calculateWindowStats,
  candidateRuleSets,
  hasAnyForwardReturn,
  makeCandidateEvaluator,
  numberOrNull,
  productionActions,
  productionRuleSet,
  roundPct,
} from "@/lib/thresholdSimulation";
import type { SignalPerformanceRow } from "@/lib/thresholdSimulation";
import type {
  ActionSignal,
  ForwardWindowKey,
  PositionActionSignal,
  ThresholdSimulationRuleSet,
  WinRateDefinitions,
  WinRateTrendAction,
  WinRateTrendActionType,
  WinRateTrendForwardWindow,
  WinRateTrendPoint,
  WinRateTrendReport,
  WinRateTrendSeries,
} from "@/types/stock";

const DEFAULT_FORWARD_WINDOW: ForwardWindowKey = "forward5D";
const DEFAULT_ROLLING_WINDOW = 20;
const DEFAULT_ACTION_TYPE: WinRateTrendActionType = "entry";
const DEFAULT_ACTION: WinRateTrendAction = "Buy Candidate";
const SUPPORTED_ROLLING_WINDOWS = [20, 50, 100] as const;

const safetyWarnings = [
  "Win-rate trend is reporting only; production thresholds are not changed.",
  "Candidate rules are not auto-promoted or activated.",
  "Production threshold changes require threshold simulation, A/B comparison, rolling recommendation, rule promotion, and explicit Risk Gate approval.",
  "No real trading or order execution is implemented.",
];

function winRateDefinitions(): WinRateDefinitions {
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
    general:
      "Win Rate = winCount / validSampleCount. Sample count is reported clearly for each trend point.",
  };
}

function parseLimit(limit: number | undefined) {
  return Number.isFinite(limit)
    ? Math.min(Math.max(Math.floor(limit as number), 1), 500)
    : 500;
}

function selectedForwardWindow(value?: string | null): ForwardWindowKey {
  const normalized = value?.trim();

  return FORWARD_WINDOWS.some((window) => window.key === normalized)
    ? (normalized as ForwardWindowKey)
    : DEFAULT_FORWARD_WINDOW;
}

function selectedRollingWindow(value?: number | string | null) {
  const parsed = Number(value);

  return SUPPORTED_ROLLING_WINDOWS.includes(
    parsed as (typeof SUPPORTED_ROLLING_WINDOWS)[number],
  )
    ? parsed
    : DEFAULT_ROLLING_WINDOW;
}

function selectedActionType(value?: string | null): WinRateTrendActionType {
  return value === "position" ? "position" : DEFAULT_ACTION_TYPE;
}

function selectedAction({
  action,
  actionType,
}: {
  action?: string | null;
  actionType: WinRateTrendActionType;
}): WinRateTrendAction {
  const normalized = action?.trim();
  const entryActions: ActionSignal[] = ["Buy Candidate", "Watch", "Avoid"];
  const positionActions: PositionActionSignal[] = [
    "Hold",
    "Reduce",
    "Sell Candidate",
    "Exit",
  ];

  if (
    actionType === "entry" &&
    entryActions.includes(normalized as ActionSignal)
  ) {
    return normalized as WinRateTrendAction;
  }

  if (
    actionType === "position" &&
    positionActions.includes(normalized as PositionActionSignal)
  ) {
    return normalized as WinRateTrendAction;
  }

  return actionType === "position" ? "Hold" : DEFAULT_ACTION;
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

function fieldFor(windowKey: ForwardWindowKey) {
  return FORWARD_WINDOWS.find((window) => window.key === windowKey)?.field;
}

function actionForRow({
  row,
  ruleSet,
  actionType,
}: {
  row: SignalPerformanceRow;
  ruleSet: ThresholdSimulationRuleSet;
  actionType: WinRateTrendActionType;
}) {
  const actions = ruleSet.isProduction
    ? productionActions(row)
    : makeCandidateEvaluator(ruleSet.id)(row);

  return actionType === "entry"
    ? actions.entryActionSignal
    : actions.positionActionSignal;
}

function isWinningReturn({
  action,
  actionType,
  returnPct,
}: {
  action: WinRateTrendAction;
  actionType: WinRateTrendActionType;
  returnPct: number;
}) {
  if (actionType === "entry") {
    return action === "Avoid" ? returnPct <= 0 : returnPct > 0;
  }

  return action === "Hold" ? returnPct > 0 : returnPct <= 0;
}

function statsForAction({
  rows,
  ruleSet,
  forwardWindow,
  actionType,
  action,
}: {
  rows: SignalPerformanceRow[];
  ruleSet: ThresholdSimulationRuleSet;
  forwardWindow: ForwardWindowKey;
  actionType: WinRateTrendActionType;
  action: WinRateTrendAction;
}) {
  const field = fieldFor(forwardWindow);

  if (!field) return calculateWindowStats([]);

  const values = rows
    .filter(
      (row) =>
        actionForRow({ row, ruleSet, actionType }) === action &&
        numberOrNull(row[field]) != null,
    )
    .map((row) => numberOrNull(row[field]))
    .filter((value): value is number => value != null);
  const baseStats = calculateWindowStats(values);
  const winCount = values.filter((value) =>
    isWinningReturn({ action, actionType, returnPct: value }),
  ).length;

  return values.length === 0
    ? baseStats
    : {
        ...baseStats,
        winCount,
        lossCount: values.length - winCount,
        winRatePct: roundPct((winCount / values.length) * 100),
      };
}

function buildSeries({
  rows,
  ruleSet,
  seriesType,
  forwardWindow,
  rollingWindow,
  actionType,
  action,
  isReady,
}: {
  rows: SignalPerformanceRow[];
  ruleSet: ThresholdSimulationRuleSet;
  seriesType: WinRateTrendSeries["seriesType"];
  forwardWindow: WinRateTrendForwardWindow;
  rollingWindow: number;
  actionType: WinRateTrendActionType;
  action: WinRateTrendAction;
  isReady: boolean;
}): WinRateTrendSeries {
  if (!isReady) {
    return {
      ruleSetId: ruleSet.id,
      ruleSetName: ruleSet.name,
      seriesType,
      points: [],
      notReadyReason:
        "Forward return samples are insufficient for win-rate trend.",
    };
  }

  const points = rows
    .map((row, index) => {
      const rollingRows = rows.slice(Math.max(0, index - rollingWindow + 1), index + 1);
      const stats = statsForAction({
        rows: rollingRows,
        ruleSet,
        forwardWindow,
        actionType,
        action,
      });

      if (stats.sampleCount === 0) return null;

      return {
        date: row.signal_date,
        signalDate: row.signal_date,
        rollingWindow,
        ...stats,
        ruleSetId: ruleSet.id,
        ruleSetName: ruleSet.name,
        forwardWindow,
        actionType,
        action,
      };
    })
    .filter((point): point is WinRateTrendPoint => point != null);

  return {
    ruleSetId: ruleSet.id,
    ruleSetName: ruleSet.name,
    seriesType,
    points,
    notReadyReason: points.length > 0 ? null : "No valid trend points for selected filters.",
  };
}

function delta(candidate: number | null, production: number | null) {
  return candidate == null || production == null
    ? null
    : roundPct(candidate - production);
}

function buildDeltaSeries({
  productionSeries,
  candidateSeries,
  isReady,
}: {
  productionSeries: WinRateTrendSeries;
  candidateSeries: WinRateTrendSeries;
  isReady: boolean;
}) {
  if (!isReady) {
    return {
      points: [],
      notReadyReason:
        "Forward return samples are insufficient for win-rate trend.",
    };
  }

  const candidateByDate = new Map(
    candidateSeries.points.map((point) => [point.signalDate, point]),
  );
  const points = productionSeries.points.flatMap((productionPoint) => {
    const candidatePoint = candidateByDate.get(productionPoint.signalDate);

    if (!candidatePoint) return [];

    return [
      {
        date: productionPoint.signalDate,
        signalDate: productionPoint.signalDate,
        productionWinRatePct: productionPoint.winRatePct,
        candidateWinRatePct: candidatePoint.winRatePct,
        winRateDeltaPct: delta(
          candidatePoint.winRatePct,
          productionPoint.winRatePct,
        ),
        productionAvgReturnPct: productionPoint.avgReturnPct,
        candidateAvgReturnPct: candidatePoint.avgReturnPct,
        avgReturnDeltaPct: delta(
          candidatePoint.avgReturnPct,
          productionPoint.avgReturnPct,
        ),
        sampleCount: Math.min(
          productionPoint.sampleCount,
          candidatePoint.sampleCount,
        ),
      },
    ];
  });

  return {
    points,
    notReadyReason: points.length > 0 ? null : "No overlapping A/B trend points.",
  };
}

function buildReport({
  generatedAt,
  rows,
  selectedCandidateRuleSet,
  selectedForwardWindow,
  selectedRollingWindow,
  selectedActionType,
  selectedAction,
  error,
}: {
  generatedAt: string;
  rows: SignalPerformanceRow[];
  selectedCandidateRuleSet: ThresholdSimulationRuleSet;
  selectedForwardWindow: ForwardWindowKey;
  selectedRollingWindow: number;
  selectedActionType: WinRateTrendActionType;
  selectedAction: WinRateTrendAction;
  error?: string;
}): WinRateTrendReport {
  const totalRowsScanned = rows.length;
  const availableForwardReturnRows = rows.filter(hasAnyForwardReturn).length;
  const readyWindows = FORWARD_WINDOWS.map((window) => {
    const sampleCount = rows.filter(
      (row) => numberOrNull(row[window.field]) != null,
    ).length;

    return sampleCount >= MIN_RECOMMENDED_THRESHOLD_SAMPLES ? window.key : null;
  }).filter((key): key is ForwardWindowKey => key != null);
  const isReady =
    availableForwardReturnRows >= MIN_RECOMMENDED_THRESHOLD_SAMPLES &&
    readyWindows.includes(selectedForwardWindow);
  const orderedRows = [...rows].sort((a, b) =>
    a.signal_date.localeCompare(b.signal_date),
  );
  const productionSeries = buildSeries({
    rows: orderedRows,
    ruleSet: productionRuleSet,
    seriesType: "production",
    forwardWindow: selectedForwardWindow,
    rollingWindow: selectedRollingWindow,
    actionType: selectedActionType,
    action: selectedAction,
    isReady,
  });
  const candidateSeries = buildSeries({
    rows: orderedRows,
    ruleSet: selectedCandidateRuleSet,
    seriesType: "candidate",
    forwardWindow: selectedForwardWindow,
    rollingWindow: selectedRollingWindow,
    actionType: selectedActionType,
    action: selectedAction,
    isReady,
  });
  const deltaSeries = buildDeltaSeries({
    productionSeries,
    candidateSeries,
    isReady,
  });
  const latestProduction = productionSeries.points.at(-1) ?? null;
  const latestCandidate = candidateSeries.points.at(-1) ?? null;

  return {
    ok: error == null,
    generatedAt,
    totalRowsScanned,
    availableForwardReturnRows,
    minRecommendedSamples: MIN_RECOMMENDED_THRESHOLD_SAMPLES,
    selectedForwardWindow,
    selectedRollingWindow,
    selectedActionType,
    selectedAction,
    productionRuleSet,
    selectedCandidateRuleSet,
    availableCandidates: candidateRuleSets,
    winRateDefinitions: winRateDefinitions(),
    trendReadiness: {
      status: isReady ? "Ready" : "Not Ready",
      isReady,
      availableForwardReturnRows,
      minRecommendedSamples: MIN_RECOMMENDED_THRESHOLD_SAMPLES,
      readyWindows,
      notReadyReason: isReady
        ? null
        : "Forward return samples are insufficient for win-rate trend.",
    },
    trendSeries: [productionSeries],
    abTrendSeries: {
      productionSeries,
      candidateSeries,
      deltaSeries,
    },
    summary: {
      status: isReady ? "Ready" : "Not Ready",
      samples: availableForwardReturnRows,
      minRecommendedSamples: MIN_RECOMMENDED_THRESHOLD_SAMPLES,
      currentWinRatePct: latestProduction?.winRatePct ?? null,
      candidateWinRatePct: latestCandidate?.winRatePct ?? null,
      winRateDeltaPct: delta(
        latestCandidate?.winRatePct ?? null,
        latestProduction?.winRatePct ?? null,
      ),
      currentAvgReturnPct: latestProduction?.avgReturnPct ?? null,
      candidateAvgReturnPct: latestCandidate?.avgReturnPct ?? null,
      avgReturnDeltaPct: delta(
        latestCandidate?.avgReturnPct ?? null,
        latestProduction?.avgReturnPct ?? null,
      ),
    },
    tradeWinRateLeaderboardAvailable: true,
    tradeWinRateLeaderboardEndpoint: TRADE_WIN_RATE_LEADERBOARD_ENDPOINT,
    recommendation: isReady
      ? "Win-rate trend is ready for research review; production thresholds remain unchanged."
      : "Collect more forward return samples before win-rate trend conclusions.",
    safetyWarnings,
    error,
  };
}

export async function buildWinRateTrendReport({
  limit,
  window,
  rolling,
  actionType,
  action,
  candidate,
}: {
  limit?: number;
  window?: string | null;
  rolling?: number | string | null;
  actionType?: string | null;
  action?: string | null;
  candidate?: string | null;
} = {}): Promise<WinRateTrendReport> {
  const parsedLimit = parseLimit(limit);
  const generatedAt = new Date().toISOString();
  const selectedWindow = selectedForwardWindow(window);
  const selectedRolling = selectedRollingWindow(rolling);
  const selectedType = selectedActionType(actionType);
  const selectedSignalAction = selectedAction({
    action,
    actionType: selectedType,
  });
  const selectedCandidateRuleSet = selectedCandidate(candidate);

  if (!isSupabaseConfigured()) {
    return buildReport({
      generatedAt,
      rows: [],
      selectedCandidateRuleSet,
      selectedForwardWindow: selectedWindow,
      selectedRollingWindow: selectedRolling,
      selectedActionType: selectedType,
      selectedAction: selectedSignalAction,
      error: getSupabaseConfigStatus().reason ?? "SUPABASE_ENV_MISSING",
    });
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return buildReport({
      generatedAt,
      rows: [],
      selectedCandidateRuleSet,
      selectedForwardWindow: selectedWindow,
      selectedRollingWindow: selectedRolling,
      selectedActionType: selectedType,
      selectedAction: selectedSignalAction,
      error: "SUPABASE_UNAVAILABLE",
    });
  }

  const { data, error: queryError } = await supabase
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
        ...FORWARD_WINDOWS.map((forwardWindow) => forwardWindow.field),
      ].join(","),
    )
    .order("signal_date", { ascending: false })
    .limit(parsedLimit);

  return buildReport({
    generatedAt,
    rows: (data ?? []) as unknown as SignalPerformanceRow[],
    selectedCandidateRuleSet,
    selectedForwardWindow: selectedWindow,
    selectedRollingWindow: selectedRolling,
    selectedActionType: selectedType,
    selectedAction: selectedSignalAction,
    error: queryError?.message,
  });
}

export { WIN_RATE_TREND_ENDPOINT };
