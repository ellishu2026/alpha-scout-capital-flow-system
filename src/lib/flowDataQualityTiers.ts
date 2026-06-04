import type { StockCandidate } from "@/types/stock";

export const FLOW_DATA_QUALITY_VERSION = "V1.9.0_FLOW_DATA_QUALITY_TIERS";
export const FLOW_DATA_QUALITY_ENDPOINT = "/api/debug/flow-data-quality?limit=26";

export type FlowDataTier =
  | "REAL_BUY_SELL_NET_FLOW"
  | "TRADE_DIRECTION_OR_ORDER_FLOW"
  | "ORDER_IMBALANCE"
  | "DEPTH_OR_QUOTE_PRESSURE"
  | "PROVIDER_MONEY_FLOW_INDICATOR"
  | "ENHANCED_OHLCV_PROXY"
  | "LEGACY_OHLCV_PROXY"
  | "YFINANCE_OR_FALLBACK_PROXY"
  | "UNKNOWN_OR_UNAVAILABLE";

export type FlowDataConfidence = "High" | "Medium" | "Low" | "Unknown";

export type FlowTierDefinition = {
  tier: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "U";
  id: FlowDataTier;
  label: string;
  meaning: string;
  qualityScore: number;
  productionReadyPotential: "High" | "Medium" | "Low" | "None";
};

export const FLOW_TIER_DEFINITIONS: FlowTierDefinition[] = [
  {
    tier: "A",
    id: "REAL_BUY_SELL_NET_FLOW",
    label: "Real Buy/Sell Net Flow",
    meaning: "True buy amount, sell amount, and net flow are available.",
    qualityScore: 100,
    productionReadyPotential: "High",
  },
  {
    tier: "B",
    id: "TRADE_DIRECTION_OR_ORDER_FLOW",
    label: "Trade Direction / Order Flow",
    meaning:
      "Tick/trade direction, aggressor side, active buy/sell inference, or large trade direction is available.",
    qualityScore: 85,
    productionReadyPotential: "Medium",
  },
  {
    tier: "C",
    id: "ORDER_IMBALANCE",
    label: "Order / Auction Imbalance",
    meaning: "Opening/closing imbalance, NOII, MOC/LOC imbalance, or similar.",
    qualityScore: 75,
    productionReadyPotential: "Medium",
  },
  {
    tier: "D",
    id: "DEPTH_OR_QUOTE_PRESSURE",
    label: "Depth / Quote Pressure",
    meaning: "Order book depth, bid/ask size imbalance, quote pressure.",
    qualityScore: 65,
    productionReadyPotential: "Medium",
  },
  {
    tier: "E",
    id: "PROVIDER_MONEY_FLOW_INDICATOR",
    label: "Provider Money Flow Indicator",
    meaning: "Provider-supplied MFI, AD, ADOSC, CMF, or similar.",
    qualityScore: 55,
    productionReadyPotential: "Low",
  },
  {
    tier: "F",
    id: "ENHANCED_OHLCV_PROXY",
    label: "Enhanced OHLCV Proxy",
    meaning: "V1.8.8.1 enhanced proxy computed from OHLCV components.",
    qualityScore: 45,
    productionReadyPotential: "Low",
  },
  {
    tier: "G",
    id: "LEGACY_OHLCV_PROXY",
    label: "Legacy OHLCV Proxy",
    meaning: "Existing Chaikin/legacy proxy from OHLCV.",
    qualityScore: 35,
    productionReadyPotential: "Low",
  },
  {
    tier: "H",
    id: "YFINANCE_OR_FALLBACK_PROXY",
    label: "Fallback Proxy",
    meaning: "yfinance or fallback proxy only.",
    qualityScore: 25,
    productionReadyPotential: "Low",
  },
  {
    tier: "U",
    id: "UNKNOWN_OR_UNAVAILABLE",
    label: "Unknown / Unavailable",
    meaning: "No usable flow source is available.",
    qualityScore: 0,
    productionReadyPotential: "None",
  },
];

export function getFlowTierDefinition(id: FlowDataTier) {
  return (
    FLOW_TIER_DEFINITIONS.find((definition) => definition.id === id) ??
    FLOW_TIER_DEFINITIONS.at(-1)!
  );
}

function hasLegacyFlow(candidate: StockCandidate) {
  return [
    candidate.capitalFlow1D,
    candidate.capitalFlow3D,
    candidate.capitalFlow5D,
    candidate.chaikinDailyFlowLatest,
    candidate.compositeDailyFlowLatest,
  ].some((value) => typeof value === "number" && Number.isFinite(value));
}

function hasFallbackSource(candidate: StockCandidate) {
  return (
    candidate.capitalFlowDataSource === "YFINANCE_COMPOSITE_PROXY" ||
    candidate.capitalFlowDataSource === "YFINANCE_CHAIKIN" ||
    candidate.capitalFlowQuality === "FALLBACK"
  );
}

export function hasEnhancedProxyAvailable(candidate: StockCandidate) {
  const dailyCount = candidate.flowWindowCoverage?.availableDailyFlowCount;

  return (
    (typeof dailyCount === "number" && dailyCount >= 2) ||
    candidate.archiveStatus === "ARCHIVE_HIT" ||
    candidate.flowWindowExtendedHistoryAvailable === true
  );
}

export function classifyFlowDataTier({
  candidate,
  enhancedProxyAvailable,
}: {
  candidate: StockCandidate;
  enhancedProxyAvailable?: boolean;
}) {
  if (enhancedProxyAvailable ?? hasEnhancedProxyAvailable(candidate)) {
    return getFlowTierDefinition("ENHANCED_OHLCV_PROXY");
  }

  if (hasLegacyFlow(candidate)) {
    return getFlowTierDefinition("LEGACY_OHLCV_PROXY");
  }

  if (hasFallbackSource(candidate)) {
    return getFlowTierDefinition("YFINANCE_OR_FALLBACK_PROXY");
  }

  return getFlowTierDefinition("UNKNOWN_OR_UNAVAILABLE");
}

export function confidenceForTier({
  tier,
  enhancedProxyConfidence,
}: {
  tier: FlowDataTier;
  enhancedProxyConfidence?: string | null;
}): FlowDataConfidence {
  if (tier === "REAL_BUY_SELL_NET_FLOW") return "High";
  if (
    tier === "TRADE_DIRECTION_OR_ORDER_FLOW" ||
    tier === "ORDER_IMBALANCE" ||
    tier === "DEPTH_OR_QUOTE_PRESSURE"
  ) {
    return "Medium";
  }
  if (tier === "ENHANCED_OHLCV_PROXY") {
    return enhancedProxyConfidence === "High" ||
      enhancedProxyConfidence === "Medium" ||
      enhancedProxyConfidence === "Low"
      ? enhancedProxyConfidence
      : "Medium";
  }
  if (tier === "LEGACY_OHLCV_PROXY" || tier === "YFINANCE_OR_FALLBACK_PROXY") {
    return "Low";
  }

  return "Unknown";
}

export function currentProductionFlowSource(candidate: StockCandidate) {
  return (
    candidate.providerUsed ??
    candidate.capitalFlowDataSource ??
    candidate.flowWindowProviderUsed ??
    "UNKNOWN"
  );
}

export function currentProductionFlowSourceClass() {
  return "OHLCV_OR_INDICATOR_ONLY";
}

export function recommendedFlowUpgradeSource() {
  return "Polygon trade/quote aggressor inference";
}

export function recommendedFlowUpgradeReason() {
  return "Current production data is OHLCV/indicator-only; Polygon is the lowest-friction configured path for trade/quote aggressor inference, while Databento/Nasdaq/IEX remain higher-quality future candidates.";
}

export function applyFlowDataQualityMetadataToItem(
  candidate: StockCandidate,
  options: {
    enhancedProxyAvailable?: boolean;
    enhancedProxyConfidence?: string | null;
    enhancedProxyFlow1D_V188?: number | null;
    enhancedProxyDirection_V188?: string | null;
  } = {},
): StockCandidate {
  const tierDefinition = classifyFlowDataTier({
    candidate,
    enhancedProxyAvailable: options.enhancedProxyAvailable,
  });
  const flowDataConfidence = confidenceForTier({
    tier: tierDefinition.id,
    enhancedProxyConfidence: options.enhancedProxyConfidence,
  });

  return {
    ...candidate,
    flowDataTier: tierDefinition.id,
    flowDataTierLabel: tierDefinition.label,
    flowDataQualityScore: tierDefinition.qualityScore,
    flowDataConfidence,
    realFlowAvailable: false,
    realBuyAmount: null,
    realSellAmount: null,
    realNetFlow: null,
    enhancedProxyAvailable:
      options.enhancedProxyAvailable ?? tierDefinition.id === "ENHANCED_OHLCV_PROXY",
    enhancedProxyAlgorithmVersion:
      tierDefinition.id === "ENHANCED_OHLCV_PROXY"
        ? "V1.8.8.1_ENHANCED_FLOW_PROXY_OHLCV_SOURCE_FIX"
        : null,
    enhancedProxyFlow1D_V188: options.enhancedProxyFlow1D_V188,
    enhancedProxyDirection_V188: options.enhancedProxyDirection_V188,
    currentProductionFlowSource: currentProductionFlowSource(candidate),
    currentProductionFlowSourceClass: currentProductionFlowSourceClass(),
    recommendedFlowUpgradeSource: recommendedFlowUpgradeSource(),
    recommendedFlowUpgradeReason: recommendedFlowUpgradeReason(),
    productionFlowChanged: false,
  };
}

export function applyFlowDataQualityMetadataToItems(items: StockCandidate[]) {
  return items.map((item) => applyFlowDataQualityMetadataToItem(item));
}
