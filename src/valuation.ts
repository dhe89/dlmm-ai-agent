export type EvidenceStatus = "measured" | "sourced" | "estimated" | "unavailable";
export type RangeStatus = "in-range" | "out-of-range" | "unknown";

export interface TokenInventory {
  /** Human-readable token quantities, after applying the mint's decimals. */
  amountX: number;
  amountY: number;
  /** USD mark prices for each token; never infer these from the pool pair price. */
  tokenXPriceUsd: number;
  tokenYPriceUsd: number;
  /** USD cost basis allocated to the current inventory. */
  costBasisUsd: number;
  /** Timestamp for the inventory and price marks. */
  capturedAt: string;
}

export interface ValuationInput {
  inventory: TokenInventory;
  now?: string;
  maxAgeMs?: number;
  rangeStatus?: RangeStatus;
  /** Fees actually observed/accrued for this position in USD. */
  feesUsd?: { value: number; evidence: Exclude<EvidenceStatus, "unavailable"> };
  /** Costs may be measured/sourced or estimated; omit if unknown. */
  executionCostsUsd?: { value: number; evidence: Exclude<EvidenceStatus, "unavailable"> };
  networkCostsUsd?: { value: number; evidence: Exclude<EvidenceStatus, "unavailable"> };
}

export interface RawTokenFees {
  /** Fee amounts in raw base units, e.g. lamports or token smallest units. */
  feeXRaw: string;
  feeYRaw: string;
  tokenXDecimals: number;
  tokenYDecimals: number;
  tokenXPriceUsd: number;
  tokenYPriceUsd: number;
  evidence: Exclude<EvidenceStatus, "unavailable">;
}

export interface FeeValueUsd {
  feeXTokens: number;
  feeYTokens: number;
  feesUsd: number;
  evidence: Exclude<EvidenceStatus, "unavailable">;
}

export interface ValuationResult {
  status: "available" | "stale" | "unavailable";
  capturedAt: string;
  ageMs?: number;
  rangeStatus: RangeStatus;
  inventoryValueUsd?: number;
  inventoryPnlUsd?: number;
  feesUsd?: number;
  executionCostsUsd?: number;
  networkCostsUsd?: number;
  netPnlUsd?: number;
  evidence: {
    inventory: EvidenceStatus;
    fees: EvidenceStatus;
    executionCosts: EvidenceStatus;
    networkCosts: EvidenceStatus;
    netPnl: EvidenceStatus;
  };
  unavailableReasons: string[];
}

function finiteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
}

function validTimestamp(value: string, name: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a valid timestamp`);
  return parsed;
}

function validateCost(
  cost: { value: number; evidence: Exclude<EvidenceStatus, "unavailable"> } | undefined,
  name: string
): void {
  if (cost) {
    finiteNonNegative(cost.value, name);
    if (!["measured", "sourced", "estimated"].includes(cost.evidence)) {
      throw new Error(`${name} evidence status is invalid`);
    }
  }
}

function parseRawAmount(value: string, name: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer string in base units`);
  }
  return BigInt(value);
}

/**
 * Convert authoritative raw fee amounts to USD. This only values fee amounts
 * that have already been sourced for the relevant position; it does not estimate
 * fee accrual from pool APR or bin liquidity.
 */
export function valueRawTokenFeesUsd(input: RawTokenFees): FeeValueUsd {
  const { tokenXDecimals, tokenYDecimals, tokenXPriceUsd, tokenYPriceUsd } = input;
  if (!Number.isInteger(tokenXDecimals) || tokenXDecimals < 0 || tokenXDecimals > 30) {
    throw new Error("tokenXDecimals must be an integer between 0 and 30");
  }
  if (!Number.isInteger(tokenYDecimals) || tokenYDecimals < 0 || tokenYDecimals > 30) {
    throw new Error("tokenYDecimals must be an integer between 0 and 30");
  }
  finiteNonNegative(tokenXPriceUsd, "tokenXPriceUsd");
  finiteNonNegative(tokenYPriceUsd, "tokenYPriceUsd");
  if (!["measured", "sourced", "estimated"].includes(input.evidence)) {
    throw new Error("fee evidence status is invalid");
  }

  // BigInt validation prevents accepting malformed raw quantities. Convert only
  // after decimal scaling; USD output necessarily uses JavaScript number precision.
  const rawX = parseRawAmount(input.feeXRaw, "feeXRaw");
  const rawY = parseRawAmount(input.feeYRaw, "feeYRaw");
  const feeXTokens = Number(rawX) / 10 ** tokenXDecimals;
  const feeYTokens = Number(rawY) / 10 ** tokenYDecimals;
  const feesUsd = feeXTokens * tokenXPriceUsd + feeYTokens * tokenYPriceUsd;
  if (![feeXTokens, feeYTokens, feesUsd].every(Number.isFinite)) {
    throw new Error("Fee valuation exceeds supported numeric range");
  }
  return { feeXTokens, feeYTokens, feesUsd, evidence: input.evidence };
}

/**
 * Conservative paper valuation only. Quantities must already be decimal-adjusted,
 * and both token prices must be independently denominated in USD.
 * Unknown fees/costs are never silently treated as zero.
 */
export function valueInventory(input: ValuationInput): ValuationResult {
  const { inventory } = input;
  finiteNonNegative(inventory.amountX, "amountX");
  finiteNonNegative(inventory.amountY, "amountY");
  finiteNonNegative(inventory.tokenXPriceUsd, "tokenXPriceUsd");
  finiteNonNegative(inventory.tokenYPriceUsd, "tokenYPriceUsd");
  finiteNonNegative(inventory.costBasisUsd, "costBasisUsd");
  validateCost(input.feesUsd, "feesUsd");
  validateCost(input.executionCostsUsd, "executionCostsUsd");
  validateCost(input.networkCostsUsd, "networkCostsUsd");

  const capturedMs = validTimestamp(inventory.capturedAt, "capturedAt");
  const nowMs = validTimestamp(input.now ?? new Date().toISOString(), "now");
  const maxAgeMs = input.maxAgeMs ?? 60_000;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) throw new Error("maxAgeMs must be finite and non-negative");
  const ageMs = nowMs - capturedMs;
  const rangeStatus = input.rangeStatus ?? "unknown";

  if (ageMs < 0) throw new Error("capturedAt must not be in the future");

  const base = {
    capturedAt: inventory.capturedAt,
    ageMs,
    rangeStatus,
    evidence: {
      inventory: "sourced" as EvidenceStatus,
      fees: (input.feesUsd?.evidence ?? "unavailable") as EvidenceStatus,
      executionCosts: (input.executionCostsUsd?.evidence ?? "unavailable") as EvidenceStatus,
      networkCosts: (input.networkCostsUsd?.evidence ?? "unavailable") as EvidenceStatus,
      netPnl: "unavailable" as EvidenceStatus
    }
  };

  if (ageMs > maxAgeMs) {
    return {
      ...base,
      status: "stale",
      evidence: { ...base.evidence, inventory: "unavailable" },
      unavailableReasons: ["Inventory or price marks are stale"]
    };
  }

  const inventoryValueUsd =
    inventory.amountX * inventory.tokenXPriceUsd +
    inventory.amountY * inventory.tokenYPriceUsd;
  const inventoryPnlUsd = inventoryValueUsd - inventory.costBasisUsd;
  if (![inventoryValueUsd, inventoryPnlUsd].every(Number.isFinite)) {
    throw new Error("Inventory valuation exceeds supported numeric range");
  }

  const unavailableReasons: string[] = [];
  if (!input.feesUsd) unavailableReasons.push("Position-specific accrued fees are unavailable");
  if (!input.executionCostsUsd) unavailableReasons.push("Execution costs are unavailable");
  if (!input.networkCostsUsd) unavailableReasons.push("Network costs are unavailable");

  const result: ValuationResult = {
    ...base,
    status: "available",
    inventoryValueUsd,
    inventoryPnlUsd,
    ...(input.feesUsd ? { feesUsd: input.feesUsd.value } : {}),
    ...(input.executionCostsUsd ? { executionCostsUsd: input.executionCostsUsd.value } : {}),
    ...(input.networkCostsUsd ? { networkCostsUsd: input.networkCostsUsd.value } : {}),
    unavailableReasons
  };

  if (input.feesUsd && input.executionCostsUsd && input.networkCostsUsd) {
    const netPnlUsd =
      inventoryPnlUsd + input.feesUsd.value -
      input.executionCostsUsd.value - input.networkCostsUsd.value;
    if (!Number.isFinite(netPnlUsd)) throw new Error("Net PnL exceeds supported numeric range");
    result.netPnlUsd = netPnlUsd;
    result.evidence.netPnl = [
      input.feesUsd.evidence,
      input.executionCostsUsd.evidence,
      input.networkCostsUsd.evidence
    ].includes("estimated") ? "estimated" : "sourced";
  }

  return result;
}
