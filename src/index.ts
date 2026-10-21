import { loadConfig } from "./config.js";

const config = loadConfig();

console.log(
  JSON.stringify(
    {
      app: "dlmm-ai-agent",
      status: "initialized",
      mode: config.tradingMode,
      onchainExecution: config.enableOnchainExecution,
      logLevel: config.logLevel
    },
    null,
    2
  )
);
