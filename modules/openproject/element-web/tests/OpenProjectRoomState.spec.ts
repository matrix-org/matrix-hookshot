import { describe, expect, it } from "vitest";
import type { RoomStateEvent } from "@element-hq/element-web-module-api";
import {
  DEFAULT_OPENPROJECT_COMMAND_PREFIX,
  getOpenProjectCommandIndicators,
} from "../src/OpenProjectRoomState";

function state(
  stateKey: string,
  content: Record<string, unknown>,
): RoomStateEvent {
  return { stateKey, content };
}

describe("OpenProject room state", () => {
  it("collects the leading command indicator from each valid enabled connection", () => {
    expect(
      getOpenProjectCommandIndicators([
        state("one", {
          url: "https://openproject.example/projects/one",
          commandPrefix: "!openproject dev-work-package-sharing",
        }),
        state("two", {
          url: "https://openproject.example/projects/two",
          commandPrefix: "!openproject dev-large-child",
        }),
      ]),
    ).toEqual([`${DEFAULT_OPENPROJECT_COMMAND_PREFIX} `]);
  });

  it("does not treat disabled, empty, or malformed state as an integration", () => {
    expect(
      getOpenProjectCommandIndicators([
        state("disabled", {
          url: "https://openproject.example/projects/one",
          disabled: true,
        }),
        state("empty", {}),
        state("missing-url", { commandPrefix: "!valid" }),
        state("bad-protocol", {
          url: "javascript:alert(1)",
          commandPrefix: "!valid",
        }),
        state("bad-prefix", {
          url: "https://openproject.example/projects/two",
          commandPrefix: "!",
        }),
        state("bad-prefix-type", {
          url: "https://openproject.example/projects/three",
          commandPrefix: 4,
        }),
      ]),
    ).toEqual([]);
  });

  it("uses the default only when commandPrefix is absent", () => {
    expect(
      getOpenProjectCommandIndicators([
        state("absent", { url: "https://openproject.example/projects/one" }),
        state("empty", {
          url: "https://openproject.example/projects/two",
          commandPrefix: "",
        }),
      ]),
    ).toEqual([`${DEFAULT_OPENPROJECT_COMMAND_PREFIX} `]);
  });
});
