import "server-only";

import type { CapitalFlowDataSource, CapitalFlowQuality } from "@/types/stock";
import type { OhlcvCandle } from "@/lib/capitalFlow";
import {
  getProviderBudget,
  tryConsumeProviderCall,
} from "@/lib/providerUsageLimit";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type ProviderName = "POLYGON" | "ALPHA_VANTAGE";

export type ProviderArchiveStatus = {
  archived: boolean;
  status: string;
  error?: string;
};

export type ProviderPayloadSummary = {
  provider: ProviderName;
  resultCount: number;
  latestDate?: string;
  status?: string;
};

export type ProviderFetchMetadata = {
  providerUsed?: CapitalFlowDataSource;
  providerPriorityTried: CapitalFlowDataSource[];
  providerErrors: string[];
  archiveStatus?: string;
  rawProviderPayloadSummary?: ProviderPayloadSummary;
  providerCallBudget: {
    polygon: ReturnType<typeof getProviderBudget>;
    alphaVantage: ReturnType<typeof getProviderBudget>;
  };
  providerCallsUsed: {
    polygon: number;
    alphaVantage: number;
  };
};

export type ProviderOhlcvResult = ProviderFetchMetadata & {
  candles: OhlcvCandle[];
  providerUsed?: CapitalFlowDataSource;
  quality?: CapitalFlowQuality;
};

export function getProviderBudgetSummary() {
  const polygon = getProviderBudget("POLYGON");
  const alphaVantage = getProviderBudget("ALPHA_VANTAGE");

  return {
    polygon,
    alphaVantage,
  };
}

export function getProviderCallsUsedSummary() {
  const budget = getProviderBudgetSummary();

  return {
    polygon: budget.polygon.callsUsed,
    alphaVantage: budget.alphaVantage.callsUsed,
  };
}

export function emptyProviderMetadata(): ProviderFetchMetadata {
  return {
    providerPriorityTried: [],
    providerErrors: [],
    providerCallBudget: getProviderBudgetSummary(),
    providerCallsUsed: getProviderCallsUsedSummary(),
  };
}

function toDate(value: string) {
  const date = new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
}

function toNumber(value: unknown) {
  const number = typeof value === "string" ? Number(value) : value;

  return typeof number === "number" && Number.isFinite(number) ? number : null;
}

function isValidCandle(candle: OhlcvCandle) {
  return (
    candle.date instanceof Date &&
    Number.isFinite(candle.date.getTime()) &&
    typeof candle.high === "number" &&
    Number.isFinite(candle.high) &&
    typeof candle.low === "number" &&
    Number.isFinite(candle.low) &&
    typeof candle.close === "number" &&
    Number.isFinite(candle.close) &&
    typeof candle.volume === "number" &&
    Number.isFinite(candle.volume)
  );
}

function latestDate(candles: OhlcvCandle[]) {
  return candles.at(-1)?.date.toISOString().slice(0, 10);
}

function providerError(provider: ProviderName, message: string) {
  return `${provider}:${message}`;
}

async function fetchPolygonCandles(symbol: string): Promise<{
  candles: OhlcvCandle[];
  summary: ProviderPayloadSummary;
}> {
  const apiKey = process.env.POLYGON_API_KEY;

  if (!apiKey) {
    throw new Error("API_KEY_MISSING");
  }

  if (!tryConsumeProviderCall("POLYGON")) {
    throw new Error("CALL_BUDGET_EXHAUSTED");
  }

  const to = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 60);
  const response = await fetch(
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(
      symbol,
    )}/range/1/day/${from.toISOString().slice(0, 10)}/${to
      .toISOString()
      .slice(0, 10)}?adjusted=true&sort=asc&limit=60&apiKey=${apiKey}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  const payload = (await response.json()) as {
    status?: string;
    resultsCount?: number;
    results?: Array<{
      t: number;
      o: number;
      h: number;
      l: number;
      c: number;
      v: number;
    }>;
  };
  const candles =
    payload.results
      ?.map((row) => ({
        date: new Date(row.t),
        open: toNumber(row.o),
        high: toNumber(row.h),
        low: toNumber(row.l),
        close: toNumber(row.c),
        volume: toNumber(row.v),
      }))
      .filter(isValidCandle)
      .sort((a, b) => a.date.getTime() - b.date.getTime()) ?? [];

  if (candles.length === 0) {
    throw new Error("NO_VALID_CANDLES");
  }

  return {
    candles,
    summary: {
      provider: "POLYGON",
      resultCount: payload.resultsCount ?? candles.length,
      latestDate: latestDate(candles),
      status: payload.status,
    },
  };
}

async function fetchAlphaVantageCandles(symbol: string): Promise<{
  candles: OhlcvCandle[];
  summary: ProviderPayloadSummary;
}> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    throw new Error("API_KEY_MISSING");
  }

  if (!tryConsumeProviderCall("ALPHA_VANTAGE")) {
    throw new Error("CALL_BUDGET_EXHAUSTED");
  }

  const response = await fetch(
    `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(
      symbol,
    )}&outputsize=compact&apikey=${apiKey}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  const payload = (await response.json()) as {
    ["Error Message"]?: string;
    ["Information"]?: string;
    ["Note"]?: string;
    ["Time Series (Daily)"]?: Record<
      string,
      {
        ["1. open"]: string;
        ["2. high"]: string;
        ["3. low"]: string;
        ["4. close"]: string;
        ["5. adjusted close"]?: string;
        ["6. volume"]: string;
      }
    >;
  };

  if (payload["Error Message"] || payload.Information || payload.Note) {
    throw new Error(
      payload["Error Message"] ?? payload.Information ?? payload.Note ?? "API_RESPONSE_ERROR",
    );
  }

  const rows = payload["Time Series (Daily)"];

  if (!rows) {
    throw new Error("NO_TIME_SERIES");
  }

  const candles = Object.entries(rows)
    .map<OhlcvCandle | null>(([dateText, row]) => {
      const date = toDate(dateText);

      return date
        ? {
            date,
            open: toNumber(row["1. open"]),
            high: toNumber(row["2. high"]),
            low: toNumber(row["3. low"]),
            close: toNumber(row["4. close"]),
            volume: toNumber(row["6. volume"]),
          }
        : null;
    })
    .filter((row): row is OhlcvCandle => row != null && isValidCandle(row))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (candles.length === 0) {
    throw new Error("NO_VALID_CANDLES");
  }

  return {
    candles,
    summary: {
      provider: "ALPHA_VANTAGE",
      resultCount: candles.length,
      latestDate: latestDate(candles),
      status: "OK",
    },
  };
}

export async function archiveMarketDataIfPossible({
  ticker,
  provider,
  candles,
  payloadSummary,
}: {
  ticker: string;
  provider: CapitalFlowDataSource;
  candles: OhlcvCandle[];
  payloadSummary?: ProviderPayloadSummary;
}): Promise<ProviderArchiveStatus> {
  if (provider !== "ALPHA_VANTAGE" && provider !== "POLYGON") {
    return { archived: false, status: "PROXY_PROVIDER" };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return { archived: false, status: "SUPABASE_UNAVAILABLE" };
  }

  try {
    const { error } = await supabase
      .from("alpha_scout_market_data_archive")
      .upsert(
        {
          ticker,
          provider,
          data_date: new Date().toISOString().slice(0, 10),
          payload: {
            summary: payloadSummary,
            candles: candles.map((candle) => ({
              ...candle,
              date: candle.date.toISOString().slice(0, 10),
            })),
          },
        },
        { onConflict: "ticker,provider,data_date" },
      );

    if (error) {
      return {
        archived: false,
        status:
          error.code === "42P01"
            ? "ARCHIVE_TABLE_MISSING"
            : "ARCHIVE_FAILED",
        error: error.message,
      };
    }

    return { archived: true, status: "ARCHIVED" };
  } catch (error) {
    return {
      archived: false,
      status: "ARCHIVE_FAILED",
      error: error instanceof Error ? error.message : "ARCHIVE_FAILED",
    };
  }
}

export async function fetchProviderCandles(
  symbol: string,
): Promise<ProviderOhlcvResult> {
  const providerErrors: string[] = [];
  const providerPriorityTried: CapitalFlowDataSource[] = [];

  try {
    providerPriorityTried.push("POLYGON");
    const polygon = await fetchPolygonCandles(symbol);
    const archive = await archiveMarketDataIfPossible({
      ticker: symbol,
      provider: "POLYGON",
      candles: polygon.candles,
      payloadSummary: polygon.summary,
    });

    return {
      candles: polygon.candles,
      providerUsed: "POLYGON",
      quality: "REAL_PROVIDER",
      providerPriorityTried,
      providerErrors: archive.error
        ? [...providerErrors, providerError("POLYGON", archive.error)]
        : providerErrors,
      archiveStatus: archive.status,
      rawProviderPayloadSummary: polygon.summary,
      providerCallBudget: getProviderBudgetSummary(),
      providerCallsUsed: getProviderCallsUsedSummary(),
    };
  } catch (error) {
    providerErrors.push(
      providerError("POLYGON", error instanceof Error ? error.message : "UNKNOWN_ERROR"),
    );
  }

  try {
    providerPriorityTried.push("ALPHA_VANTAGE");
    const alphaVantage = await fetchAlphaVantageCandles(symbol);
    const archive = await archiveMarketDataIfPossible({
      ticker: symbol,
      provider: "ALPHA_VANTAGE",
      candles: alphaVantage.candles,
      payloadSummary: alphaVantage.summary,
    });

    return {
      candles: alphaVantage.candles,
      providerUsed: "ALPHA_VANTAGE",
      quality: "REAL_PROVIDER",
      providerPriorityTried,
      providerErrors: archive.error
        ? [...providerErrors, providerError("ALPHA_VANTAGE", archive.error)]
        : providerErrors,
      archiveStatus: archive.status,
      rawProviderPayloadSummary: alphaVantage.summary,
      providerCallBudget: getProviderBudgetSummary(),
      providerCallsUsed: getProviderCallsUsedSummary(),
    };
  } catch (error) {
    providerErrors.push(
      providerError(
        "ALPHA_VANTAGE",
        error instanceof Error ? error.message : "UNKNOWN_ERROR",
      ),
    );
  }

  return {
    candles: [],
    providerPriorityTried,
    providerErrors,
    providerCallBudget: getProviderBudgetSummary(),
    providerCallsUsed: getProviderCallsUsedSummary(),
  };
}
