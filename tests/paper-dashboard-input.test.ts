import { describe, expect, it } from "vitest";
import { assertJsonContentType } from "../src/paper-dashboard.js";

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
