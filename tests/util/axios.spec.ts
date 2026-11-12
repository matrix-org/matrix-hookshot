import { describe, expect, it } from "vitest";
import { getAxiosErrorStatus } from "../../src/util/axios";

describe("getAxiosErrorStatus", () => {
  it("returns the numeric status from an Axios-style response", () => {
    expect(getAxiosErrorStatus({ response: { status: 409 } })).toBe(409);
  });

  it.each([
    null,
    undefined,
    "error",
    {},
    { response: null },
    { response: {} },
    { response: { status: "409" } },
  ])(
    "returns undefined when the value has no numeric response status",
    (error) => {
      expect(getAxiosErrorStatus(error)).toBeUndefined();
    },
  );
});
