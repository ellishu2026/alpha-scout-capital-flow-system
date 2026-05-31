import "server-only";

import {
  getMockCandidateFallback,
  getMockFinancialFallback,
} from "@/data/mockSnapshot";
import type {
  FinancialDataSource,
  FinancialPeriodType,
  FyMinusQ3YtdCandidates,
  PreviousQuarterMethod,
  PreviousQuarterSearch,
  PreviousQuarterSelectedPeriods,
  SelectedFinancialPeriod,
  SelectedFinancialPeriods,
} from "@/types/stock";

type SecTickerMapEntry = {
  cik_str: number;
  ticker: string;
  title: string;
};

type SecFactUnit = {
  start?: string;
  form?: string;
  fp?: string;
  filed?: string;
  end?: string;
  frame?: string;
  val?: number;
};

type TaggedSecFactUnit = SecFactUnit & {
  tag: string;
};

type SecFact = {
  units?: Record<string, SecFactUnit[]>;
};

type CompanyFacts = {
  facts?: {
    ["us-gaap"]?: Record<string, SecFact>;
  };
};

export type FinancialSnapshot = {
  marginScore: number;
  fcfScore: number;
  marginChange: number | null;
  fcf: number;
  fcfQoqChange: number | null;
  cashFlowChangeRatio: number | null;
  financialDataSource: FinancialDataSource;
  financialUpdatedAt?: string;
  currentMargin?: number | null;
  previousMargin?: number | null;
  previousFcf?: number | null;
  financialError?: string;
  selectedFinancialPeriods?: SelectedFinancialPeriods;
  staleDataRejected?: boolean;
  financialPeriodType?: FinancialPeriodType;
  currentQuarterFcf?: number | null;
  previousQuarterFcf?: number | null;
  secSelectedPeriodEnd?: string | null;
  secSelectedPeriodFiled?: string | null;
  secNormalizationNote?: string;
  fcfQoqRaw?: number | null;
  fcfQoqScoreInput?: number | null;
  marginChangeRaw?: number | null;
  marginChangeScoreInput?: number | null;
  financialScoreNote?: string;
  capexMissingFresh?: boolean;
  availableCapexCandidateTags?: string[];
  previousQuarterMethod?: PreviousQuarterMethod;
  previousQuarterSearch?: PreviousQuarterSearch;
  previousQuarterSelectedPeriods?: PreviousQuarterSelectedPeriods;
  fyMinusQ3YtdCandidates?: FyMinusQ3YtdCandidates;
};

const secTickerMapUrl = "https://www.sec.gov/files/company_tickers.json";
const secCompanyFactsBaseUrl = "https://data.sec.gov/api/xbrl/companyfacts";
const etfLikeTickers = new Set(["SOXL", "SMH"]);
const quarterLikePeriods = new Set(["Q1", "Q2", "Q3", "Q4", "FY"]);
const staleDataWindowMonths = 24;
const closePeriodWindowMs = 45 * 24 * 60 * 60 * 1000;
const lowFcfBaseThreshold = 100_000_000;
const staticTickerCikMap: Record<string, string> = {
  MSFT: "789019",
  GOOGL: "1652044",
  GOOG: "1652044",
  NVDA: "1045810",
  AMD: "2488",
  CRWD: "1535527",
  ADBE: "796343",
  SHOP: "1594805",
  NOW: "1373715",
  APP: "1751008",
  ANET: "1596532",
  LLY: "59478",
  VRT: "1674101",
  RKLB: "1819994",
  IONQ: "1824920",
  ASML: "937966",
  FICO: "814547",
  MELI: "1099590",
  URI: "1067701",
  ORCL: "1341439",
  META: "1326801",
  TSLA: "1318605",
  AMZN: "1018724",
  NFLX: "1065280",
  CRM: "1108524",
  PANW: "1327567",
  DDOG: "1561550",
  SNOW: "1640147",
  INTU: "896878",
  LRCX: "707549",
  KLAC: "319201",
  MPWR: "1280452",
  MU: "723125",
  AMAT: "6951",
  UNH: "731766",
  COIN: "1679788",
  MSTR: "1050446",
  BLK: "1364742",
  MA: "1141391",
  V: "1403161",
  SPGI: "64040",
  AON: "315293",
  ROP: "882835",
  CPRT: "900075",
  AXON: "1069183",
  DELL: "1571996",
  HPE: "1645590",
  WDC: "106040",
  STX: "1137789",
  CAT: "18230",
  DE: "315189",
  GE: "40545",
  CEG: "1868275",
  ETN: "1551182",
  PH: "76334",
  RCL: "884887",
  TTD: "1671933",
  NET: "1477333",
  MDB: "1441816",
  HUBS: "1404655",
  TEAM: "1650372",
  VRTX: "875320",
  REGN: "872589",
  ISRG: "1035267",
  BKNG: "1075531",
  MTD: "1037646",
  TDG: "1260221",
  AZO: "866787",
  CMG: "1058090",
  WING: "1636222",
  CAVA: "1600620",
  HIMS: "1773751",
};

const revenueTags = [
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "SalesRevenueNet",
];
const operatingIncomeTags = ["OperatingIncomeLoss"];
const netIncomeTags = ["NetIncomeLoss", "ProfitLoss"];
const operatingCashFlowTags = [
  "NetCashProvidedByUsedInOperatingActivities",
  "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
];
const capexTags = [
  "PaymentsToAcquirePropertyPlantAndEquipment",
  "PaymentsToAcquireProductiveAssets",
  "CapitalExpendituresIncurredButNotYetPaid",
  "PaymentsForProceedsFromProductiveAssets",
  "PaymentsToAcquireOtherPropertyPlantAndEquipment",
  "PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets",
  "PaymentsToAcquirePropertyAndEquipment",
  "PaymentsToAcquireBuildingsAndImprovements",
  "PaymentsToAcquireMachineryAndEquipment",
  "PurchasesOfPropertyAndEquipment",
  "PurchaseOfPropertyAndEquipment",
  "AdditionsToPropertyPlantAndEquipment",
  "CapitalExpenditures",
  "CapitalExpendituresAdditions",
  "PaymentsToAcquireBusinessesNetOfCashAcquiredAndPurchasesOfIntangibleAssets",
];

let tickerMapCache: Map<string, string> | null = null;
const companyFactsCache = new Map<string, CompanyFacts>();

function getSecUserAgent() {
  return (
    process.env.SEC_USER_AGENT ??
    "AlphaScout Capital Flow System by Ellis contact ellis@example.com"
  );
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function padCik(cik: string | number) {
  return String(cik).padStart(10, "0");
}

function isQuarterLikeFact(fact: SecFactUnit) {
  return (
    (fact.form === "10-Q" || fact.form === "10-K") &&
    typeof fact.fp === "string" &&
    quarterLikePeriods.has(fact.fp) &&
    typeof fact.filed === "string" &&
    typeof fact.end === "string" &&
    typeof fact.val === "number" &&
    Number.isFinite(fact.val)
  );
}

function factSortTime(fact: SecFactUnit) {
  return new Date(fact.end ?? fact.filed ?? 0).getTime();
}

function filedSortTime(fact: SecFactUnit) {
  return new Date(fact.filed ?? fact.end ?? 0).getTime();
}

function dayDiff(start: string, end: string) {
  return Math.round(
    (new Date(end).getTime() - new Date(start).getTime()) /
      (24 * 60 * 60 * 1000),
  );
}

function classifyFactPeriod(fact: SecFactUnit): FinancialPeriodType {
  if (!fact.start || !fact.end) {
    return "UNKNOWN";
  }

  const durationDays = dayDiff(fact.start, fact.end);

  if (durationDays >= 70 && durationDays <= 120) {
    return "QUARTER";
  }

  if (durationDays >= 150 && durationDays <= 300) {
    return "YTD_NORMALIZED";
  }

  if (durationDays >= 330 && durationDays <= 400) {
    return "ANNUAL";
  }

  return "UNKNOWN";
}

function freshnessCutoffTime(now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - staleDataWindowMonths);

  return cutoff.getTime();
}

function isFreshFact(fact: SecFactUnit, now = new Date()) {
  if (!fact.end) {
    return false;
  }

  return factSortTime(fact) >= freshnessCutoffTime(now);
}

function toDebugFact(
  fact: TaggedSecFactUnit | null | undefined,
): SelectedFinancialPeriod | undefined {
  if (!fact) {
    return undefined;
  }

  return {
    tag: fact.tag,
    start: fact.start,
    end: fact.end,
    filed: fact.filed,
    form: fact.form,
    fp: fact.fp,
    frame: fact.frame,
    val: fact.val,
    periodType: classifyFactPeriod(fact),
  };
}

function collectUsdFacts(companyFacts: CompanyFacts, tags: string[]) {
  const usGaap = companyFacts.facts?.["us-gaap"];

  if (!usGaap) {
    return [];
  }

  const seen = new Set<string>();
  const facts: TaggedSecFactUnit[] = [];

  for (const tag of tags) {
    const units = usGaap[tag]?.units;
    const usdFacts = units?.USD;

    if (usdFacts?.length) {
      for (const fact of usdFacts) {
        if (!isQuarterLikeFact(fact)) {
          continue;
        }

        const key = [
          tag,
          fact.start,
          fact.form,
          fact.fp,
          fact.end,
          fact.filed,
          fact.frame,
          fact.val,
        ].join("|");

        if (!seen.has(key)) {
          seen.add(key);
          facts.push({ ...fact, tag });
        }
      }
    }
  }

  return facts.sort(
    (a, b) =>
      factSortTime(b) - factSortTime(a) ||
      filedSortTime(b) - filedSortTime(a),
  );
}

function collectFreshFacts(companyFacts: CompanyFacts, tags: string[]) {
  const allFacts = collectUsdFacts(companyFacts, tags);
  const facts = allFacts.filter((fact) => isFreshFact(fact));

  return {
    facts,
    staleDataRejected: allFacts.length > 0 && facts.length === 0,
  };
}

function uniqueTags(tags: string[]) {
  return [...new Set(tags)];
}

function rankCapexTag(tag: string) {
  const lower = tag.toLowerCase();

  if (lower.includes("paymentstoacquire")) {
    return 0;
  }

  if (lower.includes("purchasesofproperty")) {
    return 1;
  }

  if (lower.includes("purchaseofproperty")) {
    return 1;
  }

  if (lower.includes("capitalexpenditures")) {
    return 2;
  }

  if (lower.includes("additionstoproperty")) {
    return 3;
  }

  if (lower.includes("productiveassets")) {
    return 4;
  }

  return 5;
}

function isLikelyCapexTag(tag: string) {
  const lower = tag.toLowerCase();
  const hasCapexPhrase =
    (lower.includes("acquire") &&
      (lower.includes("property") ||
        lower.includes("plant") ||
        lower.includes("equipment"))) ||
    lower.includes("propertyplantandequipment") ||
    lower.includes("productiveassets") ||
    lower.includes("capitalexpenditures") ||
    lower.includes("purchasesofproperty") ||
    lower.includes("purchaseofproperty") ||
    lower.includes("additionstoproperty");

  if (!hasCapexPhrase) {
    return false;
  }

  const hasOutflowOrCapexTerm =
    lower.includes("payment") ||
    lower.includes("purchase") ||
    lower.includes("acquire") ||
    lower.includes("capitalexpenditures") ||
    lower.includes("additionsto");
  const clearlyNotCapex =
    lower.includes("accumulated") ||
    lower.includes("depreciation") ||
    lower.includes("amortization") ||
    lower.includes("impairment") ||
    lower.includes("gain") ||
    lower.includes("loss") ||
    lower.includes("proceedsfromsale") ||
    lower.includes("salesofproperty") ||
    (!hasOutflowOrCapexTerm &&
      (lower.endsWith("assets") ||
        lower.endsWith("assetsnet") ||
        lower.endsWith("assetsgross") ||
        lower.endsWith("assetsexcluding")));

  return !clearlyNotCapex;
}

function findLikelyCapexTags(companyFacts: CompanyFacts) {
  const usGaap = companyFacts.facts?.["us-gaap"];

  if (!usGaap) {
    return uniqueTags(capexTags);
  }

  const dynamicTags = Object.keys(usGaap).filter((tag) => {
    const hasUsdFacts = Boolean(usGaap[tag]?.units?.USD?.length);

    return hasUsdFacts && isLikelyCapexTag(tag);
  });

  return uniqueTags([...capexTags, ...dynamicTags]).sort(
    (a, b) => rankCapexTag(a) - rankCapexTag(b) || a.localeCompare(b),
  );
}

function summarizeFreshnessByTag(companyFacts: CompanyFacts, tags: string[]) {
  return tags.map((tag) => {
    const facts = collectUsdFacts(companyFacts, [tag]);
    const freshFacts = facts.filter((fact) => isFreshFact(fact));
    const latest = facts[0];

    return {
      tag,
      total: facts.length,
      fresh: freshFacts.length,
      latestEnd: latest?.end,
      latestFiled: latest?.filed,
      latestVal: latest?.val,
    };
  });
}

function areClosePeriods(a: SecFactUnit, b: SecFactUnit) {
  if (!a.end || !b.end) {
    return false;
  }

  return Math.abs(factSortTime(a) - factSortTime(b)) <= closePeriodWindowMs;
}

function compatiblePreviousPeriod(
  current: SecFactUnit,
  previous: SecFactUnit,
) {
  if (current.fp === "FY") {
    return previous.fp === "FY";
  }

  return previous.fp !== "FY";
}

function findCloseFact<T extends SecFactUnit>(
  facts: T[],
  target: SecFactUnit | undefined,
) {
  if (!target) {
    return null;
  }

  const exact = facts.find((fact) => fact.end === target.end);

  if (exact) {
    return exact;
  }

  return (
    facts
      .filter((fact) => areClosePeriods(fact, target))
      .sort(
        (a, b) =>
          Math.abs(factSortTime(a) - factSortTime(target)) -
            Math.abs(factSortTime(b) - factSortTime(target)) ||
          filedSortTime(b) - filedSortTime(a),
      )[0] ?? null
  );
}

function isSameFiscalAccumulation(
  current: SecFactUnit,
  previous: SecFactUnit,
) {
  return Boolean(
    current.start &&
      previous.start &&
      current.start === previous.start &&
      factSortTime(previous) < factSortTime(current),
  );
}

function findPreviousYtdFact(
  current: TaggedSecFactUnit,
  facts: TaggedSecFactUnit[],
) {
  return (
    facts.find(
      (fact) =>
        isSameFiscalAccumulation(current, fact) &&
        classifyFactPeriod(fact) !== "ANNUAL",
    ) ?? null
  );
}

function findPriorQ3YtdFact(
  annualFact: TaggedSecFactUnit,
  facts: TaggedSecFactUnit[],
) {
  return (
    facts.find(
      (fact) =>
        isSameFiscalAccumulation(annualFact, fact) &&
        fact.fp === "Q3" &&
        classifyFactPeriod(fact) === "YTD_NORMALIZED",
    ) ?? null
  );
}

type NormalizedFcfResult = {
  fcf: number;
  periodType: FinancialPeriodType;
  method: PreviousQuarterMethod;
  currentQuarterFcf: number | null;
  operatingCashFlow: TaggedSecFactUnit;
  capex: TaggedSecFactUnit;
  previousOperatingCashFlow?: TaggedSecFactUnit;
  previousCapex?: TaggedSecFactUnit;
  note: string;
};

function normalizeFcfForAnchor(
  operatingCashFlow: TaggedSecFactUnit,
  operatingCashFlowFacts: TaggedSecFactUnit[],
  capexFacts: TaggedSecFactUnit[],
  allowAnnualFallback: boolean,
): NormalizedFcfResult | null {
  const capex = findCloseFact(capexFacts, operatingCashFlow);

  if (!capex) {
    return null;
  }

  const ocfPeriodType = classifyFactPeriod(operatingCashFlow);
  const capexPeriodType = classifyFactPeriod(capex);

  if (ocfPeriodType === "QUARTER" && capexPeriodType === "QUARTER") {
    const fcf = operatingCashFlow.val! - Math.abs(capex.val!);

    return {
      fcf,
      periodType: "QUARTER",
      method: "DIRECT_QUARTER",
      currentQuarterFcf: fcf,
      operatingCashFlow,
      capex,
      note: "Used true quarter SEC operating cash flow and CapEx.",
    };
  }

  if (
    ocfPeriodType === "YTD_NORMALIZED" &&
    capexPeriodType === "YTD_NORMALIZED"
  ) {
    const previousOperatingCashFlow = findPreviousYtdFact(
      operatingCashFlow,
      operatingCashFlowFacts,
    );
    const previousCapex = previousOperatingCashFlow
      ? findCloseFact(capexFacts, previousOperatingCashFlow)
      : null;

    if (previousOperatingCashFlow && previousCapex) {
      const currentQuarterOcf =
        operatingCashFlow.val! - previousOperatingCashFlow.val!;
      const currentQuarterCapex = Math.abs(capex.val! - previousCapex.val!);
      const fcf = currentQuarterOcf - currentQuarterCapex;

      return {
        fcf,
        periodType: "YTD_NORMALIZED",
        method: "YTD_DIFF",
        currentQuarterFcf: fcf,
        operatingCashFlow,
        capex,
        previousOperatingCashFlow,
        previousCapex,
        note: "Normalized YTD SEC cash flow by subtracting the prior YTD period.",
      };
    }

    if (operatingCashFlow.fp === "Q1" && capex.fp === "Q1") {
      const fcf = operatingCashFlow.val! - Math.abs(capex.val!);

      return {
        fcf,
        periodType: "QUARTER",
        method: "DIRECT_QUARTER",
        currentQuarterFcf: fcf,
        operatingCashFlow,
        capex,
        note: "Treated Q1 YTD SEC cash flow as a single quarter.",
      };
    }

    return null;
  }

  if (ocfPeriodType === "ANNUAL" && capexPeriodType === "ANNUAL") {
    const priorQ3OperatingCashFlow = findPriorQ3YtdFact(
      operatingCashFlow,
      operatingCashFlowFacts,
    );
    const priorQ3Capex = priorQ3OperatingCashFlow
      ? findCloseFact(capexFacts, priorQ3OperatingCashFlow)
      : null;

    if (priorQ3OperatingCashFlow && priorQ3Capex) {
      const q4Ocf = operatingCashFlow.val! - priorQ3OperatingCashFlow.val!;
      const q4Capex = Math.abs(capex.val! - priorQ3Capex.val!);
      const fcf = q4Ocf - q4Capex;

      return {
        fcf,
        periodType: "YTD_NORMALIZED",
        method: "FY_MINUS_Q3_YTD",
        currentQuarterFcf: fcf,
        operatingCashFlow,
        capex,
        previousOperatingCashFlow: priorQ3OperatingCashFlow,
        previousCapex: priorQ3Capex,
        note: "Estimated Q4 SEC cash flow by subtracting Q3 YTD from FY.",
      };
    }

    if (allowAnnualFallback) {
      const fcf = operatingCashFlow.val! - Math.abs(capex.val!);

      return {
        fcf,
        periodType: "ANNUAL",
        method: "UNAVAILABLE",
        currentQuarterFcf: null,
        operatingCashFlow,
        capex,
        note: "Used annual SEC FCF as conservative fallback; QoQ disabled.",
      };
    }
  }

  return null;
}

function findCurrentNormalizedFcf(
  operatingCashFlowFacts: TaggedSecFactUnit[],
  capexFacts: TaggedSecFactUnit[],
) {
  for (const operatingCashFlow of operatingCashFlowFacts) {
    const normalized = normalizeFcfForAnchor(
      operatingCashFlow,
      operatingCashFlowFacts,
      capexFacts,
      true,
    );

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function previousDay(date: string) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() - 1);

  return value;
}

function daysBetween(a: Date, b: Date) {
  return Math.abs(a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000);
}

function expectedPreviousQuarterEnd(current: NormalizedFcfResult) {
  if (!current.operatingCashFlow.start) {
    return null;
  }

  return previousDay(current.operatingCashFlow.start);
}

type PreviousQuarterRecovery = {
  result: NormalizedFcfResult | null;
  search: PreviousQuarterSearch;
  fyMinusQ3YtdCandidates?: FyMinusQ3YtdCandidates;
};

function summarizeFacts(facts: TaggedSecFactUnit[]) {
  return facts
    .map((fact) => toDebugFact(fact))
    .filter((fact): fact is SelectedFinancialPeriod => Boolean(fact));
}

function sameFiscalStart(a: SecFactUnit, b: SecFactUnit) {
  if (!a.start || !b.start) {
    return true;
  }

  return a.start === b.start;
}

function isQ3YtdForFiscalYear(
  fyFact: TaggedSecFactUnit,
  q3Fact: TaggedSecFactUnit,
) {
  if (!fyFact.end || !q3Fact.end || factSortTime(q3Fact) >= factSortTime(fyFact)) {
    return false;
  }

  const daysBeforeFiscalYearEnd = daysBetween(
    new Date(q3Fact.end),
    new Date(fyFact.end),
  );

  return (
    daysBeforeFiscalYearEnd >= 70 &&
    daysBeforeFiscalYearEnd <= 120 &&
    classifyFactPeriod(q3Fact) === "YTD_NORMALIZED" &&
    sameFiscalStart(fyFact, q3Fact)
  );
}

function matchingFactForAnchor(
  facts: TaggedSecFactUnit[],
  anchor: TaggedSecFactUnit,
  preferredTag?: string,
) {
  const sameTagFacts = preferredTag
    ? facts.filter((fact) => fact.tag === preferredTag)
    : [];
  const sameTagMatch = findCloseFact(sameTagFacts, anchor);

  return sameTagMatch ?? findCloseFact(facts, anchor);
}

function recoverFyMinusQ3YtdPreviousQuarter(
  expectedEnd: Date,
  operatingCashFlowFacts: TaggedSecFactUnit[],
  capexFacts: TaggedSecFactUnit[],
) {
  const fyOcfCandidates = operatingCashFlowFacts.filter(
    (fact) =>
      classifyFactPeriod(fact) === "ANNUAL" &&
      Boolean(fact.end) &&
      daysBetween(new Date(fact.end!), expectedEnd) <= 45,
  );
  const fyCapexCandidates = capexFacts.filter(
    (fact) =>
      classifyFactPeriod(fact) === "ANNUAL" &&
      Boolean(fact.end) &&
      daysBetween(new Date(fact.end!), expectedEnd) <= 45,
  );
  const q3YtdOcfCandidates = operatingCashFlowFacts.filter((fact) =>
    fyOcfCandidates.some((fyFact) => isQ3YtdForFiscalYear(fyFact, fact)),
  );
  const q3YtdCapexCandidates = capexFacts.filter((fact) =>
    fyCapexCandidates.some((fyFact) => isQ3YtdForFiscalYear(fyFact, fact)),
  );
  const diagnostics: FyMinusQ3YtdCandidates = {
    fyOcfCandidates: summarizeFacts(fyOcfCandidates),
    fyCapexCandidates: summarizeFacts(fyCapexCandidates),
    q3YtdOcfCandidates: summarizeFacts(q3YtdOcfCandidates),
    q3YtdCapexCandidates: summarizeFacts(q3YtdCapexCandidates),
    rejectionReasons: [],
  };

  if (!fyOcfCandidates.length) {
    diagnostics.rejectionReasons.push("NO_FY_OCF_CANDIDATE");
  }

  if (!fyCapexCandidates.length) {
    diagnostics.rejectionReasons.push("NO_FY_CAPEX_CANDIDATE");
  }

  if (!q3YtdOcfCandidates.length) {
    diagnostics.rejectionReasons.push("NO_Q3_YTD_OCF_CANDIDATE");
  }

  if (!q3YtdCapexCandidates.length) {
    diagnostics.rejectionReasons.push("NO_Q3_YTD_CAPEX_CANDIDATE");
  }

  for (const fyOcf of fyOcfCandidates) {
    const fyCapex = matchingFactForAnchor(capexFacts, fyOcf);

    if (!fyCapex || classifyFactPeriod(fyCapex) !== "ANNUAL") {
      diagnostics.rejectionReasons.push(`NO_MATCHING_FY_CAPEX:${fyOcf.tag}`);
      continue;
    }

    const q3YtdOcf =
      q3YtdOcfCandidates.find(
        (fact) => fact.tag === fyOcf.tag && isQ3YtdForFiscalYear(fyOcf, fact),
      ) ??
      q3YtdOcfCandidates.find((fact) => isQ3YtdForFiscalYear(fyOcf, fact));

    if (!q3YtdOcf) {
      diagnostics.rejectionReasons.push(`NO_MATCHING_Q3_YTD_OCF:${fyOcf.tag}`);
      continue;
    }

    const q3YtdCapex = matchingFactForAnchor(
      q3YtdCapexCandidates,
      q3YtdOcf,
      fyCapex.tag,
    );

    if (!q3YtdCapex || !isQ3YtdForFiscalYear(fyCapex, q3YtdCapex)) {
      diagnostics.rejectionReasons.push(`NO_MATCHING_Q3_YTD_CAPEX:${fyCapex.tag}`);
      continue;
    }

    const q4Ocf = fyOcf.val! - q3YtdOcf.val!;
    const q4Capex = Math.abs(fyCapex.val! - q3YtdCapex.val!);
    const fcf = q4Ocf - q4Capex;

    return {
      result: {
        fcf,
        periodType: "YTD_NORMALIZED" as const,
        method: "FY_MINUS_Q3_YTD" as const,
        currentQuarterFcf: fcf,
        operatingCashFlow: fyOcf,
        capex: fyCapex,
        previousOperatingCashFlow: q3YtdOcf,
        previousCapex: q3YtdCapex,
        note: "Estimated prior Q4 SEC cash flow by subtracting Q3 YTD from FY.",
      },
      diagnostics,
    };
  }

  return {
    result: null,
    diagnostics,
  };
}

function normalizeFcfAtExpectedEnd(
  expectedEnd: Date,
  method: PreviousQuarterMethod,
  operatingCashFlowFacts: TaggedSecFactUnit[],
  capexFacts: TaggedSecFactUnit[],
) {
  for (const operatingCashFlow of operatingCashFlowFacts.filter((fact) => {
    if (!fact.end) {
      return false;
    }

    return daysBetween(new Date(fact.end), expectedEnd) <= 45;
  })) {
    const normalized = normalizeFcfForAnchor(
      operatingCashFlow,
      operatingCashFlowFacts,
      capexFacts,
      false,
    );

    if (normalized?.method === method) {
      return normalized;
    }
  }

  return null;
}

function findPreviousQuarterFcf(
  current: NormalizedFcfResult,
  operatingCashFlowFacts: TaggedSecFactUnit[],
  capexFacts: TaggedSecFactUnit[],
): PreviousQuarterRecovery {
  const search: PreviousQuarterSearch = {
    triedDirectQuarter: false,
    triedYtdDiff: false,
    triedFyMinusQ3Ytd: false,
  };

  if (current.periodType === "ANNUAL") {
    return {
      result: null,
      search: {
        ...search,
        failureReason: "CURRENT_PERIOD_ANNUAL",
      },
    };
  }

  if (current.method === "YTD_DIFF" && current.previousOperatingCashFlow) {
    search.triedYtdDiff = true;

    const normalized = normalizeFcfForAnchor(
      current.previousOperatingCashFlow,
      operatingCashFlowFacts,
      capexFacts,
      false,
    );

    if (
      normalized?.method === "YTD_DIFF" ||
      normalized?.method === "DIRECT_QUARTER"
    ) {
      return {
        result: normalized,
        search,
      };
    }
  }

  if (current.method === "FY_MINUS_Q3_YTD" && current.previousOperatingCashFlow) {
    search.triedYtdDiff = true;

    const normalized = normalizeFcfForAnchor(
      current.previousOperatingCashFlow,
      operatingCashFlowFacts,
      capexFacts,
      false,
    );

    if (normalized?.method === "YTD_DIFF") {
      return {
        result: normalized,
        search,
      };
    }
  }

  const expectedEnd = expectedPreviousQuarterEnd(current);

  if (!expectedEnd) {
    return {
      result: null,
      search: {
        ...search,
        failureReason: "CURRENT_PERIOD_START_MISSING",
      },
    };
  }

  search.triedDirectQuarter = true;
  const directQuarter = normalizeFcfAtExpectedEnd(
    expectedEnd,
    "DIRECT_QUARTER",
    operatingCashFlowFacts,
    capexFacts,
  );

  if (directQuarter) {
    return {
      result: directQuarter,
      search,
    };
  }

  search.triedFyMinusQ3Ytd = true;
  const explicitFyMinusQ3Ytd = recoverFyMinusQ3YtdPreviousQuarter(
    expectedEnd,
    operatingCashFlowFacts,
    capexFacts,
  );

  if (explicitFyMinusQ3Ytd.result) {
    return {
      result: explicitFyMinusQ3Ytd.result,
      search,
      fyMinusQ3YtdCandidates: explicitFyMinusQ3Ytd.diagnostics,
    };
  }

  return {
    result: null,
    search: {
      ...search,
      failureReason: "NO_COMPATIBLE_PREVIOUS_QUARTER_FCF",
    },
    fyMinusQ3YtdCandidates: explicitFyMinusQ3Ytd.diagnostics,
  };
}

function findMarginPair(
  revenueFacts: TaggedSecFactUnit[],
  operatingIncomeFacts: TaggedSecFactUnit[],
  netIncomeFacts: TaggedSecFactUnit[],
) {
  for (const revenue of revenueFacts) {
    const income =
      findCloseFact(operatingIncomeFacts, revenue) ??
      findCloseFact(netIncomeFacts, revenue);

    if (
      income &&
      revenue.val &&
      classifyFactPeriod(revenue) !== "UNKNOWN" &&
      classifyFactPeriod(revenue) === classifyFactPeriod(income)
    ) {
      return { revenue, income };
    }
  }

  return null;
}

function findPreviousMarginPair(
  currentRevenue: TaggedSecFactUnit,
  revenueFacts: TaggedSecFactUnit[],
  operatingIncomeFacts: TaggedSecFactUnit[],
  netIncomeFacts: TaggedSecFactUnit[],
) {
  const olderRevenueFacts = revenueFacts.filter(
    (fact) =>
      factSortTime(fact) < factSortTime(currentRevenue) &&
      compatiblePreviousPeriod(currentRevenue, fact),
  );

  return findMarginPair(olderRevenueFacts, operatingIncomeFacts, netIncomeFacts);
}

function latestFiledDate(facts: Array<SecFactUnit | null | undefined>) {
  return facts
    .filter((fact): fact is SecFactUnit => Boolean(fact?.filed))
    .sort(
      (a, b) =>
        filedSortTime(b) - filedSortTime(a) ||
        factSortTime(b) - factSortTime(a),
    )[0]?.filed;
}

function anyStaleDataRejected(...states: Array<{ staleDataRejected: boolean }>) {
  return states.some((state) => state.staleDataRejected);
}

function percentChange(current: number | null, previous: number | null) {
  if (
    current == null ||
    previous == null ||
    previous === 0 ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous)
  ) {
    return null;
  }

  return ((current - previous) / Math.abs(previous)) * 100;
}

function clampFinancialChange(value: number | null, min: number, max: number) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(max, Math.max(min, value));
}

function calculateStableFcfScore(
  currentFcf: number,
  previousFcf: number | null,
  fcfQoqChange: number | null,
  periodType: FinancialPeriodType,
) {
  const scoreInput = clampFinancialChange(fcfQoqChange, -100, 100);
  const notes: string[] = [];

  if (periodType === "ANNUAL") {
    notes.push("Annual SEC FCF capped at conservative score.");

    return {
      score: currentFcf > 0 ? 72 : 45,
      scoreInput: null,
      notes,
    };
  }

  if (fcfQoqChange !== scoreInput) {
    notes.push("FCF QoQ capped to -100%/+100% for scoring.");
  }

  if (currentFcf <= 0) {
    return {
      score: 45,
      scoreInput,
      notes,
    };
  }

  if (previousFcf == null) {
    notes.push("FCF QoQ unavailable; scored from positive current FCF.");

    return {
      score: 72,
      scoreInput,
      notes,
    };
  }

  if (Math.abs(previousFcf) < lowFcfBaseThreshold) {
    notes.push("Low prior FCF base capped upside score.");

    return {
      score: currentFcf > 0 ? 78 : 45,
      scoreInput,
      notes,
    };
  }

  if (previousFcf <= 0) {
    notes.push("Negative-to-positive FCF turnaround scored conservatively.");

    return {
      score:
        currentFcf > 1_000_000_000 ? 82 : currentFcf > 100_000_000 ? 78 : 72,
      scoreInput,
      notes,
    };
  }

  if (scoreInput == null) {
    return {
      score: 72,
      scoreInput,
      notes,
    };
  }

  if (scoreInput >= 50) {
    return { score: 90, scoreInput, notes };
  }

  if (scoreInput >= 20) {
    return { score: 84, scoreInput, notes };
  }

  if (scoreInput >= 10) {
    return { score: 80, scoreInput, notes };
  }

  if (scoreInput >= 0) {
    return { score: 75, scoreInput, notes };
  }

  if (scoreInput >= -20) {
    return { score: 65, scoreInput, notes };
  }

  return { score: 55, scoreInput, notes };
}

function calculateStableMarginScore(
  currentMargin: number | null,
  previousMargin: number | null,
  marginChange: number | null,
  periodType: FinancialPeriodType,
) {
  const scoreInput = clampFinancialChange(marginChange, -20, 20);
  const notes: string[] = [];

  if (marginChange !== scoreInput) {
    notes.push("Margin change capped to -20/+20 points for scoring.");
  }

  if (periodType === "ANNUAL") {
    notes.push("Annual SEC margin score capped.");
  }

  if (scoreInput == null) {
    return {
      score:
        currentMargin != null && Number.isFinite(currentMargin)
          ? periodType === "ANNUAL"
            ? 75
            : 70
          : 70,
      scoreInput,
      notes:
        previousMargin == null
          ? [...notes, "Margin comparison unavailable."]
          : notes,
    };
  }

  let score: number;

  if (scoreInput >= 5) {
    score = 90;
  } else if (scoreInput >= 2) {
    score = 82;
  } else if (scoreInput >= 0) {
    score = 75;
  } else if (scoreInput >= -2) {
    score = 65;
  } else if (scoreInput >= -5) {
    score = 55;
  } else {
    score = 45;
  }

  if (periodType === "ANNUAL") {
    score = Math.min(score, 75);
  }

  return { score, scoreInput, notes };
}

export function summarizeAvailableTags(companyFacts: CompanyFacts) {
  const usGaap = companyFacts.facts?.["us-gaap"];
  const likelyCapexTags = findLikelyCapexTags(companyFacts);

  if (!usGaap) {
    return {
      revenueTags: [],
      operatingIncomeTags: [],
      netIncomeTags: [],
      operatingCashFlowTags: [],
      capexTags: [],
      availableCapexCandidateTags: likelyCapexTags,
    };
  }

  const present = (tags: string[]) =>
    tags.filter((tag) => Boolean(usGaap[tag]?.units?.USD?.length));

  return {
    revenueTags: present(revenueTags),
    operatingIncomeTags: present(operatingIncomeTags),
    netIncomeTags: present(netIncomeTags),
    operatingCashFlowTags: present(operatingCashFlowTags),
    capexTags: present(likelyCapexTags),
    availableCapexCandidateTags: likelyCapexTags,
  };
}

function summarizeFreshness(companyFacts: CompanyFacts) {
  const summarize = (tags: string[]) => {
    const allFacts = collectUsdFacts(companyFacts, tags);
    const freshFacts = allFacts.filter((fact) => isFreshFact(fact));

    return {
      total: allFacts.length,
      fresh: freshFacts.length,
      latestEnd: allFacts[0]?.end,
      latestFiled: allFacts[0]?.filed,
    };
  };

  return {
    revenue: summarize(revenueTags),
    operatingIncome: summarize(operatingIncomeTags),
    netIncome: summarize(netIncomeTags),
    operatingCashFlow: summarize(operatingCashFlowTags),
    capex: summarize(findLikelyCapexTags(companyFacts)),
  };
}

export async function fetchSecTickerMap() {
  if (tickerMapCache) {
    return tickerMapCache;
  }

  const response = await fetch(secTickerMapUrl, {
    headers: {
      "User-Agent": getSecUserAgent(),
      Accept: "application/json",
    },
    next: {
      revalidate: 86_400,
    },
  });

  if (!response.ok) {
    throw new Error(`SEC ticker map request failed: ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, SecTickerMapEntry>;
  tickerMapCache = new Map(
    Object.values(payload).map((entry) => [
      normalizeTicker(entry.ticker),
      padCik(entry.cik_str),
    ]),
  );

  return tickerMapCache;
}

export async function getCikForTicker(ticker: string) {
  const normalizedTicker = normalizeTicker(ticker);
  const staticCik = staticTickerCikMap[normalizedTicker];

  if (staticCik) {
    return padCik(staticCik);
  }

  try {
    const tickerMap = await fetchSecTickerMap();

    return tickerMap.get(normalizedTicker) ?? null;
  } catch {
    return null;
  }
}

export async function fetchCompanyFacts(cik: string) {
  const paddedCik = padCik(cik);
  const cachedFacts = companyFactsCache.get(paddedCik);

  if (cachedFacts) {
    return cachedFacts;
  }

  const response = await fetch(
    `${secCompanyFactsBaseUrl}/CIK${paddedCik}.json`,
    {
      headers: {
        "User-Agent": getSecUserAgent(),
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`SEC CompanyFacts request failed: ${response.status}`);
  }

  const companyFacts = (await response.json()) as CompanyFacts;
  companyFactsCache.set(paddedCik, companyFacts);

  return companyFacts;
}

export function extractQuarterlyFinancials(
  companyFacts: CompanyFacts,
): FinancialSnapshot | null {
  const availableCapexCandidateTags = findLikelyCapexTags(companyFacts);
  const revenueState = collectFreshFacts(companyFacts, revenueTags);
  const operatingIncomeState = collectFreshFacts(
    companyFacts,
    operatingIncomeTags,
  );
  const netIncomeState = collectFreshFacts(companyFacts, netIncomeTags);
  const operatingCashFlowState = collectFreshFacts(
    companyFacts,
    operatingCashFlowTags,
  );
  const capexState = collectFreshFacts(companyFacts, availableCapexCandidateTags);
  const currentFcf = findCurrentNormalizedFcf(
    operatingCashFlowState.facts,
    capexState.facts,
  );

  if (!currentFcf) {
    return null;
  }

  const previousQuarterRecovery = findPreviousQuarterFcf(
    currentFcf,
    operatingCashFlowState.facts,
    capexState.facts,
  );
  const previousFcf = previousQuarterRecovery.result;
  const fcfQoqChange =
    currentFcf.periodType === "ANNUAL"
      ? null
      : percentChange(currentFcf.fcf, previousFcf?.fcf ?? null);
  const currentMarginPair = findMarginPair(
    revenueState.facts,
    operatingIncomeState.facts,
    netIncomeState.facts,
  );
  const previousMarginPair = currentMarginPair
    ? findPreviousMarginPair(
        currentMarginPair.revenue,
        revenueState.facts,
        operatingIncomeState.facts,
        netIncomeState.facts,
      )
    : null;
  const currentMargin =
    currentMarginPair?.income.val != null && currentMarginPair.revenue.val
      ? (currentMarginPair.income.val / currentMarginPair.revenue.val) * 100
      : null;
  const previousMargin =
    previousMarginPair?.income.val != null && previousMarginPair.revenue.val
      ? (previousMarginPair.income.val / previousMarginPair.revenue.val) * 100
      : null;

  const marginChange =
    currentMargin != null && previousMargin != null
      ? currentMargin - previousMargin
      : null;
  const stableFcfScore = calculateStableFcfScore(
    currentFcf.fcf,
    previousFcf?.fcf ?? null,
    fcfQoqChange,
    currentFcf.periodType,
  );
  const stableMarginScore = calculateStableMarginScore(
    currentMargin,
    previousMargin,
    marginChange,
    currentFcf.periodType,
  );
  const financialScoreNote = [
    ...stableFcfScore.notes,
    ...stableMarginScore.notes,
  ].join(" ");
  const selectedPeriods = {
    operatingCashFlow: toDebugFact(currentFcf.operatingCashFlow),
    capex: toDebugFact(currentFcf.capex),
    revenue: toDebugFact(currentMarginPair?.revenue),
    marginIncome: toDebugFact(currentMarginPair?.income),
    previousOperatingCashFlow: toDebugFact(
      previousFcf?.operatingCashFlow ?? currentFcf.previousOperatingCashFlow,
    ),
    previousCapex: toDebugFact(previousFcf?.capex ?? currentFcf.previousCapex),
  };

  return {
    marginScore: stableMarginScore.score,
    fcfScore: stableFcfScore.score,
    marginChange,
    fcf: currentFcf.fcf,
    fcfQoqChange,
    cashFlowChangeRatio: fcfQoqChange,
    financialDataSource: "SEC",
    financialUpdatedAt:
      latestFiledDate([currentFcf.operatingCashFlow, currentFcf.capex]) ??
      currentFcf.operatingCashFlow.filed,
    currentMargin,
    previousMargin,
    previousFcf: previousFcf?.fcf ?? null,
    selectedFinancialPeriods: selectedPeriods,
    staleDataRejected: anyStaleDataRejected(
      revenueState,
      operatingIncomeState,
      netIncomeState,
      operatingCashFlowState,
      capexState,
    ),
    financialPeriodType: currentFcf.periodType,
    currentQuarterFcf: currentFcf.currentQuarterFcf,
    previousQuarterFcf: previousFcf?.currentQuarterFcf ?? null,
    secSelectedPeriodEnd: currentFcf.operatingCashFlow.end ?? null,
    secSelectedPeriodFiled:
      latestFiledDate([currentFcf.operatingCashFlow, currentFcf.capex]) ?? null,
    secNormalizationNote: currentFcf.note,
    fcfQoqRaw: fcfQoqChange,
    fcfQoqScoreInput: stableFcfScore.scoreInput,
    marginChangeRaw: marginChange,
    marginChangeScoreInput: stableMarginScore.scoreInput,
    financialScoreNote: financialScoreNote || undefined,
    capexMissingFresh:
      operatingCashFlowState.facts.length > 0 && capexState.facts.length === 0,
    availableCapexCandidateTags,
    previousQuarterMethod: previousFcf?.method ?? "UNAVAILABLE",
    previousQuarterSearch: previousQuarterRecovery.search,
    fyMinusQ3YtdCandidates: previousQuarterRecovery.fyMinusQ3YtdCandidates,
    previousQuarterSelectedPeriods: previousFcf
      ? {
          ocfCurrent: toDebugFact(previousFcf.operatingCashFlow),
          capexCurrent: toDebugFact(previousFcf.capex),
          ocfPriorForDiff: toDebugFact(previousFcf.previousOperatingCashFlow),
          capexPriorForDiff: toDebugFact(previousFcf.previousCapex),
          fyOcf:
            previousFcf.method === "FY_MINUS_Q3_YTD"
              ? toDebugFact(previousFcf.operatingCashFlow)
              : undefined,
          fyCapex:
            previousFcf.method === "FY_MINUS_Q3_YTD"
              ? toDebugFact(previousFcf.capex)
              : undefined,
          q3YtdOcf:
            previousFcf.method === "FY_MINUS_Q3_YTD"
              ? toDebugFact(previousFcf.previousOperatingCashFlow)
              : undefined,
          q3YtdCapex:
            previousFcf.method === "FY_MINUS_Q3_YTD"
              ? toDebugFact(previousFcf.previousCapex)
              : undefined,
        }
      : undefined,
  };
}

export async function buildSecFinancialSnapshot(ticker: string) {
  if (etfLikeTickers.has(normalizeTicker(ticker))) {
    return null;
  }

  const cik = await getCikForTicker(ticker);

  if (!cik) {
    return null;
  }

  const companyFacts = await fetchCompanyFacts(cik);

  return extractQuarterlyFinancials(companyFacts);
}

export async function buildSecFinancialDebug(ticker: string) {
  const normalizedTicker = normalizeTicker(ticker);

  if (etfLikeTickers.has(normalizedTicker)) {
    return {
      ticker: normalizedTicker,
      cikFound: false,
      financialDataSource: "N/A" as const,
      error: "ETF_OR_SPECIAL_TICKER",
    };
  }

  const cik = await getCikForTicker(normalizedTicker);

  if (!cik) {
    return {
      ticker: normalizedTicker,
      cikFound: false,
      financialDataSource: "N/A" as const,
      error: "CIK_NOT_FOUND",
    };
  }

  let companyFacts: CompanyFacts;

  try {
    companyFacts = await fetchCompanyFacts(cik);
  } catch (error) {
    return {
      ticker: normalizedTicker,
      cikFound: true,
      cik,
      companyFactsFetched: false,
      financialDataSource: "N/A" as const,
      error:
        error instanceof Error
          ? error.message
          : "SEC_COMPANYFACTS_REQUEST_FAILED",
    };
  }

  const financials = extractQuarterlyFinancials(companyFacts);
  const availableCapexCandidateTags = findLikelyCapexTags(companyFacts);
  const capexFreshnessByTag = summarizeFreshnessByTag(
    companyFacts,
    availableCapexCandidateTags,
  );

  if (!financials) {
    const freshness = summarizeFreshness(companyFacts);
    const ocfFresh = freshness.operatingCashFlow.fresh > 0;
    const capexFresh = capexFreshnessByTag.some((summary) => summary.fresh > 0);

    return {
      ticker: normalizedTicker,
      cikFound: true,
      cik,
      companyFactsFetched: true,
      financialDataSource: "N/A" as const,
      error: "SEC_EXTRACTION_UNAVAILABLE",
      availableTags: summarizeAvailableTags(companyFacts),
      freshness,
      availableCapexCandidateTags,
      capexFreshnessByTag,
      capexMissingFresh: ocfFresh && !capexFresh,
      staleDataRejected: Object.values(freshness).some(
        (summary) => summary.total > 0 && summary.fresh === 0,
      ),
    };
  }

  return {
    ticker: normalizedTicker,
    cikFound: true,
    cik,
    companyFactsFetched: true,
    financialDataSource: financials.financialDataSource,
    fcf: financials.fcf,
    fcfQoqChange: financials.fcfQoqChange,
    fcfQoqRaw: financials.fcfQoqRaw,
    fcfQoqScoreInput: financials.fcfQoqScoreInput,
    marginChange: financials.marginChange,
    marginChangeRaw: financials.marginChangeRaw,
    marginChangeScoreInput: financials.marginChangeScoreInput,
    fcfScore: financials.fcfScore,
    marginScore: financials.marginScore,
    financialScoreNote: financials.financialScoreNote,
    financialUpdatedAt: financials.financialUpdatedAt,
    financialPeriodType: financials.financialPeriodType,
    currentQuarterFcf: financials.currentQuarterFcf,
    previousQuarterFcf: financials.previousQuarterFcf,
    previousQuarterMethod: financials.previousQuarterMethod,
    previousQuarterSearch: financials.previousQuarterSearch,
    previousQuarterSelectedPeriods: financials.previousQuarterSelectedPeriods,
    fyMinusQ3YtdCandidates: financials.fyMinusQ3YtdCandidates,
    secSelectedPeriodEnd: financials.secSelectedPeriodEnd,
    secSelectedPeriodFiled: financials.secSelectedPeriodFiled,
    secNormalizationNote: financials.secNormalizationNote,
    availableCapexCandidateTags,
    capexFreshnessByTag,
    capexMissingFresh: financials.capexMissingFresh ?? false,
    selectedPeriods: financials.selectedFinancialPeriods,
    staleDataRejected: financials.staleDataRejected ?? false,
    availableTags: summarizeAvailableTags(companyFacts),
  };
}

export async function getFinancialFallback(
  ticker: string,
): Promise<FinancialSnapshot> {
  const fallback = getMockFinancialFallback(ticker);
  const hasFallback = getMockCandidateFallback(ticker) != null;
  const source: FinancialDataSource =
    etfLikeTickers.has(normalizeTicker(ticker)) || !hasFallback
      ? "N/A"
      : "FALLBACK";

  return {
    ...fallback,
    financialDataSource: source,
    currentMargin: null,
    previousMargin: null,
    previousFcf: null,
    financialError: source === "N/A" ? "SEC_UNAVAILABLE" : undefined,
  };
}
