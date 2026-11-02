import { describe, expect, it } from "vitest";
import { MatrixError } from "matrix-bot-sdk";
import { retryMatrixErrorFilter } from "../src/PromiseUtil";

describe("retryMatrixErrorFilter", () => {
  it("does not retry a Matrix client error", () => {
    const error = new MatrixError(
      { errcode: "M_NOT_FOUND", error: "Not found" },
      404,
      {},
    );

    expect(retryMatrixErrorFilter(error)).toBe(false);
  });

  it("uses the retry delay from a Matrix rate limit error", () => {
    const error = new MatrixError(
      {
        errcode: "M_LIMIT_EXCEEDED",
        error: "Too many requests",
        retry_after_ms: 1500,
      },
      429,
      {},
    );

    expect(retryMatrixErrorFilter(error)).toBe(1500);
  });

  it("handles plain objects by status code", () => {
    expect(retryMatrixErrorFilter({ statusCode: 404 })).toBe(false);
    expect(retryMatrixErrorFilter({ statusCode: 429, retryAfterMs: 250 })).toBe(
      250,
    );
    expect(retryMatrixErrorFilter({ statusCode: 429 })).toBe(true);
  });

  it("retries errors without a recognized status code", () => {
    expect(retryMatrixErrorFilter(new Error("Failure"))).toBe(true);
    expect(retryMatrixErrorFilter(null)).toBe(true);
    expect(retryMatrixErrorFilter("Failure")).toBe(true);
  });
});
