import { createRequire } from "node:module";
import { Connection, PublicKey } from "@solana/web3.js";

const require = createRequire(import.meta.url);
const meteoraModule = require("@meteora-ag/dlmm") as {
  default?: unknown;
  DLMM?: unknown;
};
const DLMM = (meteoraModule.default ?? meteoraModule.DLMM ?? meteoraModule) as unknown;

const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";

export interface BinLiquiditySnapshot {
  binId: number;
  price: string;
  amountX: string;
  amountY: string;
  liquiditySupply?: string;
}

export interface ActiveBinSnapshot {
  source: string;
  retrievedAt: string;
  poolAddress: string;
  activeBinId: number;
  activeBinPrice: string;
  binStep: number;
  bins: BinLiquiditySnapshot[];
}

interface MeteoraActiveBin {
  binId: number;
  price: unknown;
}

interface MeteoraBin {
  binId: number;
  price: unknown;
  xAmount?: unknown;
  yAmount?: unknown;
  amountX?: unknown;
  amountY?: unknown;
  liquiditySupply?: unknown;
  liquidity_supply?: unknown;
}

interface MeteoraPoolReader {
  lbPair: { binStep: unknown };
  getActiveBin(): Promise<MeteoraActiveBin>;
  getBinsAroundActiveBin(left: number, right: number): Promise<{ bins: MeteoraBin[] }>;
}

/**
 * The published 1.9.14 declaration can expose the package namespace rather than
 * its default class under NodeNext resolution. Keep the SDK boundary explicit
 * while validating the runtime factory before using it.
 */
const dlmmSdk = DLMM as {
  create?: (
    connection: Connection,
    poolAddress: PublicKey,
    options?: { cluster?: string }
  ) => Promise<MeteoraPoolReader>;
};

function numericId(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Invalid Meteora ${field}`);
  return parsed;
}

function numericString(value: unknown, field: string): string {
  if (value === null || value === undefined) throw new Error(`Missing Meteora ${field}`);
  const result = String(value);
  if (result.trim() === "" || !Number.isFinite(Number(result))) {
    throw new Error(`Invalid Meteora ${field}`);
  }
  return result;
}

/**
 * Read-only on-chain pool/bin inspection through the official Meteora DLMM SDK.
 * This function never creates, signs, or sends transactions.
 */
export async function collectActiveBinSnapshot(
  poolAddress: string,
  options: { rpcUrl?: string; binsEachSide?: number } = {}
): Promise<ActiveBinSnapshot> {
  if (!poolAddress.trim()) throw new Error("poolAddress must not be empty");
  const binsEachSide = options.binsEachSide ?? 10;
  if (!Number.isInteger(binsEachSide) || binsEachSide < 0 || binsEachSide > 70) {
    throw new Error("binsEachSide must be an integer between 0 and 70");
  }

  let publicKey: PublicKey;
  try {
    publicKey = new PublicKey(poolAddress);
  } catch {
    throw new Error("poolAddress must be a valid Solana public key");
  }

  if (typeof dlmmSdk.create !== "function") {
    throw new Error("Installed Meteora DLMM SDK does not expose the expected create() factory");
  }

  const rpcUrl = options.rpcUrl ?? process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
  const connection = new Connection(rpcUrl, "confirmed");
  const pool = await dlmmSdk.create(connection, publicKey, { cluster: "mainnet-beta" });
  const activeBin = await pool.getActiveBin();
  const binWindow = await pool.getBinsAroundActiveBin(binsEachSide, binsEachSide);

  const activeBinId = numericId(activeBin.binId, "active bin ID");
  const bins: BinLiquiditySnapshot[] = binWindow.bins.map((bin) => {
    const amountX = bin.amountX ?? bin.xAmount;
    const amountY = bin.amountY ?? bin.yAmount;
    const liquidity = bin.liquiditySupply ?? bin.liquidity_supply;
    return {
      binId: numericId(bin.binId, "bin ID"),
      price: numericString(bin.price, "bin price"),
      amountX: numericString(amountX, "bin token X amount"),
      amountY: numericString(amountY, "bin token Y amount"),
      ...(liquidity !== undefined && liquidity !== null
        ? { liquiditySupply: numericString(liquidity, "bin liquidity supply") }
        : {})
    };
  }).sort((a, b) => a.binId - b.binId);

  if (!bins.some((bin) => bin.binId === activeBinId)) {
    throw new Error("Meteora bin window did not include the active bin");
  }

  return {
    source: rpcUrl,
    retrievedAt: new Date().toISOString(),
    poolAddress: publicKey.toBase58(),
    activeBinId,
    activeBinPrice: numericString(activeBin.price, "active bin price"),
    binStep: numericId(pool.lbPair.binStep, "bin step"),
    bins
  };
}
