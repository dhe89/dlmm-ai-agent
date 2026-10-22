import { describe, expect, it } from "vitest";
import { assertJsonContentType, getDashboardErrorStatus, requiresDashboardAuthentication } from "../src/paper-dashboard.js";
import { PaperPortfolioPersistenceError } from "../src/paper-portfolio-service.js";

describe("paper dashboard request content type", () => {
  it("accepts JSON with optional charset parameters", () => {
    expect(() => assertJsonContentType("application/json")).not.toThrow();
    expect(() => assertJsonContentType("application/json; charset=utf-8")).not.toThrow();
    expect(() => assertJsonContentType(" Application/JSON ; charset=UTF-8 ")).not.toThrow();
  });

  it("rejects simple form and text content types for portfolio mutations", () => {
    for (const contentType of [undefined, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      expect(() => assertJsonContentType(contentType)).toThrow(/content-type must be application\/json/);
    }
  });
});

describe("paper dashboard authentication routing", () => {
  it("allows only the minimal GET health probe without dashboard authentication", () => {
    expect(requiresDashboardAuthentication("GET", "/api/health")).toBe(false);
    expect(requiresDashboardAuthentication("GET", "/api/portfolio")).toBe(true);
    expect(requiresDashboardAuthentication("GET", "/api/runner-health")).toBe(true);
    expect(requiresDashboardAuthentication("POST", "/api/health")).toBe(true);
  });
});

describe("paper dashboard error status", () => {
  it("distinguishes client validation errors from service failures", () => {
    expect(getDashboardErrorStatus(new Error("invalid request body"), "POST", "/api/portfolio/open")).toBe(400);
    expect(getDashboardErrorStatus(new PaperPortfolioPersistenceError("state unavailable"), "GET", "/api/history")).toBe(503);
    expect(getDashboardErrorStatus(new Error("upstream unavailable"), "GET", "/api/market")).toBe(503);
    expect(getDashboardErrorStatus(new Error("not found"), "GET", "/unknown")).toBe(400);
  });
});
