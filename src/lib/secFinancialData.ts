import "server-only";

import { getMockFinancialFallback } from "@/data/mockSnapshot";
import type { FinancialDataSource } from "@/types/stock";

type SecTickerMapEntry = {
  cik_str: number;
  ticker: string;
  title: string;
};

type SecFactUnit = {
  form?: string;
  fp?: string;
  filed?: string;
  end?: string;
  val?: number;
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
  marginChange: number;
  fcf: number;
  fcfQoqChange: number;
  cashFlowChangeRatio: number;
  financialDataSource: FinancialDataSource;
  financialUpdatedAt?: string;
  currentMargin?: number | null;
  previousMargin?: number | null;
  previousFcf?: number | null;
};

const secTickerMapUrl = "https://www.sec.gov/files/company_tickers.json";
const secCompanyFactsBaseUrl = "https://data.sec.gov/api/xbrl/companyfacts";
const etfLikeTickers = new Set(["SOXL", "SMH"]);
const quarterLikePeriods = new Set(["Q1", "Q2", "Q3", "Q4", "FY"]);

const revenueTags = [
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "SalesRevenueNet",
];
const operatingIncomeTags = ["OperatingIncomeLoss"];
const netIncomeTags = ["NetIncomeLoss"];
const operatingCashFlowTags = ["NetCashProvidedByUsedInOperatingActivities"];
const capexTags = [
  "PaymentsToAcquirePropertyPlantAndEquipment",
  "PaymentsToAcquireProductiveAssets",
  "CapitalExpendituresIncurredButNotYetPaid",
];

let tickerMapCache: Map<string, string> | null = null;
const companyFactsCache = new Map<string, CompanyFacts>();

function getSecUserAgent() {
  return (
    process.env.SEC_USER_AGENT ??
    "AlphaScout Capital Flow System by Ellis / contact: ellis@example.com"
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

function getUsdFacts(companyFacts: CompanyFacts, tags: string[]) {
  const usGaap = companyFacts.facts?.["us-gaap"];

  if (!usGaap) {
    return [];
  }

  for (const tag of tags) {
    const units = usGaap[tag]?.units;
    const usdFacts = units?.USD;

    if (usdFacts?.length) {
      const facts = usdFacts
        .filter(isQuarterLikeFact)
        .sort((a, b) => factSortTime(b) - factSortTime(a));

      if (facts.length) {
        return facts;
      }
    }
  }

  return [];
}

function nearestFactValue(
  facts: SecFactUnit[],
  target: SecFactUnit | undefined,
) {
  if (!target) {
    return null;
  }

  const exact = facts.find(
    (fact) =>
      fact.end === target.end &&
      fact.fp === target.fp &&
      typeof fact.val === "number",
  );

  return exact?.val ?? null;
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

function scoreFcf(currentFcf: number, fcfQoqChange: number | null) {
  if (currentFcf <= 0) {
    return 45;
  }

  if (fcfQoqChange == null) {
    return 75;
  }

  if (fcfQoqChange >= 20) {
    return 90;
  }

  if (fcfQoqChange >= 10) {
    return 82;
  }

  if (fcfQoqChange >= 0) {
    return 75;
  }

  return 65;
}

function scoreMargin(marginChange: number | null) {
  if (marginChange == null) {
    return 65;
  }

  if (marginChange >= 5) {
    return 90;
  }

  if (marginChange >= 2) {
    return 82;
  }

  if (marginChange >= 0) {
    return 75;
  }

  if (marginChange >= -2) {
    return 60;
  }

  return 45;
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
  const tickerMap = await fetchSecTickerMap();

  return tickerMap.get(normalizeTicker(ticker)) ?? null;
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
  const revenueFacts = getUsdFacts(companyFacts, revenueTags);
  const operatingIncomeFacts = getUsdFacts(companyFacts, operatingIncomeTags);
  const netIncomeFacts = getUsdFacts(companyFacts, netIncomeTags);
  const operatingCashFlowFacts = getUsdFacts(companyFacts, operatingCashFlowTags);
  const capexFacts = getUsdFacts(companyFacts, capexTags);
  const currentRevenueFact = revenueFacts[0];
  const previousRevenueFact = revenueFacts[1];

  if (!currentRevenueFact?.val || !previousRevenueFact?.val) {
    return null;
  }

  const currentOperatingCashFlow = nearestFactValue(
    operatingCashFlowFacts,
    currentRevenueFact,
  );
  const previousOperatingCashFlow = nearestFactValue(
    operatingCashFlowFacts,
    previousRevenueFact,
  );
  const currentCapex = nearestFactValue(capexFacts, currentRevenueFact);
  const previousCapex = nearestFactValue(capexFacts, previousRevenueFact);

  if (currentOperatingCashFlow == null || currentCapex == null) {
    return null;
  }

  const currentFcf = currentOperatingCashFlow - Math.abs(currentCapex);
  const previousFcf =
    previousOperatingCashFlow != null && previousCapex != null
      ? previousOperatingCashFlow - Math.abs(previousCapex)
      : null;
  const fcfQoqChange = percentChange(currentFcf, previousFcf);

  if (previousFcf == null || fcfQoqChange == null) {
    return null;
  }

  const currentIncome =
    nearestFactValue(operatingIncomeFacts, currentRevenueFact) ??
    nearestFactValue(netIncomeFacts, currentRevenueFact);
  const previousIncome =
    nearestFactValue(operatingIncomeFacts, previousRevenueFact) ??
    nearestFactValue(netIncomeFacts, previousRevenueFact);
  const currentMargin =
    currentIncome != null ? (currentIncome / currentRevenueFact.val) * 100 : null;
  const previousMargin =
    previousIncome != null
      ? (previousIncome / previousRevenueFact.val) * 100
      : null;
  const marginChange =
    currentMargin != null && previousMargin != null
      ? currentMargin - previousMargin
      : null;

  return {
    marginScore: scoreMargin(marginChange),
    fcfScore: scoreFcf(currentFcf, fcfQoqChange),
    marginChange: marginChange ?? 0,
    fcf: currentFcf,
    fcfQoqChange: fcfQoqChange ?? 0,
    cashFlowChangeRatio: fcfQoqChange ?? 0,
    financialDataSource: "SEC",
    financialUpdatedAt: currentRevenueFact.filed,
    currentMargin,
    previousMargin,
    previousFcf,
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

export async function getFinancialFallback(
  ticker: string,
): Promise<FinancialSnapshot> {
  const fallback = getMockFinancialFallback(ticker);
  const source: FinancialDataSource = etfLikeTickers.has(normalizeTicker(ticker))
    ? "N/A"
    : "FALLBACK";

  return {
    ...fallback,
    financialDataSource: source,
    currentMargin: null,
    previousMargin: null,
    previousFcf: null,
  };
}
