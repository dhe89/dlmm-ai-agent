import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Render deployment manifest", () => {
  it("uses the built dashboard, safe health probe, and persistent paper-state mount", async () => {
    const manifest = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(manifest).toContain("name: dlmm-ai-agent-dashboard");
    expect(manifest).toContain("buildCommand: npm install --no-audit --no-fund && npm run build");
    expect(manifest).toContain("startCommand: node dist/paper-dashboard.js");
    expect(manifest).toContain("healthCheckPath: /api/health");
    expect(manifest).toContain("plan: starter");
    expect(manifest).toContain("mountPath: /var/data");
    expect(manifest).toContain("value: /var/data/paper-portfolio.json");
    expect(manifest).toContain("key: PAPER_DASHBOARD_USERNAME");
    expect(manifest).toContain("key: PAPER_DASHBOARD_PASSWORD");
    expect(packageJson.scripts?.build).toBe("tsc -p tsconfig.json");
  });

  it("does not describe the persistent-disk service as a free plan", async () => {
    const manifest = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
    expect(manifest).not.toMatch(/^\s+plan: free\s*$/m);
    expect(manifest).toContain("disk:");
  });
});
