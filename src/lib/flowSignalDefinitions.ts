export type FlowState =
  | "Inflow"
  | "Outflow"
  | "Flat"
  | "Fluctuate"
  | "Reversal";

export type FlowSignalCategory =
  | "Strong Inflow"
  | "Persistent Inflow"
  | "Strong Outflow"
  | "Persistent Outflow"
  | "Flow Reversal";

export const FLOW_SIGNAL_THRESHOLDS = {
  strongInflowPercentile: 0.8,
  strongOutflowPercentile: 0.2,
  persistentLookbackDays: 5,
  persistentMinDirectionalDays: 3,
  reversalTrendLookbackDays: 3,
  flatAbsNetFlowThreshold: 0,
} as const;

export const FLOW_SIGNAL_CATEGORIES: Array<{
  label: FlowSignalCategory;
  definition: string;
}> = [
  {
    label: "Strong Inflow",
    definition: "ticker-level netFlow percentile >= 80",
  },
  {
    label: "Persistent Inflow",
    definition: "positive flow days >= 3 in latest 5 trading days",
  },
  {
    label: "Strong Outflow",
    definition: "ticker-level netFlow percentile <= 20",
  },
  {
    label: "Persistent Outflow",
    definition: "negative flow days >= 3 in latest 5 trading days",
  },
  {
    label: "Flow Reversal",
    definition: "latest flow direction differs from recent 3D / 5D trend",
  },
];

export function getFlowStateFromNetFlow(
  netFlow: number | null | undefined,
): FlowState {
  if (netFlow == null || netFlow === 0) {
    return "Flat";
  }

  return netFlow > 0 ? "Inflow" : "Outflow";
}

export function normalizeFlowStateFromSignal(signal: string): FlowState {
  const normalized = signal.trim().toLowerCase();

  if (normalized.includes("reversal")) return "Reversal";
  if (normalized.includes("fluctuate")) return "Fluctuate";
  if (
    normalized.includes("accum") ||
    normalized.includes("inflow") ||
    normalized.includes("bull")
  ) {
    return "Inflow";
  }
  if (
    normalized.includes("distribution") ||
    normalized.includes("outflow") ||
    normalized.includes("bear") ||
    normalized.includes("weak")
  ) {
    return "Outflow";
  }

  return "Flat";
}

