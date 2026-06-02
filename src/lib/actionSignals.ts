import type {
  ActionConfidence,
  ActionSignal,
  ActionSignalSummary,
  PositionActionSignal,
  PositionActionSummary,
  StockCandidate,
} from "@/types/stock";

const proxyProviders = new Set(["YFINANCE_COMPOSITE_PROXY", "YFINANCE_CHAIKIN"]);
const etfOrNonOperatingTickers = new Set(["SOXL", "SMH", "DXYZ"]);

type ActionContext = {
  signal: string;
  dataQualityGrade: StockCandidate["flowDataQualityGrade"];
  providerUsed: StockCandidate["providerUsed"];
  compositeScore: number;
  capitalFlowScore: number;
  normalizedFlowScore: number;
  flowDirectionBreadth: number;
  hasProxyProvider: boolean;
  hasProviderErrors: boolean;
  weakBreadth: boolean;
  negativeShortTermFlow: boolean;
  negative3DAnd5D: boolean;
  severeNegativeFlow: boolean;
  severeProviderFailure: boolean;
  reasons: string[];
  riskFlags: string[];
  severeAvoidReasons: string[];
};

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

function buildActionContext(candidate: StockCandidate): ActionContext {
  const reasons: string[] = [];
  const riskFlags: string[] = [];
  const signal = candidate.signal ?? "";
  const dataQualityGrade = candidate.flowDataQualityGrade;
  const providerUsed = candidate.providerUsed;
  const compositeScore = candidate.compositeScore;
  const capitalFlowScore = candidate.capitalFlowScore;
  const normalizedFlowScore = candidate.normalizedFlowScore ?? 0;
  const flowDirectionBreadth = candidate.flowDirectionBreadth ?? 0;
  const hasProxyProvider = providerUsed ? proxyProviders.has(providerUsed) : false;
  const hasProviderErrors = (candidate.providerErrors?.length ?? 0) > 0;
  const weakBreadth = flowDirectionBreadth < 40;
  const negativeShortTermFlow =
    isFiniteNumber(candidate.shortTermFlowAcceleration) &&
    candidate.shortTermFlowAcceleration < 0;
  const negative3DAnd5D =
    candidate.capitalFlow3D < 0 && candidate.capitalFlow5D < 0;
  const severeNegativeFlow =
    (negative3DAnd5D && flowDirectionBreadth <= 40) ||
    (negative3DAnd5D && candidate.capitalFlow9D < 0);
  const severeProviderFailure =
    hasProviderErrors &&
    (dataQualityGrade === "C" ||
      dataQualityGrade === "D" ||
      candidate.capitalFlowQuality !== "REAL_PROVIDER" ||
      !providerUsed);

  // TODO V1.7.9: use forward-return win-rate statistics to calibrate
  // thresholds once enough historical action samples have accumulated.
  riskFlags.push("NO_FORWARD_RETURN_HISTORY");

  if (
    dataQualityGrade === "B" ||
    dataQualityGrade === "C" ||
    dataQualityGrade === "D"
  ) {
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

  if (normalizedFlowScore < 45) {
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

  return {
    signal,
    dataQualityGrade,
    providerUsed,
    compositeScore,
    capitalFlowScore,
    normalizedFlowScore,
    flowDirectionBreadth,
    hasProxyProvider,
    hasProviderErrors,
    weakBreadth,
    negativeShortTermFlow,
    negative3DAnd5D,
    severeNegativeFlow,
    severeProviderFailure,
    reasons,
    riskFlags,
    severeAvoidReasons,
  };
}

function evaluateEntryAction(
  candidate: StockCandidate,
  context: ActionContext,
): {
  entryActionSignal: ActionSignal;
  entryActionConfidence: ActionConfidence;
} {
  const {
    signal,
    dataQualityGrade,
    compositeScore,
    capitalFlowScore,
    normalizedFlowScore,
    flowDirectionBreadth,
    hasProxyProvider,
    hasProviderErrors,
    negativeShortTermFlow,
    severeAvoidReasons,
    reasons,
  } = context;

  if (severeAvoidReasons.length > 0) {
    reasons.push(...severeAvoidReasons);

    return {
      entryActionSignal: "Avoid",
      entryActionConfidence: "Low",
    };
  }

  const buyCandidate =
    positiveRawSignal(signal) &&
    compositeScore >= 82 &&
    capitalFlowScore >= 85 &&
    normalizedFlowScore >= 75 &&
    dataQualityGrade === "A" &&
    candidate.capitalFlowQuality === "REAL_PROVIDER" &&
    !hasProxyProvider &&
    flowDirectionBreadth >= 80;

  if (buyCandidate) {
    let entryActionConfidence: ActionConfidence =
      compositeScore >= 88 &&
      capitalFlowScore >= 90 &&
      normalizedFlowScore >= 80 &&
      signal === "Strong Accumulation"
        ? "High"
        : "Medium";

    reasons.push("Entry action passed A-grade real provider accumulation thresholds.");

    if (candidate.sourceBucket === "MARKET_SCAN_TOP15") {
      entryActionConfidence = reduceConfidence(entryActionConfidence);
      reasons.push(
        "Entry action confidence reduced because signal is market-scan-only.",
      );
    }

    if (hasProviderErrors) {
      entryActionConfidence = reduceConfidence(entryActionConfidence);
      reasons.push("Entry action confidence reduced due to provider warning.");
    }

    return {
      entryActionSignal: "Buy Candidate",
      entryActionConfidence,
    };
  }

  let entryActionConfidence: ActionConfidence =
    positiveRawSignal(signal) && compositeScore >= 75 && capitalFlowScore >= 75
      ? "Medium"
      : "Low";

  if (positiveRawSignal(signal)) {
    reasons.push(
      "Entry action kept on Watch because confirmation is not strong enough.",
    );
  } else if (signal === "Watch" || signal === "Watchlist") {
    reasons.push("Raw Watch signal kept on Watch for entry decisions.");
  } else {
    reasons.push("Entry action kept on Watch while risk and score confirmation develop.");
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

  if (hasProxyProvider || dataQualityGrade === "B" || dataQualityGrade === "C") {
    entryActionConfidence = "Medium";
    reasons.push(
      "Entry action downgraded because provider/data quality is not A-grade real provider data.",
    );
  }

  return {
    entryActionSignal: "Watch",
    entryActionConfidence,
  };
}

function evaluatePositionAction(
  candidate: StockCandidate,
  context: ActionContext,
  entryActionSignal: ActionSignal,
): {
  positionActionSignal: PositionActionSignal;
  positionActionConfidence: ActionConfidence;
} {
  const {
    signal,
    dataQualityGrade,
    compositeScore,
    capitalFlowScore,
    normalizedFlowScore,
    flowDirectionBreadth,
    hasProxyProvider,
    negativeShortTermFlow,
    negative3DAnd5D,
    severeProviderFailure,
    reasons,
  } = context;
  const mediumTermConstructive =
    candidate.capitalFlow3W > 0 || candidate.capitalFlow5W > 0;
  const severeExit =
    (dataQualityGrade === "D" && severeProviderFailure) ||
    compositeScore < 55 ||
    capitalFlowScore < 45 ||
    normalizedFlowScore < 35 ||
    flowDirectionBreadth < 30 ||
    (candidate.capitalFlow3D < 0 &&
      candidate.capitalFlow5D < 0 &&
      candidate.capitalFlow9D < 0 &&
      candidate.capitalFlow3W < 0);

  if (severeExit) {
    reasons.push("Position action set to Exit due to severe deterioration.");

    return {
      positionActionSignal: "Exit",
      positionActionConfidence: "High",
    };
  }

  const sellCandidate =
    avoidRawSignal(signal) ||
    (negative3DAnd5D && flowDirectionBreadth <= 40) ||
    normalizedFlowScore < 50 ||
    capitalFlowScore < 65 ||
    compositeScore < 70 ||
    (negative3DAnd5D && candidate.capitalFlow9D < 0);

  if (sellCandidate) {
    reasons.push(
      "Position action set to Sell Candidate due to multi-window negative capital flow.",
    );

    return {
      positionActionSignal: "Sell Candidate",
      positionActionConfidence:
        capitalFlowScore < 60 || normalizedFlowScore < 45 ? "High" : "Medium",
    };
  }

  const hold =
    entryActionSignal === "Buy Candidate" ||
    (positiveRawSignal(signal) &&
      capitalFlowScore >= 75 &&
      normalizedFlowScore >= 65 &&
      flowDirectionBreadth >= 60 &&
      mediumTermConstructive);

  if (hold) {
    reasons.push(
      "Position action set to Hold because medium-term capital flow remains constructive.",
    );

    return {
      positionActionSignal: "Hold",
      positionActionConfidence:
        entryActionSignal === "Buy Candidate" &&
        compositeScore >= 82 &&
        capitalFlowScore >= 85
          ? "High"
          : "Medium",
    };
  }

  const reduce =
    signal === "Watch" ||
    signal === "Watchlist" ||
    signal === "Neutral" ||
    candidate.capitalFlow3D < 0 ||
    (capitalFlowScore >= 60 && capitalFlowScore < 75) ||
    (normalizedFlowScore >= 45 && normalizedFlowScore < 65) ||
    (flowDirectionBreadth >= 40 && flowDirectionBreadth < 60) ||
    negativeShortTermFlow ||
    dataQualityGrade === "B" ||
    dataQualityGrade === "C" ||
    hasProxyProvider;

  if (reduce) {
    reasons.push("Position action set to Reduce because short-term flow weakened.");

    return {
      positionActionSignal: "Reduce",
      positionActionConfidence:
        negativeShortTermFlow || candidate.capitalFlow3D < 0 ? "Medium" : "Low",
    };
  }

  reasons.push(
    "Position action set to Hold because no severe position deterioration is present.",
  );

  return {
    positionActionSignal: "Hold",
    positionActionConfidence: "Low",
  };
}

export function evaluateActionSignal(candidate: StockCandidate): StockCandidate {
  if (!hasRequiredActionInputs(candidate)) {
    return {
      ...candidate,
      entryActionSignal: "Insufficient Data",
      entryActionConfidence: "Low",
      positionActionSignal: "Insufficient Data",
      positionActionConfidence: "Low",
      actionSignal: "Insufficient Data",
      actionConfidence: "Low",
      actionReasons: [
        "Required score, provider, data quality, or price fields are missing.",
      ],
      actionRiskFlags: ["NO_FORWARD_RETURN_HISTORY"],
    };
  }

  const context = buildActionContext(candidate);
  const entry = evaluateEntryAction(candidate, context);

  if (
    (context.hasProxyProvider ||
      context.dataQualityGrade === "B" ||
      context.dataQualityGrade === "C") &&
    entry.entryActionSignal === "Buy Candidate"
  ) {
    entry.entryActionSignal = "Watch";
    entry.entryActionConfidence = "Medium";
    context.reasons.push(
      "Entry action downgraded because provider/data quality is not A-grade real provider data.",
    );
  }

  const position = evaluatePositionAction(
    candidate,
    context,
    entry.entryActionSignal,
  );

  return {
    ...candidate,
    entryActionSignal: entry.entryActionSignal,
    entryActionConfidence: entry.entryActionConfidence,
    positionActionSignal: position.positionActionSignal,
    positionActionConfidence: position.positionActionConfidence,
    actionSignal: entry.entryActionSignal,
    actionConfidence: entry.entryActionConfidence,
    actionReasons: unique(context.reasons),
    actionRiskFlags: unique(context.riskFlags),
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
    .filter(
      (item) => (item.entryActionSignal ?? item.actionSignal) === "Buy Candidate",
    )
    .map((item) => item.ticker);
  const watchTickers = items
    .filter((item) => (item.entryActionSignal ?? item.actionSignal) === "Watch")
    .map((item) => item.ticker);
  const avoidTickers = items
    .filter((item) => (item.entryActionSignal ?? item.actionSignal) === "Avoid")
    .map((item) => item.ticker);
  const insufficientDataTickers = items
    .filter(
      (item) =>
        (item.entryActionSignal ?? item.actionSignal) === "Insufficient Data",
    )
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

export function buildPositionActionSummary(
  items: StockCandidate[],
): PositionActionSummary {
  const holdTickers = items
    .filter((item) => item.positionActionSignal === "Hold")
    .map((item) => item.ticker);
  const reduceTickers = items
    .filter((item) => item.positionActionSignal === "Reduce")
    .map((item) => item.ticker);
  const sellCandidateTickers = items
    .filter((item) => item.positionActionSignal === "Sell Candidate")
    .map((item) => item.ticker);
  const exitTickers = items
    .filter((item) => item.positionActionSignal === "Exit")
    .map((item) => item.ticker);
  const insufficientDataTickers = items
    .filter((item) => item.positionActionSignal === "Insufficient Data")
    .map((item) => item.ticker);

  return {
    holdCount: holdTickers.length,
    reduceCount: reduceTickers.length,
    sellCandidateCount: sellCandidateTickers.length,
    exitCount: exitTickers.length,
    insufficientDataCount: insufficientDataTickers.length,
    holdTickers,
    reduceTickers,
    sellCandidateTickers,
    exitTickers,
    insufficientDataTickers,
  };
}
