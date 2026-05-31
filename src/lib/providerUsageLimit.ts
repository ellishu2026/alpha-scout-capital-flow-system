export const ALPHA_VANTAGE_DAILY_CALL_LIMIT = 20;
export const POLYGON_DAILY_CALL_LIMIT = 20;

type ProviderName = "ALPHA_VANTAGE" | "POLYGON";

const usageByProvider = new Map<ProviderName, number>();

export function getProviderLimit(provider: ProviderName) {
  return provider === "ALPHA_VANTAGE"
    ? ALPHA_VANTAGE_DAILY_CALL_LIMIT
    : POLYGON_DAILY_CALL_LIMIT;
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
