import { describe, expect, it, vi } from "vitest";
import type { MatrixEvent } from "matrix-bot-sdk";
import { CommandError } from "../../src/Errors";
import type { OpenProjectAPIClient } from "../../src/openproject/Client";
import { OpenProjectWorkPackageCommandService } from "../../src/openproject/WorkPackageCommands";
import type { OpenProjectWorkPackageCommandContext } from "../../src/openproject/WorkPackageCommands";
import type {
  OpenProjectEligibilityConnection,
  OpenProjectMarkDoneCommandResult,
  OpenProjectEligibilityService,
} from "../../src/openproject/Eligibility";
import type { UserTokenStore } from "../../src/tokens/UserTokenStore";
import { BASE_URL, WORK_PACKAGE } from "./WorkPackageFixtures";

const CLOSED_STATUS = {
  id: 9,
  name: "Done",
  isClosed: true,
  _links: { self: { href: "/api/v3/statuses/9" } },
};

function createHarness() {
  const getTypesInProject = vi
    .fn()
    .mockResolvedValue([WORK_PACKAGE._embedded.type]);
  const createWorkPackage = vi.fn().mockResolvedValue(WORK_PACKAGE);
  const getStatuses = vi.fn().mockResolvedValue([CLOSED_STATUS]);
  const getWorkPackage = vi.fn().mockResolvedValue({
    ...WORK_PACKAGE,
    lockVersion: 8,
  });
  const updateWorkPackage = vi.fn().mockResolvedValue(WORK_PACKAGE);
  const addWorkPackageComment = vi.fn().mockResolvedValue(undefined);
  const client = {
    getTypesInProject,
    createWorkPackage,
    getStatuses,
    getWorkPackage,
    updateWorkPackage,
    addWorkPackageComment,
  } as unknown as OpenProjectAPIClient;
  const getOpenProjectForUser = vi.fn().mockResolvedValue(client);
  const getCompletionStatusOptionId = vi.fn(
    (): string | undefined => undefined,
  );
  const getWorkPackageIDFromReply = vi.fn((): number | undefined => undefined);
  const executeMarkDoneCommand = vi.fn(
    async (
      _userId: string,
      _context: OpenProjectEligibilityConnection,
      workPackageId: number,
      _comment?: string,
    ): Promise<OpenProjectMarkDoneCommandResult> =>
      !Number.isSafeInteger(workPackageId) || workPackageId <= 0
        ? { status: "ineligible", reason: "invalid_work_package_id" }
        : {
            status: "eligible",
            action: "mark_done",
            workPackageId,
            lockVersion: 8,
            targetHref: CLOSED_STATUS._links.self.href,
          },
  );
  const context = {
    projectId: WORK_PACKAGE._embedded.project.id,
    interestedInProject: vi.fn(() => true),
    baseURL: BASE_URL,
    tokenStore: { getOpenProjectForUser } as unknown as UserTokenStore,
    getCompletionStatusOptionId,
    getWorkPackageIDFromReply,
  } as unknown as OpenProjectWorkPackageCommandContext;
  const eligibilityService = {
    executeAssignment: vi.fn(),
    executeMarkDoneCommand,
  } as unknown as OpenProjectEligibilityService;
  const service = new OpenProjectWorkPackageCommandService(
    context,
    eligibilityService,
  );

  return {
    service,
    context,
    client,
    getOpenProjectForUser,
    getCompletionStatusOptionId,
    getTypesInProject,
    createWorkPackage,
    getStatuses,
    getWorkPackage,
    updateWorkPackage,
    addWorkPackageComment,
    getWorkPackageIDFromReply,
    executeMarkDoneCommand,
  };
}

function createReply(type: string, body: string): MatrixEvent<unknown> {
  return { type, content: { body } } as MatrixEvent<unknown>;
}

describe("OpenProjectWorkPackageCommandService", () => {
  describe("createWorkPackage", () => {
    it("combines a command description with a replied-to message", async () => {
      const { service, getTypesInProject, createWorkPackage } = createHarness();

      await service.createWorkPackage(
        "@alice:example.org",
        createReply("m.room.message", "Context from the room"),
        WORK_PACKAGE._embedded.type.name.toLowerCase(),
        "A new task",
        "Please investigate",
      );

      expect(getTypesInProject).toHaveBeenCalledWith(
        WORK_PACKAGE._embedded.project.id,
      );
      expect(createWorkPackage).toHaveBeenCalledWith(
        WORK_PACKAGE._embedded.project.id,
        WORK_PACKAGE._embedded.type,
        "A new task",
        "Please investigate\n\nContext from the room",
      );
    });

    it.each([
      ["a non-message event", createReply("m.room.encrypted", "text")],
      ["a message without a body", createReply("m.room.message", "  ")],
    ])(
      "rejects %s before looking up work package types",
      async (_description, reply) => {
        const { service, getTypesInProject, createWorkPackage } =
          createHarness();

        await expect(
          service.createWorkPackage(
            "@alice:example.org",
            reply,
            "Milestone",
            "A new task",
          ),
        ).rejects.toThrow(CommandError);

        expect(getTypesInProject).not.toHaveBeenCalled();
        expect(createWorkPackage).not.toHaveBeenCalled();
      },
    );

    it("reports available types and does not create an unknown type", async () => {
      const { service, createWorkPackage } = createHarness();

      await expect(
        service.createWorkPackage(
          "@alice:example.org",
          undefined,
          "Unknown",
          "A new task",
        ),
      ).rejects.toMatchObject({
        message: "Type not understood",
        humanError: expect.stringContaining("Milestone"),
      });

      expect(createWorkPackage).not.toHaveBeenCalled();
    });
  });

  describe("closeWorkPackage", () => {
    it("delegates closing to the execution service without another client lookup", async () => {
      const {
        service,
        context,
        executeMarkDoneCommand,
        getOpenProjectForUser,
        getStatuses,
        getWorkPackage,
      } = createHarness();

      await service.closeWorkPackage(
        "@alice:example.org",
        undefined,
        String(WORK_PACKAGE.id),
      );

      expect(executeMarkDoneCommand).toHaveBeenCalledWith(
        "@alice:example.org",
        context,
        WORK_PACKAGE.id,
        undefined,
      );
      expect(getOpenProjectForUser).not.toHaveBeenCalled();
      expect(getStatuses).not.toHaveBeenCalled();
      expect(getWorkPackage).not.toHaveBeenCalled();
    });

    it("uses the work package from a reply and treats the first argument as a comment", async () => {
      const {
        service,
        executeMarkDoneCommand,
        updateWorkPackage,
        addWorkPackageComment,
        getWorkPackageIDFromReply,
      } = createHarness();
      getWorkPackageIDFromReply.mockReturnValue(73);
      const reply = createReply("m.room.message", "Work package card");

      await service.closeWorkPackage(
        "@alice:example.org",
        reply,
        "Closing note added",
      );

      expect(getWorkPackageIDFromReply).toHaveBeenCalledWith(reply);
      expect(executeMarkDoneCommand).toHaveBeenCalledWith(
        "@alice:example.org",
        expect.anything(),
        73,
        "Closing note added",
      );
      expect(updateWorkPackage).not.toHaveBeenCalled();
      expect(addWorkPackageComment).not.toHaveBeenCalled();
    });

    it.each(["12abc", "1.2", "-2", "0", "9007199254740992"])(
      "rejects invalid explicit work package ID %s",
      async (id) => {
        const { service, executeMarkDoneCommand, updateWorkPackage } =
          createHarness();

        await expect(
          service.closeWorkPackage("@alice:example.org", undefined, id),
        ).rejects.toMatchObject({ message: "Invalid work package ID" });
        if (/^\d+$/.test(id)) {
          expect(executeMarkDoneCommand).toHaveBeenCalledOnce();
        } else {
          expect(executeMarkDoneCommand).not.toHaveBeenCalled();
        }
        expect(updateWorkPackage).not.toHaveBeenCalled();
      },
    );

    it.each([
      [
        { status: "ineligible", reason: "already_closed" },
        "Work package already closed",
      ],
      [
        { status: "ineligible", reason: "target_not_allowed" },
        "Completion status not allowed",
      ],
      [
        { status: "stale_target", reason: "configured_status_open" },
        "Configured completion status is unavailable",
      ],
      [
        { status: "stale_target", reason: "default_status_ambiguous" },
        "Completion status must be configured",
      ],
      [{ status: "conflict" }, "Work package changed"],
      [
        { status: "not_authorized", reason: "wrong_project" },
        "Work package belongs to another project",
      ],
      [
        { status: "unavailable", reason: "openproject_error" },
        "OpenProject unavailable",
      ],
    ] as const)(
      "maps evaluator result %j to a safe command error",
      async (result, message) => {
        const { service, executeMarkDoneCommand, updateWorkPackage } =
          createHarness();
        executeMarkDoneCommand.mockResolvedValue(result);

        await expect(
          service.closeWorkPackage(
            "@alice:example.org",
            undefined,
            String(WORK_PACKAGE.id),
          ),
        ).rejects.toMatchObject({ message });
        expect(updateWorkPackage).not.toHaveBeenCalled();
      },
    );

    it("preserves multiword explicit-ID comments", async () => {
      const { service, executeMarkDoneCommand } = createHarness();

      await service.closeWorkPackage(
        "@alice:example.org",
        undefined,
        String(WORK_PACKAGE.id),
        "Resolved in the release",
      );

      expect(executeMarkDoneCommand).toHaveBeenCalledWith(
        "@alice:example.org",
        expect.anything(),
        WORK_PACKAGE.id,
        "Resolved in the release",
      );
    });

    it("reports a comment failure after the close succeeds", async () => {
      const { service, executeMarkDoneCommand } = createHarness();
      executeMarkDoneCommand.mockResolvedValueOnce({
        status: "comment_failed",
      });

      await expect(
        service.closeWorkPackage(
          "@alice:example.org",
          undefined,
          String(WORK_PACKAGE.id),
          "Closing note",
        ),
      ).rejects.toMatchObject({
        message: "Work package closed but comment failed",
        humanError: expect.stringContaining("was closed"),
      });
      expect(executeMarkDoneCommand).toHaveBeenCalledWith(
        "@alice:example.org",
        expect.anything(),
        WORK_PACKAGE.id,
        "Closing note",
      );
    });
  });
});
