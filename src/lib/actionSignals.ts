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
    Boolean(candidate.ticker) &&
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

function reduceConfidence(confidence: ActionConfidence): ActionConfidence {
  if (confidence === "High") return "Medium";
  if (confidence === "Medium") return "Low";

  return "Low";
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
  const weakBreadth = flowDirectionBreadthValue < 40;
  const negativeShortTermFlow =
    isFiniteNumber(candidate.shortTermFlowAcceleration) &&
    candidate.shortTermFlowAcceleration < 0;
  const negative3DAnd5D =
    candidate.capitalFlow3D < 0 && candidate.capitalFlow5D < 0;
  const severeNegativeFlow =
    (negative3DAnd5D && flowDirectionBreadthValue <= 40) ||
    (negative3DAnd5D && candidate.capitalFlow9D < 0);
  const severeProviderFailure =
    hasProviderErrors &&
    (dataQualityGrade === "C" ||
      dataQualityGrade === "D" ||
      candidate.capitalFlowQuality !== "REAL_PROVIDER" ||
      !providerUsed);

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

  if (weakBreadth) {
    riskFlags.push("WEAK_FLOW_BREADTH");
  }

  if (negativeShortTermFlow) {
    riskFlags.push("NEGATIVE_SHORT_TERM_FLOW");
  }

  if (negative3DAnd5D) {
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

  const severeAvoidReasons: string[] = [];

  if (avoidRawSignal(signal) && compositeScore < 70) {
    severeAvoidReasons.push(
      "Avoid triggered because raw signal is weak or neutral and composite score is below 70.",
    );
  }

  if (compositeScore < 65 || capitalFlowScore < 60) {
    severeAvoidReasons.push(
      "Avoid triggered by low composite or capital flow score.",
    );
  }

  if (normalizedFlowScoreValue < 45) {
    severeAvoidReasons.push("Avoid triggered by low normalized flow score.");
  }

  if (weakBreadth) {
    severeAvoidReasons.push("Avoid triggered by weak flow breadth.");
  }

  if (dataQualityGrade === "D") {
    severeAvoidReasons.push("Avoid triggered by D-grade flow data quality.");
  }

  if (severeNegativeFlow) {
    severeAvoidReasons.push(
      "Avoid triggered by severe negative multi-window capital flow.",
    );
  }

  if (severeProviderFailure) {
    severeAvoidReasons.push(
      "Avoid triggered by provider/data failure with weak final data quality.",
    );
  }

  const severeAvoid = severeAvoidReasons.length > 0;

  let actionSignal: ActionSignal;
  let actionConfidence: ActionConfidence = "Low";

  if (severeAvoid) {
    actionSignal = "Avoid";
    reasons.push(...severeAvoidReasons);
  } else {
    const buyCandidate =
      positiveRawSignal(signal) &&
      compositeScore >= 82 &&
      capitalFlowScore >= 85 &&
      normalizedFlowScoreValue >= 75 &&
      dataQualityGrade === "A" &&
      candidate.capitalFlowQuality === "REAL_PROVIDER" &&
      !hasProxyProvider &&
      flowDirectionBreadthValue >= 80;

    if (buyCandidate) {
      actionSignal = "Buy Candidate";
      actionConfidence =
        compositeScore >= 88 &&
        capitalFlowScore >= 90 &&
        normalizedFlowScoreValue >= 80 &&
        signal === "Strong Accumulation"
          ? "High"
          : "Medium";
      reasons.push("A-grade real provider accumulation signal passed action thresholds.");

      if (candidate.sourceBucket === "MARKET_SCAN_TOP15") {
        actionConfidence = reduceConfidence(actionConfidence);
        reasons.push(
          "Buy Candidate confidence reduced because signal is market-scan-only.",
        );
      }

      if (hasProviderErrors) {
        actionConfidence = reduceConfidence(actionConfidence);
        reasons.push(
          "Buy Candidate confidence reduced due to provider warning.",
        );
      }
    } else {
      actionSignal = "Watch";
      actionConfidence =
        positiveRawSignal(signal) && compositeScore >= 75 && capitalFlowScore >= 75
          ? "Medium"
          : "Low";

      if (positiveRawSignal(signal)) {
        reasons.push(
          "Positive signal kept on Watch because confirmation is not strong enough.",
        );
      } else if (signal === "Watch" || signal === "Watchlist") {
        reasons.push("Raw Watch signal kept on Watch.");
      } else {
        reasons.push("Signal kept on Watch while risk and score confirmation develop.");
      }

      if (
        negativeShortTermFlow &&
        candidate.capitalFlow5D > 0 &&
        candidate.capitalFlow9D > 0 &&
        candidate.capitalFlow3W > 0
      ) {
        reasons.push(
          "Short-term flow is negative, but medium-term flow remains constructive.",
        );
      }
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
    if (actionSignal === "Buy Candidate") {
      actionSignal = "Watch";
      actionConfidence = "Medium";
    }

    reasons.push(
      "Raw signal downgraded because provider/data quality is not A-grade real provider data.",
    );
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
