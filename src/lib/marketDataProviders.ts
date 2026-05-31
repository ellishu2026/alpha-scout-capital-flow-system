import "server-only";

import type { CapitalFlowDataSource, CapitalFlowQuality } from "@/types/stock";
import type { OhlcvCandle } from "@/lib/capitalFlow";
import {
  getProviderBudget,
  tryConsumeProviderCall,
} from "@/lib/providerUsageLimit";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type ProviderOhlcvResult = {
  candles: OhlcvCandle[];
  providerUsed: CapitalFlowDataSource;
  quality: CapitalFlowQuality;
  providerCallBudget: {
    polygon: ReturnType<typeof getProviderBudget>;
    alphaVantage: ReturnType<typeof getProviderBudget>;
  };
  providerCallsUsed: {
    polygon: number;
    alphaVantage: number;
  };
};

export function getProviderBudgetSummary() {
  const polygon = getProviderBudget("POLYGON");
  const alphaVantage = getProviderBudget("ALPHA_VANTAGE");

  return {
    polygon,
    alphaVantage,
  };
}

function toDate(value: string) {
  const date = new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
}

async function fetchPolygonCandles(symbol: string) {
  const apiKey = process.env.POLYGON_API_KEY;

  if (!apiKey || !tryConsumeProviderCall("POLYGON")) {
    return null;
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
    return null;
  }

  const payload = (await response.json()) as {
    results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
  };

  return (
    payload.results?.map((row) => ({
      date: new Date(row.t),
      open: row.o,
      high: row.h,
      low: row.l,
      close: row.c,
      volume: row.v,
    })) ?? null
  );
}

async function fetchAlphaVantageCandles(symbol: string) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey || !tryConsumeProviderCall("ALPHA_VANTAGE")) {
    return null;
  }

  const response = await fetch(
    `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(
      symbol,
    )}&outputsize=compact&apikey=${apiKey}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    ["Time Series (Daily)"]?: Record<
      string,
      {
        ["1. open"]: string;
        ["2. high"]: string;
        ["3. low"]: string;
        ["4. close"]: string;
        ["6. volume"]: string;
      }
    >;
  };
  const rows = payload["Time Series (Daily)"];

  if (!rows) {
    return null;
  }

  return Object.entries(rows)
    .map<OhlcvCandle | null>(([dateText, row]) => {
      const date = toDate(dateText);

      return date
        ? {
            date,
            open: Number(row["1. open"]),
            high: Number(row["2. high"]),
            low: Number(row["3. low"]),
            close: Number(row["4. close"]),
            volume: Number(row["6. volume"]),
          }
        : null;
    })
    .filter((row): row is OhlcvCandle => row != null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export async function archiveMarketDataIfPossible({
  ticker,
  provider,
  candles,
}: {
  ticker: string;
  provider: CapitalFlowDataSource;
  candles: OhlcvCandle[];
}) {
  if (provider !== "ALPHA_VANTAGE" && provider !== "POLYGON") {
    return { archived: false, reason: "PROXY_PROVIDER" };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return { archived: false, reason: "SUPABASE_UNAVAILABLE" };
  }

  try {
    const { error } = await supabase.from("alpha_scout_market_data_archive").insert({
      ticker,
      provider,
      data_date: new Date().toISOString().slice(0, 10),
      payload: candles,
    });

    if (error) {
      return { archived: false, reason: error.message };
    }

    return { archived: true };
  } catch (error) {
    return {
      archived: false,
      reason: error instanceof Error ? error.message : "ARCHIVE_FAILED",
    };
  }
}

export async function fetchProviderCandles(symbol: string): Promise<ProviderOhlcvResult | null> {
  const polygonCandles = await fetchPolygonCandles(symbol);

  if (polygonCandles?.length) {
    await archiveMarketDataIfPossible({
      ticker: symbol,
      provider: "POLYGON",
      candles: polygonCandles,
    });

    return {
      candles: polygonCandles,
      providerUsed: "POLYGON",
      quality: "REAL_PROVIDER",
      providerCallBudget: getProviderBudgetSummary(),
      providerCallsUsed: {
        polygon: getProviderBudget("POLYGON").callsUsed,
        alphaVantage: getProviderBudget("ALPHA_VANTAGE").callsUsed,
      },
    };
  }

  const alphaVantageCandles = await fetchAlphaVantageCandles(symbol);

  if (alphaVantageCandles?.length) {
    await archiveMarketDataIfPossible({
      ticker: symbol,
      provider: "ALPHA_VANTAGE",
      candles: alphaVantageCandles,
    });

    return {
      candles: alphaVantageCandles,
      providerUsed: "ALPHA_VANTAGE",
      quality: "REAL_PROVIDER",
      providerCallBudget: getProviderBudgetSummary(),
      providerCallsUsed: {
        polygon: getProviderBudget("POLYGON").callsUsed,
        alphaVantage: getProviderBudget("ALPHA_VANTAGE").callsUsed,
      },
    };
  }

  return null;
}
