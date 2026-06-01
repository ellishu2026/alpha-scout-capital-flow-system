function parseDailyLimit(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export const ALPHA_VANTAGE_DAILY_CALL_LIMIT = Math.min(
  parseDailyLimit(process.env.ALPHA_VANTAGE_DAILY_CALL_LIMIT, 20),
  20,
);
export const POLYGON_DAILY_CALL_LIMIT = parseDailyLimit(
  process.env.POLYGON_DAILY_CALL_LIMIT,
  20,
);
export const TWELVE_DATA_DAILY_CALL_LIMIT = parseDailyLimit(
  process.env.TWELVE_DATA_DAILY_CALL_LIMIT,
  60,
);
export const EODHD_DAILY_CALL_LIMIT = parseDailyLimit(
  process.env.EODHD_DAILY_CALL_LIMIT,
  20,
);

type ProviderName = "ALPHA_VANTAGE" | "POLYGON" | "TWELVE_DATA" | "EODHD";

const usageByProvider = new Map<ProviderName, number>();

export function getProviderLimit(provider: ProviderName) {
  if (provider === "ALPHA_VANTAGE") return ALPHA_VANTAGE_DAILY_CALL_LIMIT;
  if (provider === "TWELVE_DATA") return TWELVE_DATA_DAILY_CALL_LIMIT;
  if (provider === "EODHD") return EODHD_DAILY_CALL_LIMIT;

  return POLYGON_DAILY_CALL_LIMIT;
}

export function getProviderCallsUsed(provider: ProviderName) {
  return usageByProvider.get(provider) ?? 0;
}

export function getProviderBudget(provider: ProviderName) {
  const limit = getProviderLimit(provider);
  const callsUsed = getProviderCallsUsed(provider);

  return {
    limit,
    callsUsed,
    remaining: Math.max(0, limit - callsUsed),
  };
}

export function tryConsumeProviderCall(provider: ProviderName) {
  const budget = getProviderBudget(provider);

  if (budget.remaining <= 0) {
    return false;
  }

  usageByProvider.set(provider, budget.callsUsed + 1);

  return true;
}
