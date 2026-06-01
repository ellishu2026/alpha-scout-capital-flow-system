import type {
  FlowDataQualityGrade,
  FlowDataQualityInputs,
} from "@/types/stock";
import type { CapitalFlows, DailyFlowDetail } from "@/lib/capitalFlow";

const EXPECTED_MINIMUM_DAILY_FLOW_COUNT = 25;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function daysSince(dateText?: string) {
  if (!dateText) return null;

  const date = new Date(`${dateText.slice(0, 10)}T00:00:00.000Z`);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  return Math.max(0, Math.floor((todayUtc - date.getTime()) / MS_PER_DAY));
}

function gradeForScore(score: number): FlowDataQualityGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";

  return "D";
}

function hasFullOhlc(row: DailyFlowDetail) {
  return (
    typeof row.open === "number" &&
    Number.isFinite(row.open) &&
    typeof row.high === "number" &&
    Number.isFinite(row.high) &&
    typeof row.low === "number" &&
    Number.isFinite(row.low) &&
    typeof row.close === "number" &&
    Number.isFinite(row.close)
  );
}

function hasValidVolume(row: DailyFlowDetail) {
  return (
    typeof row.volume === "number" &&
    Number.isFinite(row.volume) &&
    row.volume > 0
  );
}

export function evaluateFlowDataQuality(flows: CapitalFlows): Pick<
  CapitalFlows,
  | "flowDataQualityScore"
  | "flowDataQualityGrade"
  | "flowDataQualityReasons"
  | "flowDataQualityInputs"
> {
  let score = 100;
  const reasons: string[] = [];
  const recentDailyFlow = flows.recentDailyFlow ?? [];
  const rawProviderLatestDate =
    typeof flows.rawProviderPayloadSummary?.latestDate === "string"
      ? flows.rawProviderPayloadSummary.latestDate
      : undefined;
  const latestDate = rawProviderLatestDate ?? flows.flowDataUpdatedAt;
  const providerFreshnessDays = daysSince(latestDate);
  const archiveAgeDays =
    flows.archiveStatus === "ARCHIVE_HIT" ? daysSince(flows.flowDataUpdatedAt) : null;
  const isArchive = flows.archiveStatus === "ARCHIVE_HIT";
  const isCompositeProxy =
    flows.capitalFlowDataSource === "YFINANCE_COMPOSITE_PROXY" ||
    flows.providerUsed === "YFINANCE_COMPOSITE_PROXY";
  const isLiveProvider =
    flows.capitalFlowQuality === "REAL_PROVIDER" && !isArchive;
  const hasFullOHLCV =
    recentDailyFlow.length > 0 &&
    recentDailyFlow.every((row) => hasFullOhlc(row) && hasValidVolume(row));
  const hasVolume =
    recentDailyFlow.length > 0 && recentDailyFlow.every(hasValidVolume);
  const hasOhlc =
    recentDailyFlow.length > 0 && recentDailyFlow.every(hasFullOhlc);

  if (isCompositeProxy) {
    score -= 20;
    reasons.push("COMPOSITE_PROXY_USED");
  } else if (flows.capitalFlowDataSource === "YFINANCE_CHAIKIN") {
    score -= 25;
    reasons.push("YFINANCE_CHAIKIN_PROXY_USED");
  } else if (isArchive) {
    reasons.push("REAL_PROVIDER_DATA");
  } else if (isLiveProvider) {
    reasons.push("REAL_PROVIDER_DATA");
  } else if (!flows.providerUsed || !flows.capitalFlowDataSource) {
    score -= 10;
    reasons.push("MISSING_PROVIDER_METADATA");
  }

  if (providerFreshnessDays == null) {
    score -= 10;
    reasons.push("MISSING_FRESHNESS_DATE");
  } else if (providerFreshnessDays <= 3) {
    reasons.push("FRESHNESS_WITHIN_3_DAYS");
  } else if (providerFreshnessDays <= 7) {
    score -= 5;
    reasons.push("FRESHNESS_4_TO_7_DAYS");
  } else if (providerFreshnessDays <= 14) {
    score -= 15;
    reasons.push("FRESHNESS_8_TO_14_DAYS");
  } else {
    score -= 30;
    reasons.push("FRESHNESS_OVER_14_DAYS");
  }

  if (recentDailyFlow.length >= EXPECTED_MINIMUM_DAILY_FLOW_COUNT) {
    reasons.push("RECENT_DAILY_FLOW_COUNT_OK");
  } else if (recentDailyFlow.length >= 15) {
    score -= 10;
    reasons.push("RECENT_DAILY_FLOW_COUNT_PARTIAL");
  } else {
    score -= 25;
    reasons.push("RECENT_DAILY_FLOW_COUNT_LOW");
  }

  if (!hasVolume) {
    score -= 25;
    reasons.push("MISSING_VOLUME");
  }

  if (!hasOhlc) {
    score -= 30;
    reasons.push("MISSING_OHLC_FIELDS");
  }

  if (isArchive && providerFreshnessDays != null && providerFreshnessDays <= 3) {
    reasons.push("ARCHIVE_HIT_FRESH");
  }

  if (isArchive && archiveAgeDays != null && archiveAgeDays > 7) {
    score -= 10;
    reasons.push("ARCHIVE_AGE_OVER_7_DAYS");
  }

  const providerErrorCount = flows.providerErrors?.length ?? 0;
  if (providerErrorCount > 2) {
    score -= 10;
    reasons.push("PROVIDER_ERRORS_GT_2");
  } else if (providerErrorCount > 0) {
    score -= 5;
    reasons.push("PROVIDER_ERRORS_PRESENT");
  }

  const finalScore = clamp(Math.round(score), 0, 100);
  const inputs: FlowDataQualityInputs = {
    providerUsed: flows.providerUsed,
    capitalFlowDataSource: flows.capitalFlowDataSource,
    capitalFlowQuality: flows.capitalFlowQuality,
    providerEndpointType: flows.providerEndpointType,
    archiveStatus: flows.archiveStatus,
    archiveHitProvider: flows.archiveHitProvider,
    flowDataUpdatedAt: flows.flowDataUpdatedAt,
    rawProviderLatestDate,
    providerFreshnessDays,
    archiveAgeDays,
    isArchive,
    isLiveProvider,
    isCompositeProxy,
    hasFullOHLCV,
    hasVolume,
    recentDailyFlowCount: recentDailyFlow.length,
    expectedMinimumDailyFlowCount: EXPECTED_MINIMUM_DAILY_FLOW_COUNT,
  };

  return {
    flowDataQualityScore: finalScore,
    flowDataQualityGrade: gradeForScore(finalScore),
    flowDataQualityReasons: reasons,
    flowDataQualityInputs: inputs,
  };
}
