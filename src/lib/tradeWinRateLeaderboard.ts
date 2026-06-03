import "server-only";

import { signalSnapshotTableName } from "@/lib/signalSnapshots";
import {
  getSupabaseAdminClient,
  getSupabaseConfigStatus,
  isSupabaseConfigured,
} from "@/lib/supabaseAdmin";
import {
  FORWARD_WINDOWS,
  MIN_RECOMMENDED_THRESHOLD_SAMPLES,
  TRADE_WIN_RATE_LEADERBOARD_ENDPOINT,
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
  PositionActionSignal,
  ThresholdSimulationRuleSet,
  TradeWinRateLeaderboardReport,
  TradeWinRateLeaderboardRow,
  TradeWinRateWindowKey,
  TradeWinRateWindowMetric,
  WinRateDefinitions,
} from "@/types/stock";

type TradeRuleCombo = {
  id: string;
  displayName: string;
  thresholdSummary: string;
  isProduction: boolean;
  baseRuleSet: ThresholdSimulationRuleSet;
};

const extendedForwardWindows: TradeWinRateWindowMetric[] = [
  { label: "4W", key: "forward4W", field: null, available: false },
  { label: "6W", key: "forward6W", field: null, available: false },
  { label: "9W", key: "forward9W", field: null, available: false },
  { label: "12W", key: "forward12W", field: null, available: false },
];

const forwardWindows: TradeWinRateWindowMetric[] = [
  { label: "1D", key: "forward1D", field: "forward_1d_return_pct", available: true },
  { label: "3D", key: "forward3D", field: "forward_3d_return_pct", available: true },
  { label: "5D", key: "forward5D", field: "forward_5d_return_pct", available: true },
  { label: "10D", key: "forward10D", field: "forward_10d_return_pct", available: true },
  { label: "20D", key: "forward20D", field: "forward_20d_return_pct", available: true },
  ...extendedForwardWindows,
];

const scoreWeights: Record<TradeWinRateWindowKey, number> = {
  forward1D: 5,
  forward3D: 10,
  forward5D: 20,
  forward10D: 20,
  forward20D: 20,
  forward4W: 10,
  forward6W: 7.5,
  forward9W: 5,
  forward12W: 2.5,
};

const safetyWarnings = [
  "Trade win-rate leaderboard is reporting only; production thresholds are not changed.",
  "Candidate rules are not auto-promoted or activated.",
  "Extended 4W, 6W, 9W, and 12W windows remain N/A until forward-return fields exist.",
  "No real trading or order execution is implemented.",
];

function parseLimit(limit: number | undefined) {
  return Number.isFinite(limit)
    ? Math.min(Math.max(Math.floor(limit as number), 1), 500)
    : 500;
}

function winRateDefinitions(): WinRateDefinitions {
  return {
    validSample:
      "A row is valid for a window only if corresponding forward return field is not null.",
    entryAction: {
      buyCandidate: "Entry Buy Candidate wins if forward return > 0.",
      watch: "Watch is tracked separately, not primary trade win rate.",
      avoid: "Entry Avoid wins if forward return <= 0.",
    },
    positionAction: {
      hold: "Position Hold wins if forward return > 0.",
      reduce: "Position Reduce wins if forward return <= 0.",
      sellCandidate: "Position Sell Candidate wins if forward return <= 0.",
      exit: "Position Exit wins if forward return <= 0.",
    },
    general: "Win Rate = winCount / validSampleCount.",
  };
}

function candidateById(id: string) {
  return candidateRuleSets.find((ruleSet) => ruleSet.id === id) ?? candidateRuleSets[0];
}

function tradeCombos(): TradeRuleCombo[] {
  const conservative = candidateById("V1.8.0_CONSERVATIVE_BUY_CANDIDATE");
  const balanced = candidateById("V1.8.0_BALANCED_BUY_CANDIDATE");
  const aggressive = candidateById("V1.8.0_AGGRESSIVE_BUY_CANDIDATE");
  const dataQuality = candidateById("V1.8.0_DATA_QUALITY_STRICT");
  const flowMomentum = candidateById("V1.8.0_FLOW_MOMENTUM_STRICT");

  return [
    {
      id: productionRuleSet.id,
      displayName: "Current Production V1.7.6",
      thresholdSummary: "Active Entry / Position production rules",
      isProduction: true,
      baseRuleSet: productionRuleSet,
    },
    {
      id: conservative.id,
      displayName: "Conservative · Comp>=88 · Flow>=90",
      thresholdSummary: "Higher composite and flow thresholds",
      isProduction: false,
      baseRuleSet: conservative,
    },
    {
      id: balanced.id,
      displayName: "Balanced · Comp>=84 · Flow>=87",
      thresholdSummary: "Balanced candidate threshold",
      isProduction: false,
      baseRuleSet: balanced,
    },
    {
      id: aggressive.id,
      displayName: "Aggressive · Comp>=80 · Flow>=75",
      thresholdSummary: "Higher coverage candidate threshold",
      isProduction: false,
      baseRuleSet: aggressive,
    },
    {
      id: dataQuality.id,
      displayName: "DQ Strict · Grade A only",
      thresholdSummary: "A-grade real provider data only",
      isProduction: false,
      baseRuleSet: dataQuality,
    },
    {
      id: flowMomentum.id,
      displayName: "Flow Strict · 3D/5D/9D confirm",
      thresholdSummary: "Multi-window flow confirmation",
      isProduction: false,
      baseRuleSet: flowMomentum,
    },
    {
      id: "V1.8.5_BALANCED_DQ_A",
      displayName: "Balanced + DQ A",
      thresholdSummary: "Balanced candidate with A-grade data emphasis",
      isProduction: false,
      baseRuleSet: balanced,
    },
    {
      id: "V1.8.5_BALANCED_FLOW_MOMENTUM",
      displayName: "Balanced + Flow Momentum",
      thresholdSummary: "Balanced candidate with flow-momentum emphasis",
      isProduction: false,
      baseRuleSet: flowMomentum,
    },
    {
      id: "V1.8.5_CONSERVATIVE_LOW_DRAWDOWN",
      displayName: "Conservative + Low Drawdown",
      thresholdSummary: "Conservative candidate with downside-risk emphasis",
      isProduction: false,
      baseRuleSet: conservative,
    },
    {
      id: "V1.8.5_AGGRESSIVE_HIGH_COVERAGE",
      displayName: "Aggressive + High Coverage",
      thresholdSummary: "Aggressive candidate with coverage emphasis",
      isProduction: false,
      baseRuleSet: aggressive,
    },
  ];
}

function actionsFor(row: SignalPerformanceRow, combo: TradeRuleCombo) {
  return combo.isProduction
    ? productionActions(row)
    : makeCandidateEvaluator(combo.baseRuleSet.id)(row);
}

function isWinningAction({
  entryAction,
  positionAction,
  returnPct,
}: {
  entryAction: ActionSignal;
  positionAction: PositionActionSignal;
  returnPct: number;
}) {
  if (entryAction === "Buy Candidate") return returnPct > 0;
  if (entryAction === "Avoid") return returnPct <= 0;
  if (positionAction === "Hold") return returnPct > 0;

  return ["Reduce", "Sell Candidate", "Exit"].includes(positionAction)
    ? returnPct <= 0
    : null;
}

function windowStats({
  rows,
  combo,
  field,
}: {
  rows: SignalPerformanceRow[];
  combo: TradeRuleCombo;
  field: string | null;
}) {
  if (!field) return { sampleCount: 0, winRatePct: null, avgReturnPct: null };

  const samples = rows.flatMap((row) => {
    const returnPct = numberOrNull(row[field as keyof SignalPerformanceRow]);

    if (returnPct == null) return [];

    const actions = actionsFor(row, combo);
    const isWin = isWinningAction({
      entryAction: actions.entryActionSignal,
      positionAction: actions.positionActionSignal,
      returnPct,
    });

    return isWin == null ? [] : [{ returnPct, isWin }];
  });

  if (samples.length === 0) {
    return { sampleCount: 0, winRatePct: null, avgReturnPct: null };
  }

  return {
    sampleCount: samples.length,
    winRatePct: roundPct(
      (samples.filter((sample) => sample.isWin).length / samples.length) * 100,
    ),
    avgReturnPct: roundPct(
      samples.reduce((sum, sample) => sum + sample.returnPct, 0) / samples.length,
    ),
  };
}

function buildRow({
  combo,
  rows,
  isReady,
}: {
  combo: TradeRuleCombo;
  rows: SignalPerformanceRow[];
  isReady: boolean;
}): TradeWinRateLeaderboardRow {
  const emptyWinRates = Object.fromEntries(
    forwardWindows.map((window) => [window.key, null]),
  ) as Record<TradeWinRateWindowKey, number | null>;
  const emptyAvgReturns = Object.fromEntries(
    forwardWindows.map((window) => [window.key, null]),
  ) as Partial<Record<TradeWinRateWindowKey, number | null>>;

  if (!isReady) {
    return {
      rank: 0,
      ruleSetId: combo.id,
      displayName: combo.displayName,
      thresholdSummary: combo.thresholdSummary,
      isProduction: combo.isProduction,
      autoActivationAllowed: false,
      status: "Not Ready",
      samples: 0,
      minRecommendedSamples: MIN_RECOMMENDED_THRESHOLD_SAMPLES,
      winRates: emptyWinRates,
      avgReturns: emptyAvgReturns,
      compositeTradeRateScore: null,
      scoreCoveragePct: 0,
      notReadyReason: "Need 30 forward return samples.",
    };
  }

  const statsByWindow = forwardWindows.map((window) => ({
    window,
    stats: windowStats({ rows, combo, field: window.field }),
  }));
  const winRates = Object.fromEntries(
    statsByWindow.map(({ window, stats }) => [window.key, stats.winRatePct]),
  ) as Record<TradeWinRateWindowKey, number | null>;
  const avgReturns = Object.fromEntries(
    statsByWindow.map(({ window, stats }) => [window.key, stats.avgReturnPct]),
  ) as Partial<Record<TradeWinRateWindowKey, number | null>>;
  const availableScoreWindows = statsByWindow.filter(
    ({ window, stats }) => window.available && stats.winRatePct != null,
  );
  const weightCoverage = availableScoreWindows.reduce(
    (sum, { window }) => sum + scoreWeights[window.key],
    0,
  );
  const compositeTradeRateScore =
    weightCoverage > 0
      ? roundPct(
          availableScoreWindows.reduce(
            (sum, { window, stats }) =>
              sum + (stats.winRatePct ?? 0) * scoreWeights[window.key],
            0,
          ) / weightCoverage,
        )
      : null;
  const samples = Math.max(...statsByWindow.map(({ stats }) => stats.sampleCount));

  return {
    rank: 0,
    ruleSetId: combo.id,
    displayName: combo.displayName,
    thresholdSummary: combo.thresholdSummary,
    isProduction: combo.isProduction,
    autoActivationAllowed: false,
    status: combo.isProduction ? "Active" : "Simulated",
    samples,
    minRecommendedSamples: MIN_RECOMMENDED_THRESHOLD_SAMPLES,
    winRates,
    avgReturns,
    compositeTradeRateScore,
    scoreCoveragePct: roundPct(weightCoverage),
    notReadyReason:
      compositeTradeRateScore == null ? "No valid leaderboard samples." : null,
  };
}

function rankRows(rows: TradeWinRateLeaderboardRow[]) {
  const allNotReady = rows.every((row) => row.compositeTradeRateScore == null);
  const sorted = allNotReady
    ? rows
    : [...rows].sort((a, b) => {
        if (a.compositeTradeRateScore == null && b.compositeTradeRateScore == null) {
          return 0;
        }
        if (a.compositeTradeRateScore == null) return 1;
        if (b.compositeTradeRateScore == null) return -1;

        return b.compositeTradeRateScore - a.compositeTradeRateScore;
      });

  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildReport({
  generatedAt,
  rows,
  error,
}: {
  generatedAt: string;
  rows: SignalPerformanceRow[];
  error?: string;
}): TradeWinRateLeaderboardReport {
  const totalRowsScanned = rows.length;
  const availableForwardReturnRows = rows.filter(hasAnyForwardReturn).length;
  const isReady = availableForwardReturnRows >= MIN_RECOMMENDED_THRESHOLD_SAMPLES;
  const leaderboardRows = rankRows(
    tradeCombos().map((combo) => buildRow({ combo, rows, isReady })),
  );

  return {
    ok: error == null,
    generatedAt,
    totalRowsScanned,
    availableForwardReturnRows,
    minRecommendedSamples: MIN_RECOMMENDED_THRESHOLD_SAMPLES,
    leaderboardReadiness: {
      status: isReady ? "Ready" : "Not Ready",
      isReady,
      notReadyReason: isReady
        ? null
        : "Forward return samples are insufficient for trade win-rate ranking.",
    },
    forwardWindows,
    scoreWeights,
    winRateDefinitions: winRateDefinitions(),
    rows: leaderboardRows,
    recommendation: isReady
      ? "Trade win-rate leaderboard is ready for research review; production thresholds remain unchanged."
      : "Collect more forward return samples before trade win-rate ranking.",
    safetyWarnings,
    error,
  };
}

export async function buildTradeWinRateLeaderboardReport({
  limit,
}: {
  limit?: number;
} = {}): Promise<TradeWinRateLeaderboardReport> {
  const generatedAt = new Date().toISOString();
  const parsedLimit = parseLimit(limit);

  if (!isSupabaseConfigured()) {
    return buildReport({
      generatedAt,
      rows: [],
      error: getSupabaseConfigStatus().reason ?? "SUPABASE_ENV_MISSING",
    });
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return buildReport({ generatedAt, rows: [], error: "SUPABASE_UNAVAILABLE" });
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

  return buildReport({
    generatedAt,
    rows: (data ?? []) as unknown as SignalPerformanceRow[],
    error: error?.message,
  });
}

export { TRADE_WIN_RATE_LEADERBOARD_ENDPOINT };
