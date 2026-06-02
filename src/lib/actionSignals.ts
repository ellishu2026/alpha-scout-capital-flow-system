import type {
  ActionConfidence,
  ActionSignal,
  ActionSignalSummary,
  StockCandidate,
} from "@/types/stock";

const proxyProviders = new Set(["YFINANCE_COMPOSITE_PROXY", "YFINANCE_CHAIKIN"]);
const etfOrNonOperatingTickers = new Set(["SOXL", "SMH", "DXYZ"]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveRawSignal(signal: string) {
  return signal === "Strong Accumulation" || signal === "Accumulation";
}

function avoidRawSignal(signal: string) {
  return (
    signal === "Neutral" ||
    signal === "Distribution" ||
    signal === "Weak" ||
    signal.toLowerCase().includes("avoid")
  );
}

function hasRequiredActionInputs(candidate: StockCandidate) {
  return (
    isFiniteNumber(candidate.compositeScore) &&
    isFiniteNumber(candidate.capitalFlowScore) &&
    isFiniteNumber(candidate.normalizedFlowScore) &&
    candidate.flowDataQualityGrade != null &&
    candidate.providerUsed != null &&
    isFiniteNumber(candidate.price)
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

export function evaluateActionSignal(candidate: StockCandidate): StockCandidate {
  const reasons: string[] = [];
  const riskFlags: string[] = [];
  const signal = candidate.signal ?? "";
  const dataQualityGrade = candidate.flowDataQualityGrade;
  const providerUsed = candidate.providerUsed;
  const compositeScore = candidate.compositeScore;
  const capitalFlowScore = candidate.capitalFlowScore;
  const normalizedFlowScore = candidate.normalizedFlowScore;
  const flowDirectionBreadth = candidate.flowDirectionBreadth;
  const hasProxyProvider = providerUsed ? proxyProviders.has(providerUsed) : false;
  const hasProviderErrors = (candidate.providerErrors?.length ?? 0) > 0;

  if (!hasRequiredActionInputs(candidate)) {
    return {
      ...candidate,
      actionSignal: "Insufficient Data",
      actionConfidence: "Low",
      actionReasons: [
        "Required score, provider, data quality, or price fields are missing.",
      ],
      actionRiskFlags: ["NO_FORWARD_RETURN_HISTORY"],
    };
  }

  const normalizedFlowScoreValue = normalizedFlowScore ?? 0;
  const flowDirectionBreadthValue = flowDirectionBreadth ?? 0;

  // TODO V1.7.5: use V1.7.3 forward-return win-rate statistics to calibrate
  // thresholds once enough historical action samples have accumulated.
  riskFlags.push("NO_FORWARD_RETURN_HISTORY");

  if (dataQualityGrade === "B" || dataQualityGrade === "C") {
    riskFlags.push("LOW_DATA_QUALITY");
  }

  if (dataQualityGrade === "D") {
    riskFlags.push("LOW_DATA_QUALITY");
  }

  if (hasProxyProvider) {
    riskFlags.push("PROXY_PROVIDER");
  }

  if (isFiniteNumber(flowDirectionBreadth) && flowDirectionBreadth < 40) {
    riskFlags.push("WEAK_FLOW_BREADTH");
  }

  if (
    isFiniteNumber(candidate.shortTermFlowAcceleration) &&
    candidate.shortTermFlowAcceleration < 0
  ) {
    riskFlags.push("NEGATIVE_SHORT_TERM_FLOW");
  }

  if (candidate.capitalFlow3D < 0 && candidate.capitalFlow5D < 0) {
    riskFlags.push("NEGATIVE_3D_AND_5D_FLOW");
  }

  if (compositeScore < 65) {
    riskFlags.push("LOW_COMPOSITE_SCORE");
  }

  if (capitalFlowScore < 60) {
    riskFlags.push("LOW_CAPITAL_FLOW_SCORE");
  }

  if (hasProviderErrors) {
    riskFlags.push("PROVIDER_ERRORS_PRESENT");
  }

  if (etfOrNonOperatingTickers.has(candidate.ticker)) {
    riskFlags.push("ETF_OR_NON_OPERATING_COMPANY");
  }

  if (candidate.sourceBucket === "MARKET_SCAN_TOP15") {
    riskFlags.push("MARKET_SCAN_ONLY");
  }

  if (candidate.sourceBucket === "FIXED_WATCHLIST") {
    riskFlags.push("FIXED_WATCHLIST_ONLY");
  }

  const severeAvoid =
    avoidRawSignal(signal) ||
    compositeScore < 65 ||
    capitalFlowScore < 60 ||
    normalizedFlowScoreValue < 45 ||
    dataQualityGrade === "D" ||
    hasProviderErrors ||
    (candidate.capitalFlow3D < 0 &&
      candidate.capitalFlow5D < 0 &&
      isFiniteNumber(flowDirectionBreadth) &&
      flowDirectionBreadth <= 40);

  let actionSignal: ActionSignal;
  let actionConfidence: ActionConfidence = "Low";

  if (severeAvoid) {
    actionSignal = "Avoid";
    reasons.push("Risk controls require Avoid.");
  } else {
    const buyCandidate =
      positiveRawSignal(signal) &&
      compositeScore >= 82 &&
      capitalFlowScore >= 85 &&
      dataQualityGrade === "A" &&
      candidate.capitalFlowQuality === "REAL_PROVIDER" &&
      !hasProxyProvider &&
      flowDirectionBreadthValue >= 80 &&
      normalizedFlowScoreValue >= 75;

    if (buyCandidate) {
      actionSignal = "Buy Candidate";
      actionConfidence =
        compositeScore >= 88 &&
        capitalFlowScore >= 90 &&
        signal === "Strong Accumulation"
          ? "High"
          : "Medium";
      reasons.push("A-grade real provider accumulation signal passed action thresholds.");
    } else {
      actionSignal = "Watch";
      actionConfidence =
        positiveRawSignal(signal) && compositeScore >= 75 && capitalFlowScore >= 75
          ? "Medium"
          : "Low";
      reasons.push("Signal should remain on watch until action thresholds are met.");
    }
  }

  if (
    actionSignal === "Buy Candidate" &&
    (hasProxyProvider || dataQualityGrade === "B" || dataQualityGrade === "C")
  ) {
    actionSignal = "Watch";
    actionConfidence = "Medium";
    reasons.push(
      "Raw signal downgraded because provider/data quality is not A-grade real provider data.",
    );
  }

  if (
    signal === "Strong Accumulation" &&
    (dataQualityGrade === "B" || hasProxyProvider)
  ) {
    reasons.push(
      "Strong raw signal downgraded due to lower data quality or proxy provider.",
    );
  }

  if (hasProxyProvider || dataQualityGrade === "B" || dataQualityGrade === "C") {
    reasons.push(
      "Raw signal downgraded because provider/data quality is not A-grade real provider data.",
    );
  }

  if (dataQualityGrade === "D") {
    actionSignal = "Avoid";
    actionConfidence = "Low";
  }

  return {
    ...candidate,
    actionSignal,
    actionConfidence,
    actionReasons: unique(reasons),
    actionRiskFlags: unique(riskFlags),
  };
}

export function applyActionSignalsToSnapshot<T extends { items: StockCandidate[] }>(
  snapshot: T,
): T {
  return {
    ...snapshot,
    items: snapshot.items.map(evaluateActionSignal),
  };
}

export function applyActionSignalsToItems(items: StockCandidate[]) {
  return items.map(evaluateActionSignal);
}

export function buildActionSignalSummary(
  items: StockCandidate[],
): ActionSignalSummary {
  const buyCandidateTickers = items
    .filter((item) => item.actionSignal === "Buy Candidate")
    .map((item) => item.ticker);
  const watchTickers = items
    .filter((item) => item.actionSignal === "Watch")
    .map((item) => item.ticker);
  const avoidTickers = items
    .filter((item) => item.actionSignal === "Avoid")
    .map((item) => item.ticker);
  const insufficientDataTickers = items
    .filter((item) => item.actionSignal === "Insufficient Data")
    .map((item) => item.ticker);

  return {
    buyCandidateCount: buyCandidateTickers.length,
    watchCount: watchTickers.length,
    avoidCount: avoidTickers.length,
    insufficientDataCount: insufficientDataTickers.length,
    buyCandidateTickers,
    watchTickers,
    avoidTickers,
    insufficientDataTickers,
  };
}
