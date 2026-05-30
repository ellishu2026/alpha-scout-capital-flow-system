import "server-only";

import {
  getMockCandidateFallback,
  getMockFinancialFallback,
} from "@/data/mockSnapshot";
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
};

const secTickerMapUrl = "https://www.sec.gov/files/company_tickers.json";
const secCompanyFactsBaseUrl = "https://data.sec.gov/api/xbrl/companyfacts";
const etfLikeTickers = new Set(["SOXL", "SMH"]);
const quarterLikePeriods = new Set(["Q1", "Q2", "Q3", "Q4", "FY"]);
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
        .sort(
          (a, b) =>
            factSortTime(b) - factSortTime(a) ||
            filedSortTime(b) - filedSortTime(a),
        );

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

  if (exact?.val != null) {
    return exact.val;
  }

  const targetTime = factSortTime(target);
  const nearest = facts
    .filter((fact) => factSortTime(fact) <= targetTime)
    .sort(
      (a, b) =>
        Math.abs(factSortTime(a) - targetTime) -
        Math.abs(factSortTime(b) - targetTime),
    )[0];

  return nearest?.val ?? facts[0]?.val ?? null;
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
    return 72;
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
    return 70;
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

export function summarizeAvailableTags(companyFacts: CompanyFacts) {
  const usGaap = companyFacts.facts?.["us-gaap"];

  if (!usGaap) {
    return {
      revenueTags: [],
      operatingIncomeTags: [],
      netIncomeTags: [],
      operatingCashFlowTags: [],
      capexTags: [],
    };
  }

  const present = (tags: string[]) =>
    tags.filter((tag) => Boolean(usGaap[tag]?.units?.USD?.length));

  return {
    revenueTags: present(revenueTags),
    operatingIncomeTags: present(operatingIncomeTags),
    netIncomeTags: present(netIncomeTags),
    operatingCashFlowTags: present(operatingCashFlowTags),
    capexTags: present(capexTags),
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
  const revenueFacts = getUsdFacts(companyFacts, revenueTags);
  const operatingIncomeFacts = getUsdFacts(companyFacts, operatingIncomeTags);
  const netIncomeFacts = getUsdFacts(companyFacts, netIncomeTags);
  const operatingCashFlowFacts = getUsdFacts(companyFacts, operatingCashFlowTags);
  const capexFacts = getUsdFacts(companyFacts, capexTags);
  const currentRevenueFact = revenueFacts[0];
  const previousRevenueFact = revenueFacts[1];

  if (!currentRevenueFact?.val) {
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

  const currentIncome =
    nearestFactValue(operatingIncomeFacts, currentRevenueFact) ??
    nearestFactValue(netIncomeFacts, currentRevenueFact);
  const previousIncome =
    nearestFactValue(operatingIncomeFacts, previousRevenueFact) ??
    nearestFactValue(netIncomeFacts, previousRevenueFact);
  const currentMargin =
    currentIncome != null ? (currentIncome / currentRevenueFact.val) * 100 : null;
  const previousMargin =
    previousIncome != null && previousRevenueFact?.val
      ? (previousIncome / previousRevenueFact.val) * 100
      : null;
  const marginChange =
    currentMargin != null && previousMargin != null
      ? currentMargin - previousMargin
      : null;

  return {
    marginScore: scoreMargin(marginChange),
    fcfScore: scoreFcf(currentFcf, fcfQoqChange),
    marginChange,
    fcf: currentFcf,
    fcfQoqChange,
    cashFlowChangeRatio: fcfQoqChange,
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

  if (!financials) {
    return {
      ticker: normalizedTicker,
      cikFound: true,
      cik,
      companyFactsFetched: true,
      financialDataSource: "N/A" as const,
      error: "SEC_EXTRACTION_UNAVAILABLE",
      availableTags: summarizeAvailableTags(companyFacts),
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
    marginChange: financials.marginChange,
    fcfScore: financials.fcfScore,
    marginScore: financials.marginScore,
    financialUpdatedAt: financials.financialUpdatedAt,
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
