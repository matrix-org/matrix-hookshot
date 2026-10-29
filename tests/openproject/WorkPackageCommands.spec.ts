import { describe, expect, it, vi } from "vitest";
import type { MatrixEvent } from "matrix-bot-sdk";
import { CommandError } from "../../src/Errors";
import type { OpenProjectAPIClient } from "../../src/openproject/Client";
import { OpenProjectWorkPackageCommandService } from "../../src/openproject/WorkPackageCommands";
import type { OpenProjectWorkPackageCommandContext } from "../../src/openproject/WorkPackageCommands";
import type { OpenProjectEligibilityService } from "../../src/openproject/Eligibility";
import type { UserTokenStore } from "../../src/tokens/UserTokenStore";
import { BASE_URL, WORK_PACKAGE } from "./WorkPackageFixtures";

const CLOSED_STATUS = {
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
  const getWorkPackageIDFromReply = vi.fn((): number | undefined => undefined);
  const context = {
    projectId: WORK_PACKAGE._embedded.project.id,
    interestedInProject: vi.fn(() => true),
    baseURL: BASE_URL,
    tokenStore: { getOpenProjectForUser } as unknown as UserTokenStore,
    getWorkPackageIDFromReply,
  } as unknown as OpenProjectWorkPackageCommandContext;
  const eligibilityService = {
    executeAssignment: vi.fn(),
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
    getTypesInProject,
    createWorkPackage,
    getStatuses,
    getWorkPackage,
    updateWorkPackage,
    addWorkPackageComment,
    getWorkPackageIDFromReply,
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
    it("uses a closed status and adds the optional comment after closing", async () => {
      const { service, updateWorkPackage, addWorkPackageComment } =
        createHarness();

      await service.closeWorkPackage(
        "@alice:example.org",
        undefined,
        String(WORK_PACKAGE.id),
        "Resolved in the release",
      );

      expect(updateWorkPackage).toHaveBeenCalledWith(WORK_PACKAGE.id, 8, {
        _links: { status: { href: CLOSED_STATUS._links.self.href } },
      });
      expect(addWorkPackageComment).toHaveBeenCalledWith(
        WORK_PACKAGE.id,
        "Resolved in the release",
      );
      expect(updateWorkPackage.mock.invocationCallOrder[0]).toBeLessThan(
        addWorkPackageComment.mock.invocationCallOrder[0],
      );
    });

    it("uses the work package from a reply and treats the first argument as a comment", async () => {
      const {
        service,
        getWorkPackage,
        updateWorkPackage,
        addWorkPackageComment,
        getWorkPackageIDFromReply,
      } = createHarness();
      getWorkPackageIDFromReply.mockReturnValue(73);
      const reply = createReply("m.room.message", "Work package card");

      await service.closeWorkPackage(
        "@alice:example.org",
        reply,
        "Closing note",
      );

      expect(getWorkPackageIDFromReply).toHaveBeenCalledWith(reply);
      expect(getWorkPackage).toHaveBeenCalledWith(73);
      expect(updateWorkPackage).toHaveBeenCalledWith(73, 8, {
        _links: { status: { href: CLOSED_STATUS._links.self.href } },
      });
      expect(addWorkPackageComment).toHaveBeenCalledWith(73, "Closing note");
    });

    it("rejects when the instance has no closed status", async () => {
      const {
        service,
        getStatuses,
        getWorkPackage,
        updateWorkPackage,
        addWorkPackageComment,
      } = createHarness();
      getStatuses.mockResolvedValue([
        {
          name: "In progress",
          isClosed: false,
          _links: { self: { href: "/api/v3/statuses/2" } },
        },
      ]);

      await expect(
        service.closeWorkPackage(
          "@alice:example.org",
          undefined,
          String(WORK_PACKAGE.id),
        ),
      ).rejects.toMatchObject({
        message: "No closed status on OpenProject",
        humanError: expect.stringContaining("doesn't have a closed status"),
      });

      expect(getWorkPackage).not.toHaveBeenCalled();
      expect(updateWorkPackage).not.toHaveBeenCalled();
      expect(addWorkPackageComment).not.toHaveBeenCalled();
    });

    it("does not add a comment when the status update fails", async () => {
      const { service, updateWorkPackage, addWorkPackageComment } =
        createHarness();
      updateWorkPackage.mockRejectedValueOnce(
        new Error("status update failed"),
      );

      await expect(
        service.closeWorkPackage(
          "@alice:example.org",
          undefined,
          String(WORK_PACKAGE.id),
          "Closing note",
        ),
      ).rejects.toThrow("status update failed");

      expect(addWorkPackageComment).not.toHaveBeenCalled();
    });
  });
});
