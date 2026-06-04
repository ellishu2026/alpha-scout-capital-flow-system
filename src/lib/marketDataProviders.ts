import "server-only";

import type {
  ArchiveHitProvider,
  CapitalFlowDataSource,
  CapitalFlowQuality,
  ProviderUsed,
} from "@/types/stock";
import type { OhlcvCandle } from "@/lib/capitalFlow";
import {
  getProviderBudget,
  tryConsumeProviderCall,
} from "@/lib/providerUsageLimit";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type ProviderName = "POLYGON" | "ALPHA_VANTAGE" | "TWELVE_DATA" | "EODHD";

export const POLYGON_LIVE_ENABLED =
  process.env.POLYGON_LIVE_ENABLED === "true";

export type ProviderArchiveStatus = {
  archived: boolean;
  status: string;
  error?: string;
};

export type ProviderPayloadSummary = {
  provider: ProviderName;
  endpointType: string;
  resultCount: number;
  latestDate?: string;
  status?: string;
};

export type ProviderFetchMetadata = {
  providerUsed?: ProviderUsed;
  providerPriorityTried: string[];
  providerErrors: string[];
  providerEndpointType?: string;
  archiveLookupTried: boolean;
  archiveProviderChecked: ProviderName[];
  archiveHitProvider: ArchiveHitProvider;
  archiveStatus?: string;
  rawProviderPayloadSummary?: ProviderPayloadSummary;
  providerCallBudget: {
    polygon: ReturnType<typeof getProviderBudget>;
    alphaVantage: ReturnType<typeof getProviderBudget>;
    twelveData: ReturnType<typeof getProviderBudget>;
    eodhd: ReturnType<typeof getProviderBudget>;
  };
  providerCallsUsed: {
    polygon: number;
    alphaVantage: number;
    twelveData: number;
    eodhd: number;
  };
  polygonLiveEnabled: boolean;
};

export type ProviderOhlcvResult = ProviderFetchMetadata & {
  candles: OhlcvCandle[];
  providerUsed?: ProviderUsed;
  dataSource?: CapitalFlowDataSource;
  quality?: CapitalFlowQuality;
};

export function getProviderBudgetSummary() {
  const polygon = getProviderBudget("POLYGON");
  const alphaVantage = getProviderBudget("ALPHA_VANTAGE");
  const twelveData = getProviderBudget("TWELVE_DATA");
  const eodhd = getProviderBudget("EODHD");

  return {
    polygon,
    alphaVantage,
    twelveData,
    eodhd,
  };
}

export function getProviderCallsUsedSummary() {
  const budget = getProviderBudgetSummary();

  return {
    polygon: budget.polygon.callsUsed,
    alphaVantage: budget.alphaVantage.callsUsed,
    twelveData: budget.twelveData.callsUsed,
    eodhd: budget.eodhd.callsUsed,
  };
}

export function getPolygonLiveEnabled() {
  return POLYGON_LIVE_ENABLED;
}

export function emptyProviderMetadata(): ProviderFetchMetadata {
  return {
    providerPriorityTried: [],
    providerErrors: [],
    archiveLookupTried: false,
    archiveProviderChecked: [],
    archiveHitProvider: null,
    providerCallBudget: getProviderBudgetSummary(),
    providerCallsUsed: getProviderCallsUsedSummary(),
    polygonLiveEnabled: POLYGON_LIVE_ENABLED,
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

function currentUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function archiveProviderUsed(provider: ProviderName): ProviderUsed {
  if (provider === "POLYGON") return "POLYGON_ARCHIVE";
  if (provider === "TWELVE_DATA") return "TWELVE_DATA_ARCHIVE";
  if (provider === "EODHD") return "EODHD_ARCHIVE";

  return "ALPHA_VANTAGE_ARCHIVE";
}

function archiveEndpointType(provider: ProviderName) {
  if (provider === "POLYGON") return "POLYGON_AGGS_DAILY_ARCHIVE";
  if (provider === "TWELVE_DATA") {
    return "TWELVE_DATA_TIME_SERIES_DAILY_ARCHIVE";
  }
  if (provider === "EODHD") return "EODHD_EOD_HISTORICAL_ARCHIVE";

  return "ALPHA_VANTAGE_TIME_SERIES_DAILY_ARCHIVE";
}

function parseArchivePayload(
  payload: unknown,
  provider: ProviderName,
): {
  candles: OhlcvCandle[];
  summary: ProviderPayloadSummary;
} | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const archivePayload = payload as {
    summary?: Partial<ProviderPayloadSummary>;
    candles?: Array<{
      date?: string;
      open?: unknown;
      high?: unknown;
      low?: unknown;
      close?: unknown;
      volume?: unknown;
    }>;
  };

  const candles =
    archivePayload.candles
      ?.map<OhlcvCandle | null>((row) => {
        const date = row.date ? toDate(row.date) : null;

        return date
          ? {
              date,
              open: toNumber(row.open),
              high: toNumber(row.high),
              low: toNumber(row.low),
              close: toNumber(row.close),
              volume: toNumber(row.volume),
            }
          : null;
      })
      .filter((row): row is OhlcvCandle => row != null && isValidCandle(row))
      .sort((a, b) => a.date.getTime() - b.date.getTime()) ?? [];

  if (candles.length === 0) {
    return null;
  }

  return {
    candles,
    summary: {
      provider,
      endpointType:
        archivePayload.summary?.endpointType ?? archiveEndpointType(provider),
      resultCount:
        typeof archivePayload.summary?.resultCount === "number"
          ? archivePayload.summary.resultCount
          : candles.length,
      latestDate: archivePayload.summary?.latestDate ?? latestDate(candles),
      status: archivePayload.summary?.status ?? "ARCHIVE_HIT",
    },
  };
}

async function getArchivedMarketData({
  ticker,
  provider,
}: {
  ticker: string;
  provider: ProviderName;
}): Promise<
  | {
      candles: OhlcvCandle[];
      summary: ProviderPayloadSummary;
    }
  | null
> {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("alpha_scout_market_data_archive")
    .select("payload")
    .eq("ticker", ticker)
    .eq("provider", provider)
    .eq("data_date", currentUtcDate())
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return parseArchivePayload(data.payload, provider);
}

export async function getArchivedMarketDataForTicker(ticker: string): Promise<
  | {
      provider: ProviderName;
      candles: OhlcvCandle[];
      summary: ProviderPayloadSummary;
    }
  | null
> {
  const archiveProviderChecked: ProviderName[] = [
    "POLYGON",
    "ALPHA_VANTAGE",
    "TWELVE_DATA",
    "EODHD",
  ];

  for (const provider of archiveProviderChecked) {
    const archived = await getArchivedMarketData({
      ticker,
      provider,
    });

    if (archived) {
      return {
        provider,
        candles: archived.candles,
        summary: archived.summary,
      };
    }
  }

  return null;
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
    `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(
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
        ["5. volume"]: string;
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
            volume: toNumber(row["5. volume"]),
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
      endpointType: "ALPHA_VANTAGE_TIME_SERIES_DAILY",
      resultCount: candles.length,
      latestDate: latestDate(candles),
      status: "OK",
    },
  };
}

async function fetchTwelveDataCandles(symbol: string): Promise<{
  candles: OhlcvCandle[];
  summary: ProviderPayloadSummary;
}> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    throw new Error("API_KEY_MISSING");
  }

  if (!tryConsumeProviderCall("TWELVE_DATA")) {
    throw new Error("CALL_BUDGET_EXHAUSTED");
  }

  const response = await fetch(
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
      symbol,
    )}&interval=1day&outputsize=60&apikey=${apiKey}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  const payload = (await response.json()) as {
    status?: string;
    code?: number;
    message?: string;
    values?: Array<{
      datetime?: string;
      open?: string;
      high?: string;
      low?: string;
      close?: string;
      volume?: string;
    }>;
  };

  if (payload.status === "error" || payload.code || payload.message) {
    throw new Error(payload.message ?? `API_ERROR_${payload.code ?? "UNKNOWN"}`);
  }

  const candles =
    payload.values
      ?.map<OhlcvCandle | null>((row) => {
        const date = row.datetime ? toDate(row.datetime) : null;

        return date
          ? {
              date,
              open: toNumber(row.open),
              high: toNumber(row.high),
              low: toNumber(row.low),
              close: toNumber(row.close),
              volume: toNumber(row.volume),
            }
          : null;
      })
      .filter((row): row is OhlcvCandle => row != null && isValidCandle(row))
      .sort((a, b) => a.date.getTime() - b.date.getTime()) ?? [];

  if (candles.length === 0) {
    throw new Error("NO_VALID_CANDLES");
  }

  return {
    candles,
    summary: {
      provider: "TWELVE_DATA",
      endpointType: "TWELVE_DATA_TIME_SERIES_DAILY",
      resultCount: candles.length,
      latestDate: latestDate(candles),
      status: payload.status ?? "OK",
    },
  };
}

function eodhdSymbol(symbol: string) {
  return symbol.includes(".") ? symbol : `${symbol}.US`;
}

async function fetchEodhdCandles(symbol: string): Promise<{
  candles: OhlcvCandle[];
  summary: ProviderPayloadSummary;
}> {
  const apiKey = process.env.EODHD_API_KEY;

  if (!apiKey) {
    throw new Error("API_KEY_MISSING");
  }

  if (!tryConsumeProviderCall("EODHD")) {
    throw new Error("CALL_BUDGET_EXHAUSTED");
  }

  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 90);
  const response = await fetch(
    `https://eodhd.com/api/eod/${encodeURIComponent(
      eodhdSymbol(symbol),
    )}?api_token=${apiKey}&fmt=json&period=d&from=${from
      .toISOString()
      .slice(0, 10)}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  const payload = (await response.json()) as
    | Array<{
        date?: string;
        open?: unknown;
        high?: unknown;
        low?: unknown;
        close?: unknown;
        volume?: unknown;
      }>
    | {
        code?: number;
        message?: string;
        error?: string;
      };

  if (!Array.isArray(payload)) {
    throw new Error(
      payload.message ?? payload.error ?? `API_ERROR_${payload.code ?? "UNKNOWN"}`,
    );
  }

  const candles = payload
    .map<OhlcvCandle | null>((row) => {
      const date = row.date ? toDate(row.date) : null;

      return date
        ? {
            date,
            open: toNumber(row.open),
            high: toNumber(row.high),
            low: toNumber(row.low),
            close: toNumber(row.close),
            volume: toNumber(row.volume),
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
      provider: "EODHD",
      endpointType: "EODHD_EOD_HISTORICAL",
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
  if (
    provider !== "ALPHA_VANTAGE" &&
    provider !== "POLYGON" &&
    provider !== "TWELVE_DATA" &&
    provider !== "EODHD"
  ) {
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
          data_date: currentUtcDate(),
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
  const providerPriorityTried: string[] = ["ARCHIVE"];
  const archiveProviderChecked: ProviderName[] = [
    "POLYGON",
    "ALPHA_VANTAGE",
    "TWELVE_DATA",
    "EODHD",
  ];
  const archiveLookupTried = true;

  for (const provider of archiveProviderChecked) {
    const archived = await getArchivedMarketData({
      ticker: symbol,
      provider,
    });

    if (archived) {
      return {
        candles: archived.candles,
        providerUsed: archiveProviderUsed(provider),
        dataSource: provider,
        quality: "REAL_PROVIDER",
        providerPriorityTried: ["ARCHIVE"],
        providerErrors,
        providerEndpointType: archived.summary.endpointType,
        archiveLookupTried,
        archiveProviderChecked,
        archiveHitProvider: provider,
        archiveStatus: "ARCHIVE_HIT",
        rawProviderPayloadSummary: archived.summary,
        providerCallBudget: getProviderBudgetSummary(),
        providerCallsUsed: getProviderCallsUsedSummary(),
        polygonLiveEnabled: POLYGON_LIVE_ENABLED,
      };
    }
  }

  const liveProviders: Array<{
    provider: Exclude<ProviderName, "POLYGON">;
    fetchCandles: (ticker: string) => Promise<{
      candles: OhlcvCandle[];
      summary: ProviderPayloadSummary;
    }>;
  }> = [
    { provider: "ALPHA_VANTAGE", fetchCandles: fetchAlphaVantageCandles },
    { provider: "TWELVE_DATA", fetchCandles: fetchTwelveDataCandles },
    { provider: "EODHD", fetchCandles: fetchEodhdCandles },
  ];

  for (const liveProvider of liveProviders) {
    try {
      providerPriorityTried.push(liveProvider.provider);
      const providerResult = await liveProvider.fetchCandles(symbol);
      const archive = await archiveMarketDataIfPossible({
        ticker: symbol,
        provider: liveProvider.provider,
        candles: providerResult.candles,
        payloadSummary: providerResult.summary,
      });

      return {
        candles: providerResult.candles,
        providerUsed: liveProvider.provider,
        dataSource: liveProvider.provider,
        quality: "REAL_PROVIDER",
        providerPriorityTried,
        providerErrors: archive.error
          ? [
              ...providerErrors,
              providerError(liveProvider.provider, archive.error),
            ]
          : providerErrors,
        providerEndpointType: providerResult.summary.endpointType,
        archiveLookupTried,
        archiveProviderChecked,
        archiveHitProvider: null,
        archiveStatus: archive.status,
        rawProviderPayloadSummary: providerResult.summary,
        providerCallBudget: getProviderBudgetSummary(),
        providerCallsUsed: getProviderCallsUsedSummary(),
        polygonLiveEnabled: POLYGON_LIVE_ENABLED,
      };
    } catch (error) {
      providerErrors.push(
        providerError(
          liveProvider.provider,
          error instanceof Error ? error.message : "UNKNOWN_ERROR",
        ),
      );
    }
  }

  providerPriorityTried.push("YFINANCE_COMPOSITE_PROXY");

  return {
    candles: [],
    providerPriorityTried,
    providerErrors,
    archiveLookupTried,
    archiveProviderChecked,
    archiveHitProvider: null,
    providerCallBudget: getProviderBudgetSummary(),
    providerCallsUsed: getProviderCallsUsedSummary(),
    polygonLiveEnabled: POLYGON_LIVE_ENABLED,
  };
}
