export interface AgentConfig {
  nodeEnv: string;
  logLevel: "debug" | "info" | "warn" | "error";
  solanaRpcUrl?: string;
  dataProviderApiKey?: string;
  tradingMode: "paper";
  enableOnchainExecution: false;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("ENABLE_ONCHAIN_EXECUTION must be 'true' or 'false'");
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env
): AgentConfig {
  const tradingMode = env.TRADING_MODE ?? "paper";
  if (tradingMode !== "paper") {
    throw new Error("Only TRADING_MODE=paper is supported in this milestone");
  }

  const enableOnchainExecution = parseBoolean(
    env.ENABLE_ONCHAIN_EXECUTION,
    false
  );
  if (enableOnchainExecution) {
    throw new Error(
      "On-chain execution is disabled in this project milestone"
    );
  }

  const rawLogLevel = env.LOG_LEVEL ?? "info";
  const validLogLevels = ["debug", "info", "warn", "error"] as const;
  if (!validLogLevels.includes(rawLogLevel as (typeof validLogLevels)[number])) {
    throw new Error("LOG_LEVEL must be debug, info, warn, or error");
  }

  return {
    nodeEnv: env.NODE_ENV ?? "development",
    logLevel: rawLogLevel as AgentConfig["logLevel"],
    ...(env.SOLANA_RPC_URL ? { solanaRpcUrl: env.SOLANA_RPC_URL } : {}),
    ...(env.DATA_PROVIDER_API_KEY
      ? { dataProviderApiKey: env.DATA_PROVIDER_API_KEY }
      : {}),
    tradingMode: "paper",
    enableOnchainExecution: false
  };
}
