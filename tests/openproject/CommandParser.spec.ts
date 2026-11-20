import { describe, expect, it } from "vitest";
import type { MatrixMessageContent } from "../../src/MatrixEvent";
import { CommandError } from "../../src/Errors";
import {
  getProjectIdFromReplyContent,
  getWorkPackageIdFromReply,
  normalizeAssignmentMention,
  parseAssignmentCommandArguments,
  parseWorkPackageId,
} from "../../src/openproject/CommandParser";

const PROJECT_KEY = "org.matrix.matrix-hookshot.openproject.project";
const WORK_PACKAGE_KEY = "org.matrix.matrix-hookshot.openproject.work_package";

function createReply(
  overrides: {
    type?: string;
    workPackageId?: unknown;
    projectId?: unknown;
  } = {},
) {
  return {
    type: overrides.type ?? "m.room.message",
    content: {
      [PROJECT_KEY]: {
        id: Object.hasOwn(overrides, "projectId") ? overrides.projectId : 7,
      },
      [WORK_PACKAGE_KEY]: {
        id: Object.hasOwn(overrides, "workPackageId")
          ? overrides.workPackageId
          : 42,
      },
    },
  };
}

function createMessageContent(
  overrides: Partial<MatrixMessageContent> & Record<string, unknown>,
): MatrixMessageContent {
  return {
    msgtype: "m.text",
    body: "!op assign Alice",
    ...overrides,
  } as MatrixMessageContent;
}

describe("OpenProject command parser", () => {
  describe("parseWorkPackageId", () => {
    it("accepts a positive decimal integer", () => {
      expect(parseWorkPackageId("12345")).toBe(12345);
    });

    it.each(["", "0", "-1", "1.5", " 1", "9007199254740992"])(
      "rejects invalid ID %s",
      (id) => {
        expect(() => parseWorkPackageId(id)).toThrow("Invalid work package ID");
      },
    );
  });

  describe("reply metadata", () => {
    it("reads only positive safe project IDs", () => {
      expect(getProjectIdFromReplyContent({ [PROJECT_KEY]: { id: 7 } })).toBe(
        7,
      );
      expect(getProjectIdFromReplyContent(null)).toBeUndefined();
      expect(
        getProjectIdFromReplyContent({
          [PROJECT_KEY]: { id: Number.MAX_SAFE_INTEGER + 1 },
        }),
      ).toBeUndefined();
      expect(
        getProjectIdFromReplyContent({ [PROJECT_KEY]: { id: 0 } }),
      ).toBeUndefined();
    });

    it("resolves a work package only for a valid reply in this project", () => {
      expect(getWorkPackageIdFromReply(createReply(), 7)).toBe(42);
      expect(getWorkPackageIdFromReply(undefined, 7)).toBeUndefined();
      expect(
        getWorkPackageIdFromReply(createReply({ projectId: 8 }), 7),
      ).toBeUndefined();
    });

    it.each([
      ["a non-message event", createReply({ type: "m.room.encrypted" })],
      ["a missing work package ID", createReply({ workPackageId: undefined })],
      [
        "an invalid work package ID",
        createReply({ workPackageId: Number.MAX_SAFE_INTEGER + 1 }),
      ],
      [
        "missing project metadata",
        { type: "m.room.message", content: { [WORK_PACKAGE_KEY]: { id: 42 } } },
      ],
    ])("rejects a reply with %s", (_description, reply) => {
      expect(() => getWorkPackageIdFromReply(reply, 7)).toThrow(
        "Did not reference a hookshot event",
      );
    });
  });

  describe("normalizeAssignmentMention", () => {
    it("replaces a matching trailing user pill with its Matrix ID", () => {
      const content = createMessageContent({
        body: "!op assign Alice",
        format: "org.matrix.custom.html",
        formatted_body:
          '!op assign <a href="https://matrix.to/#/@alice:example.org">Alice</a>',
        "m.mentions": { user_ids: ["@alice:example.org"] },
      });

      expect(normalizeAssignmentMention(content)).toBe(
        "!op assign @alice:example.org",
      );
    });

    it.each([
      [
        "multiple mentions",
        { user_ids: ["@alice:example.org", "@bob:example.org"] },
      ],
      ["an invalid Matrix ID", { user_ids: ["alice"] }],
      ["no mention metadata", undefined],
    ])("leaves the body unchanged with %s", (_description, mentions) => {
      const content = createMessageContent({
        format: "org.matrix.custom.html",
        formatted_body:
          '!op assign <a href="https://matrix.to/#/@alice:example.org">Alice</a>',
        ...(mentions === undefined ? {} : { "m.mentions": mentions }),
      });

      expect(normalizeAssignmentMention(content)).toBe(content.body);
    });

    it.each([
      [
        "formatted text that differs from the body",
        "!op assign Bob",
        '!op assign <a href="https://matrix.to/#/@alice:example.org">Alice</a>',
      ],
      [
        "a pill that is not the trailing argument",
        "!op assign Alice extra",
        '!op assign <a href="https://matrix.to/#/@alice:example.org">Alice</a> extra',
      ],
    ])("does not rewrite %s", (_description, body, formattedBody) => {
      const content = createMessageContent({
        body,
        format: "org.matrix.custom.html",
        formatted_body: formattedBody,
        "m.mentions": { user_ids: ["@alice:example.org"] },
      });

      expect(normalizeAssignmentMention(content)).toBe(body);
    });
  });

  describe("parseAssignmentCommandArguments", () => {
    it("parses an explicit ID and joins a multiword user name", () => {
      expect(
        parseAssignmentCommandArguments({
          kind: "explicit_id",
          workPackageIdArgument: "42",
          userParts: ["Ada", undefined, "Lovelace"],
        }),
      ).toEqual({ workPackageId: 42, requestedUser: "Ada Lovelace" });
    });

    it("uses the replied-to ID and joins reply shorthand user parts", () => {
      expect(
        parseAssignmentCommandArguments({
          kind: "reply",
          workPackageId: 42,
          userParts: ["Ada", "Lovelace"],
        }),
      ).toEqual({ workPackageId: 42, requestedUser: "Ada Lovelace" });
    });

    it("leaves the requested user undefined when no user is supplied", () => {
      expect(
        parseAssignmentCommandArguments({
          kind: "reply",
          workPackageId: 42,
          userParts: [undefined, undefined],
        }),
      ).toEqual({ workPackageId: 42, requestedUser: undefined });
    });

    it("rejects an explicit command without an ID", () => {
      expect(() =>
        parseAssignmentCommandArguments({
          kind: "explicit_id",
          userParts: [],
        }),
      ).toThrow(CommandError);
    });
  });
});
