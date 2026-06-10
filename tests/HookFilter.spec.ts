import { describe, it, beforeEach, expect } from "vitest";
import { HookFilter } from "../src/HookFilter";

const DEFAULT_SET = ["default-allowed", "default-allowed-but-ignored"];
const ENABLED_SET = ["enabled-hook", "enabled-but-ignored"];

describe("HookFilter", () => {
  let filter: HookFilter<string>;

  beforeEach(() => {
    filter = new HookFilter(ENABLED_SET);
  });

  describe("shouldSkip", () => {
    it("should allow a hook named in enabled set", () => {
      expect(filter.shouldSkip("enabled-hook")).toBe(false);
    });

    it("should not allow a hook not named in enabled set", () => {
      expect(filter.shouldSkip("not-enabled-hook")).toBe(true);
    });
  });

  describe("convertIgnoredHooksToEnabledHooks", () => {
    it("should correctly provide a list of default hooks", () => {
      const result = HookFilter.convertIgnoredHooksToEnabledHooks([], [], DEFAULT_SET);
      expect(result).toEqual(expect.arrayContaining(DEFAULT_SET));
      expect(result).toHaveLength(DEFAULT_SET.length);
    });

    it("should correctly include default and enabled hooks when ignored hooks is set", () => {
      const combined = [...ENABLED_SET, ...DEFAULT_SET];
      const result = HookFilter.convertIgnoredHooksToEnabledHooks(
        ENABLED_SET,
        ["my-ignored-hook"],
        DEFAULT_SET,
      );
      expect(result).toEqual(expect.arrayContaining(combined));
      expect(result).toHaveLength(combined.length);
    });

    it("should deduplicate", () => {
      const result = HookFilter.convertIgnoredHooksToEnabledHooks(
        DEFAULT_SET,
        [],
        DEFAULT_SET,
      );
      expect(result).toEqual(expect.arrayContaining(DEFAULT_SET));
      expect(result).toHaveLength(DEFAULT_SET.length);
    });

    it("should correctly exclude ignored hooks", () => {
      const result = HookFilter.convertIgnoredHooksToEnabledHooks(
        [],
        [DEFAULT_SET[0]],
        DEFAULT_SET,
      );
      expect(result).not.toContain([DEFAULT_SET[0]]);
    });

    it("should handle ignored root hooks", () => {
      const defaultHooks = ["myhook", "myhook.foo", "myhook.foo.bar"];

      const result1 = HookFilter.convertIgnoredHooksToEnabledHooks(
        [],
        ["myhook.foo.bar"],
        defaultHooks,
      );
      expect(result1).toEqual(expect.arrayContaining(["myhook", "myhook.foo"]));
      expect(result1).toHaveLength(2);

      const result2 = HookFilter.convertIgnoredHooksToEnabledHooks(
        [],
        ["myhook.foo"],
        defaultHooks,
      );
      expect(result2).toEqual(expect.arrayContaining(["myhook"]));
      expect(result2).toHaveLength(1);

      expect(
        HookFilter.convertIgnoredHooksToEnabledHooks(
          [],
          ["myhook"],
          defaultHooks,
        ),
      ).toHaveLength(0);
    });
  });
});
