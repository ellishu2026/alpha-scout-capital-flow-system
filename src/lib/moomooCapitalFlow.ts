import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const execFileAsync = promisify(execFile);

export const MOOMOO_PROVIDER = "MOOMOO_CAPITAL_DISTRIBUTION" as const;
export const MOOMOO_FLOW_TIER = "MOOMOO_DIRECT_CAPITAL_FLOW" as const;
export const MOOMOO_FLOW_TIER_LABEL = "Moomoo Direct Capital Flow";
export const MOOMOO_FLOW_QUALITY_SCORE = 85;
export const MOOMOO_FLOW_VERSION = "V1.9.2_MOOMOO_CAPITAL_DISTRIBUTION";

export const MOOMOO_QUOTA_GUARD = {
  enabled: true,
  maxSymbolsPerRun: 20,
  requestIntervalMs: 1200,
  maxRequestsPerRun: 25,
  retryLimit: 1,
  maxBackfillSymbolsPerRun: 5,
  maxBackfillDaysPerRun: 3,
  backfillRequestIntervalMs: 1500,
  tradingApiAllowed: false,
} as const;

export type MoomooCapitalDistribution = {
  ticker: string;
  provider: typeof MOOMOO_PROVIDER;
  flowDate: string;
  currency: string;
  buyAmount: number;
  sellAmount: number;
  netFlow: number;
  capitalInSuper: number;
  capitalInBig: number;
  capitalInMid: number;
  capitalInSmall: number;
  capitalOutSuper: number;
  capitalOutBig: number;
  capitalOutMid: number;
  capitalOutSmall: number;
  source: "ARCHIVE" | "LIVE_MOOMOO_OPEND";
  rawPayloadSummary?: Record<string, unknown>;
};

export type MoomooIngestItem = {
  ticker?: unknown;
  buyAmount?: unknown;
  sellAmount?: unknown;
  netFlow?: unknown;
  capitalInSuper?: unknown;
  capitalInBig?: unknown;
  capitalInMid?: unknown;
  capitalInSmall?: unknown;
  capitalOutSuper?: unknown;
  capitalOutBig?: unknown;
  capitalOutMid?: unknown;
  capitalOutSmall?: unknown;
  capital_in_super?: unknown;
  capital_in_big?: unknown;
  capital_in_mid?: unknown;
  capital_in_small?: unknown;
  capital_out_super?: unknown;
  capital_out_big?: unknown;
  capital_out_mid?: unknown;
  capital_out_small?: unknown;
  updateTime?: unknown;
  update_time?: unknown;
  currency?: unknown;
};

export type MoomooIngestResult = {
  ticker: string;
  ok: boolean;
  status: string;
  error?: string;
  buyAmount?: number;
  sellAmount?: number;
  netFlow?: number;
};

export type MoomooFlowGuardSummary = {
  enabled: boolean;
  liveEnabled: boolean;
  maxSymbolsPerRun: number;
  requestIntervalMs: number;
  maxRequestsPerRun: number;
  retryLimit: number;
  requestedSymbolCount: number;
  scopedSymbolCount: number;
  archiveHitCount: number;
  liveProviderCallCount: number;
  skippedDueToScopeCount: number;
  skippedDueToQuotaCount: number;
  failedCount: number;
  tradingApiAllowed: false;
  fallbackToEnhancedProxy: boolean;
  status: "Available" | "Unavailable" | "Fallback Proxy" | "Local OpenD Required";
  sourceLabel: typeof MOOMOO_PROVIDER;
  statusMessage: string;
};

export type MoomooFlowResult = {
  rows: Map<string, MoomooCapitalDistribution>;
  history: Map<string, MoomooCapitalDistribution[]>;
  guard: MoomooFlowGuardSummary;
  errors: string[];
};

function currentUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;

  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function moomooCode(ticker: string) {
  return `US.${normalizeTicker(ticker).replace("-", ".")}`;
}

function parseDistributionPayload(
  ticker: string,
  payload: unknown,
  source: MoomooCapitalDistribution["source"],
): MoomooCapitalDistribution | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const capitalInSuper = toNumber(row.capital_in_super ?? row.capitalInSuper) ?? 0;
  const capitalInBig = toNumber(row.capital_in_big ?? row.capitalInBig) ?? 0;
  const capitalInMid = toNumber(row.capital_in_mid ?? row.capitalInMid) ?? 0;
  const capitalInSmall = toNumber(row.capital_in_small ?? row.capitalInSmall) ?? 0;
  const capitalOutSuper = toNumber(row.capital_out_super ?? row.capitalOutSuper) ?? 0;
  const capitalOutBig = toNumber(row.capital_out_big ?? row.capitalOutBig) ?? 0;
  const capitalOutMid = toNumber(row.capital_out_mid ?? row.capitalOutMid) ?? 0;
  const capitalOutSmall = toNumber(row.capital_out_small ?? row.capitalOutSmall) ?? 0;
  const buyAmount =
    capitalInSuper + capitalInBig + capitalInMid + capitalInSmall;
  const sellAmount =
    capitalOutSuper + capitalOutBig + capitalOutMid + capitalOutSmall;
  const netFlow = buyAmount - sellAmount;

  if (![buyAmount, sellAmount, netFlow].every(Number.isFinite)) return null;

  return {
    ticker: normalizeTicker(ticker),
    provider: MOOMOO_PROVIDER,
    flowDate:
      String(row.flowDate ?? row.flow_date ?? row.date ?? currentUtcDate()).slice(0, 10),
    currency: String(row.currency ?? "USD"),
    buyAmount,
    sellAmount,
    netFlow,
    capitalInSuper,
    capitalInBig,
    capitalInMid,
    capitalInSmall,
    capitalOutSuper,
    capitalOutBig,
    capitalOutMid,
    capitalOutSmall,
    source,
    rawPayloadSummary: {
      endpointType: "MOOMOO_GET_CAPITAL_DISTRIBUTION",
      code: row.code ?? moomooCode(ticker),
      status: row.status ?? "OK",
    },
  };
}

async function getArchivedMoomooRows(ticker: string) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) return [];

  const { data, error } = await supabase
    .from("alpha_scout_market_data_archive")
    .select("data_date,payload")
    .eq("ticker", normalizeTicker(ticker))
    .eq("provider", MOOMOO_PROVIDER)
    .order("data_date", { ascending: false })
    .limit(60);

  if (error || !data) return [];

  return data
    .map((row) =>
      parseDistributionPayload(
        ticker,
        (row.payload as { distribution?: unknown })?.distribution ?? row.payload,
        "ARCHIVE",
      ),
    )
    .filter((row): row is MoomooCapitalDistribution => row != null)
    .sort((a, b) => a.flowDate.localeCompare(b.flowDate));
}

export async function archiveMoomooDistribution(row: MoomooCapitalDistribution) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) return { archived: false, status: "SUPABASE_UNAVAILABLE" };

  const { error } = await supabase
    .from("alpha_scout_market_data_archive")
    .upsert(
      {
        ticker: row.ticker,
        provider: MOOMOO_PROVIDER,
        data_date: row.flowDate,
        payload: {
          summary: {
            provider: MOOMOO_PROVIDER,
            endpointType: "MOOMOO_GET_CAPITAL_DISTRIBUTION",
            latestDate: row.flowDate,
            resultCount: 1,
            status: "SAVED",
            archiveStatus: "SAVED",
            flowDataTier: MOOMOO_FLOW_TIER,
            flowDataTierLabel: MOOMOO_FLOW_TIER_LABEL,
            flowDataQualityScore: MOOMOO_FLOW_QUALITY_SCORE,
          },
          distribution: {
            ...row,
            archiveStatus: "SAVED",
            flowDataTier: MOOMOO_FLOW_TIER,
            flowDataTierLabel: MOOMOO_FLOW_TIER_LABEL,
            flowDataQualityScore: MOOMOO_FLOW_QUALITY_SCORE,
          },
        },
      },
      { onConflict: "ticker,provider,data_date" },
    );

  if (error) {
    return { archived: false, status: "ARCHIVE_FAILED", error: error.message };
  }

  return { archived: true, status: "SAVED" };
}

export function buildMoomooDistributionFromIngest({
  date,
  item,
}: {
  date: string;
  item: MoomooIngestItem;
}) {
  const ticker = typeof item.ticker === "string" ? normalizeTicker(item.ticker) : "";

  if (!ticker) {
    throw new Error("TICKER_REQUIRED");
  }

  const capitalInSuper = toNumber(item.capitalInSuper ?? item.capital_in_super) ?? 0;
  const capitalInBig = toNumber(item.capitalInBig ?? item.capital_in_big) ?? 0;
  const capitalInMid = toNumber(item.capitalInMid ?? item.capital_in_mid) ?? 0;
  const capitalInSmall = toNumber(item.capitalInSmall ?? item.capital_in_small) ?? 0;
  const capitalOutSuper = toNumber(item.capitalOutSuper ?? item.capital_out_super) ?? 0;
  const capitalOutBig = toNumber(item.capitalOutBig ?? item.capital_out_big) ?? 0;
  const capitalOutMid = toNumber(item.capitalOutMid ?? item.capital_out_mid) ?? 0;
  const capitalOutSmall = toNumber(item.capitalOutSmall ?? item.capital_out_small) ?? 0;
  const calculatedBuyAmount =
    capitalInSuper + capitalInBig + capitalInMid + capitalInSmall;
  const calculatedSellAmount =
    capitalOutSuper + capitalOutBig + capitalOutMid + capitalOutSmall;
  const buyAmount = toNumber(item.buyAmount) ?? calculatedBuyAmount;
  const sellAmount = toNumber(item.sellAmount) ?? calculatedSellAmount;
  const netFlow = toNumber(item.netFlow) ?? buyAmount - sellAmount;

  if (![buyAmount, sellAmount, netFlow].every(Number.isFinite)) {
    throw new Error("INVALID_FLOW_AMOUNTS");
  }

  return {
    ticker,
    provider: MOOMOO_PROVIDER,
    flowDate: date,
    currency: String(item.currency ?? "USD"),
    buyAmount,
    sellAmount,
    netFlow,
    capitalInSuper,
    capitalInBig,
    capitalInMid,
    capitalInSmall,
    capitalOutSuper,
    capitalOutBig,
    capitalOutMid,
    capitalOutSmall,
    source: "ARCHIVE" as const,
    rawPayloadSummary: {
      endpointType: "MOOMOO_INGEST_DAILY_FLOW",
      updateTime: item.updateTime ?? item.update_time ?? null,
      archiveStatus: "SAVED",
      flowDataTier: MOOMOO_FLOW_TIER,
      flowDataTierLabel: MOOMOO_FLOW_TIER_LABEL,
      flowDataQualityScore: MOOMOO_FLOW_QUALITY_SCORE,
    },
  } satisfies MoomooCapitalDistribution;
}

export async function ingestMoomooDailyFlows({
  date,
  items,
}: {
  date: string;
  items: MoomooIngestItem[];
}) {
  const scopedItems = items.slice(0, MOOMOO_QUOTA_GUARD.maxSymbolsPerRun);
  const results: MoomooIngestResult[] = [];

  for (const item of scopedItems) {
    const ticker = typeof item.ticker === "string" ? normalizeTicker(item.ticker) : "UNKNOWN";

    try {
      const row = buildMoomooDistributionFromIngest({ date, item });
      const archiveResult = await archiveMoomooDistribution(row);

      results.push({
        ticker: row.ticker,
        ok: archiveResult.archived,
        status: archiveResult.status,
        error: archiveResult.error,
        buyAmount: row.buyAmount,
        sellAmount: row.sellAmount,
        netFlow: row.netFlow,
      });
    } catch (error) {
      results.push({
        ticker,
        ok: false,
        status: "FAILED",
        error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      });
    }
  }

  return {
    results,
    savedCount: results.filter((result) => result.ok).length,
    failedCount: results.filter((result) => !result.ok).length,
    skippedDueToScopeCount: Math.max(items.length - scopedItems.length, 0),
  };
}

async function fetchMoomooDistributionLive(ticker: string) {
  const python = process.env.MOOMOO_PYTHON_BIN || "python3";
  const host = process.env.MOOMOO_OPEND_HOST || "127.0.0.1";
  const port = process.env.MOOMOO_OPEND_PORT || "11111";
  const code = moomooCode(ticker);
  const script = `
import json
import sys
from moomoo import OpenQuoteContext, RET_OK

code = sys.argv[1]
host = sys.argv[2]
port = int(sys.argv[3])
ctx = OpenQuoteContext(host=host, port=port)
try:
    ret, data = ctx.get_capital_distribution(code)
    if ret != RET_OK:
        raise RuntimeError(str(data))
    if hasattr(data, "to_dict"):
        rows = data.to_dict("records")
    elif isinstance(data, list):
        rows = data
    else:
        rows = [dict(data)]
    if not rows:
        raise RuntimeError("NO_CAPITAL_DISTRIBUTION_ROWS")
    row = rows[-1]
    row["code"] = code
    row["status"] = "OK"
    print(json.dumps(row, default=str))
finally:
    ctx.close()
`;

  const { stdout } = await execFileAsync(python, ["-c", script, code, host, port], {
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  const payload = JSON.parse(stdout.trim()) as unknown;
  const parsed = parseDistributionPayload(ticker, payload, "LIVE_MOOMOO_OPEND");

  if (!parsed) {
    throw new Error("INVALID_MOOMOO_CAPITAL_DISTRIBUTION_PAYLOAD");
  }

  return parsed;
}

async function fetchLiveWithRetry(ticker: string) {
  let lastError: string | null = null;

  for (let attempt = 0; attempt <= MOOMOO_QUOTA_GUARD.retryLimit; attempt += 1) {
    try {
      return await fetchMoomooDistributionLive(ticker);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      if (attempt < MOOMOO_QUOTA_GUARD.retryLimit) {
        await sleep(MOOMOO_QUOTA_GUARD.requestIntervalMs);
      }
    }
  }

  throw new Error(lastError ?? "MOOMOO_FETCH_FAILED");
}

function latestRow(rows: MoomooCapitalDistribution[]) {
  return rows.at(-1) ?? null;
}

export async function fetchScopedMoomooCapitalFlows(tickers: string[]): Promise<MoomooFlowResult> {
  const scopedTickers = Array.from(new Set(tickers.map(normalizeTicker).filter(Boolean))).slice(
    0,
    MOOMOO_QUOTA_GUARD.maxSymbolsPerRun,
  );
  const rows = new Map<string, MoomooCapitalDistribution>();
  const history = new Map<string, MoomooCapitalDistribution[]>();
  const errors: string[] = [];
  const liveEnabled = process.env.MOOMOO_CAPITAL_FLOW_ENABLED === "true";
  let archiveHitCount = 0;
  let liveProviderCallCount = 0;
  let skippedDueToQuotaCount = 0;

  for (const ticker of scopedTickers) {
    const archivedRows = await getArchivedMoomooRows(ticker);
    const archivedLatest = latestRow(archivedRows);

    if (archivedLatest) {
      rows.set(ticker, archivedLatest);
      history.set(ticker, archivedRows);
      archiveHitCount += 1;
      continue;
    }

    if (!liveEnabled) continue;

    if (liveProviderCallCount >= MOOMOO_QUOTA_GUARD.maxRequestsPerRun) {
      skippedDueToQuotaCount += 1;
      continue;
    }

    if (liveProviderCallCount > 0) {
      await sleep(MOOMOO_QUOTA_GUARD.requestIntervalMs);
    }

    try {
      liveProviderCallCount += 1;
      const liveRow = await fetchLiveWithRetry(ticker);
      rows.set(ticker, liveRow);
      history.set(ticker, [liveRow]);
      const archiveResult = await archiveMoomooDistribution(liveRow);
      if (!archiveResult.archived && archiveResult.error) {
        errors.push(`${ticker}:ARCHIVE:${archiveResult.error}`);
      }
    } catch (error) {
      errors.push(`${ticker}:${error instanceof Error ? error.message : "UNKNOWN_ERROR"}`);
    }
  }

  const status =
    rows.size > 0
      ? "Available"
      : liveEnabled
        ? "Unavailable"
        : "Local OpenD Required";
  const fallbackToEnhancedProxy = rows.size < scopedTickers.length;

  return {
    rows,
    history,
    errors,
    guard: {
      enabled: true,
      liveEnabled,
      maxSymbolsPerRun: MOOMOO_QUOTA_GUARD.maxSymbolsPerRun,
      requestIntervalMs: MOOMOO_QUOTA_GUARD.requestIntervalMs,
      maxRequestsPerRun: MOOMOO_QUOTA_GUARD.maxRequestsPerRun,
      retryLimit: MOOMOO_QUOTA_GUARD.retryLimit,
      requestedSymbolCount: tickers.length,
      scopedSymbolCount: scopedTickers.length,
      archiveHitCount,
      liveProviderCallCount,
      skippedDueToScopeCount: Math.max(tickers.length - scopedTickers.length, 0),
      skippedDueToQuotaCount,
      failedCount: errors.length,
      tradingApiAllowed: false,
      fallbackToEnhancedProxy,
      status: fallbackToEnhancedProxy && rows.size === 0 ? "Fallback Proxy" : status,
      sourceLabel: MOOMOO_PROVIDER,
      statusMessage: fallbackToEnhancedProxy
        ? "Moomoo Direct Flow unavailable; using Enhanced OHLCV Proxy fallback."
        : "Moomoo Direct Flow available for scoped ticker display.",
    },
  };
}
