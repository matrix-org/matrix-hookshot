import { describe, expect, it } from "vitest";
import { resolveOpenProjectCommand } from "../../src/openproject/CommandRouting";

const roomOne = [
  { projectId: 1, routingPrefix: "!op dev-large-child" },
  { projectId: 2, routingPrefix: "!op support" },
  { projectId: 3, routingPrefix: "!openproject" },
];

describe("OpenProject command routing", () => {
  it("selects the longest project prefix before a bare prefix", () => {
    expect(
      resolveOpenProjectCommand(roomOne, "!op dev-large-child close 42"),
    ).toEqual({
      connection: roomOne[0],
      commandText: "close 42",
      prefix: "!op dev-large-child",
      isShorthand: false,
    });
  });

  it.each(["!op", "!openproject"])(
    "routes a %s reply to its project even with another bare connection",
    (prefix) => {
      expect(
        resolveOpenProjectCommand(roomOne, `${prefix} close 42`, 1),
      ).toEqual({
        connection: roomOne[0],
        commandText: "close 42",
        prefix,
        isShorthand: true,
      });
    },
  );

  it("does not route a reply to a project absent from the room", () => {
    expect(
      resolveOpenProjectCommand(roomOne, "!op close 42", 99),
    ).toBeUndefined();
    expect(resolveOpenProjectCommand(roomOne, "!op close 42")).toBeUndefined();
  });

  it("does not guess when two project prefixes are identical", () => {
    const duplicate = [
      { projectId: 1, routingPrefix: "!op team" },
      { projectId: 2, routingPrefix: "!op team" },
    ];
    expect(
      resolveOpenProjectCommand(duplicate, "!op team close 42"),
    ).toBeUndefined();
  });
});
