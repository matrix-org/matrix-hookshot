import { describe, expect, it, vi } from "vitest";
import {
  OpenProjectAPIClient,
  OpenProjectMalformedResponseError,
} from "../../src/openproject/Client";
import {
  OpenProjectEligibilityService,
  type OpenProjectEligibilityConnection,
} from "../../src/openproject/Eligibility";
import type { UserTokenStore } from "../../src/tokens/UserTokenStore";
import type {
  OpenProjectAvailableAssignee,
  OpenProjectIdentity,
  OpenProjectWorkPackage,
  OpenProjectWorkPackageForm,
} from "../../src/openproject/Types";
import { BASE_URL, WORK_PACKAGE } from "./WorkPackageFixtures";

const MATRIX_USER_ID = "@alice:example.org";
const OPENPROJECT_USER_ID = 7;
const ASSIGNEE_HREF = `/api/v3/users/${OPENPROJECT_USER_ID}`;

function createIdentity(): OpenProjectIdentity {
  return {
    id: OPENPROJECT_USER_ID,
    name: "Alice",
    _links: { self: { href: ASSIGNEE_HREF } },
  };
}

function createWorkPackage(): OpenProjectWorkPackage {
  return {
    ...WORK_PACKAGE,
    lockVersion: 8,
    _embedded: {
      ...WORK_PACKAGE._embedded,
      assignee: WORK_PACKAGE._embedded.assignee,
    },
  };
}

function createAvailableAssignee(): OpenProjectAvailableAssignee {
  return {
    id: OPENPROJECT_USER_ID,
    _links: { self: { href: ASSIGNEE_HREF } },
  };
}

function createForm(
  options: {
    assigneeWritable?: boolean;
    validationErrors?: Record<string, { message: string }>;
  } = {},
): OpenProjectWorkPackageForm {
  return {
    _embedded: {
      payload: {},
      schema: {
        assignee: { writable: options.assigneeWritable ?? true },
      },
      validationErrors: options.validationErrors ?? {},
    },
  };
}

function createHarness() {
  let workPackage = createWorkPackage();
  let now = 1_000;
  const getIdentity = vi.fn(async () => createIdentity());
  const getWorkPackage = vi.fn(async () => workPackage);
  const getAvailableAssignees = vi.fn(async () => [createAvailableAssignee()]);
  const getWorkPackageForm = vi.fn(async () => createForm());
  const client = {
    getOrigin: () => BASE_URL.origin,
    getIdentity,
    getWorkPackage,
    getAvailableAssignees,
    getWorkPackageForm,
  } as unknown as OpenProjectAPIClient;
  const getOpenProjectForUser = vi.fn(
    async (): Promise<OpenProjectAPIClient | null> => client,
  );
  const tokenStore = {
    getOpenProjectForUser,
  } as unknown as UserTokenStore;
  const service = new OpenProjectEligibilityService(
    tokenStore,
    1_000,
    () => now,
  );
  const connection: OpenProjectEligibilityConnection = {
    projectId: WORK_PACKAGE._embedded.project.id,
    interestedInProject: vi.fn(() => true),
  };

  return {
    service,
    connection,
    client,
    getIdentity,
    getWorkPackage,
    getAvailableAssignees,
    getWorkPackageForm,
    getOpenProjectForUser,
    setWorkPackage(next: OpenProjectWorkPackage) {
      workPackage = next;
    },
    setNow(next: number) {
      now = next;
    },
  };
}

describe("OpenProjectEligibilityService assignment", () => {
  it("allows self-assignment using the fetched package revision", async () => {
    const harness = createHarness();

    await expect(
      harness.service.evaluateAssignSelf(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({
      status: "eligible",
      action: "assign_self",
      workPackageId: WORK_PACKAGE.id,
      lockVersion: 8,
      targetHref: ASSIGNEE_HREF,
    });

    expect(harness.getAvailableAssignees).toHaveBeenCalledWith(WORK_PACKAGE.id);
    expect(harness.getWorkPackageForm).toHaveBeenCalledWith(WORK_PACKAGE.id, {
      lockVersion: 8,
      _links: { assignee: { href: ASSIGNEE_HREF } },
    });
  });

  it("does not offer self-assignment when the sender is already assigned", async () => {
    const harness = createHarness();
    harness.setWorkPackage({
      ...createWorkPackage(),
      _embedded: {
        ...createWorkPackage()._embedded,
        assignee: {
          ...WORK_PACKAGE._embedded.assignee!,
          id: OPENPROJECT_USER_ID,
          _links: { self: { href: ASSIGNEE_HREF, title: "Alice" } },
        },
      },
    });

    await expect(
      harness.service.evaluateAssignSelf(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({
      status: "ineligible",
      reason: "already_assigned",
    });
    expect(harness.getAvailableAssignees).not.toHaveBeenCalled();
    expect(harness.getWorkPackageForm).not.toHaveBeenCalled();
  });

  it("rejects a target absent from the package-specific assignee list", async () => {
    const harness = createHarness();
    harness.getAvailableAssignees.mockResolvedValue([]);

    await expect(
      harness.service.evaluateAssignSelf(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({
      status: "ineligible",
      reason: "target_not_available",
    });
    expect(harness.getWorkPackageForm).not.toHaveBeenCalled();
  });

  it.each([
    [
      "read-only",
      createForm({ assigneeWritable: false }),
      "assignee_not_writable",
    ],
    [
      "form-rejected",
      createForm({
        validationErrors: { assignee: { message: "Not allowed" } },
      }),
      "assignment_invalid",
    ],
  ] as const)("rejects a %s assignment form", async (_name, form, reason) => {
    const harness = createHarness();
    harness.getWorkPackageForm.mockResolvedValue(form);

    await expect(
      harness.service.evaluateAssignSelf(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({ status: "ineligible", reason });
  });

  it("fails closed when the assignment form omits the writable flag", async () => {
    const harness = createHarness();
    const form = createForm();
    form._embedded.schema.assignee = {};
    harness.getWorkPackageForm.mockResolvedValue(form);

    await expect(
      harness.service.evaluateAssignSelf(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({
      status: "ineligible",
      reason: "assignee_not_writable",
    });
  });

  it("rejects a work package from a different connected project", async () => {
    const harness = createHarness();
    harness.setWorkPackage({
      ...createWorkPackage(),
      _embedded: {
        ...createWorkPackage()._embedded,
        project: {
          ...WORK_PACKAGE._embedded.project,
          id: WORK_PACKAGE._embedded.project.id + 1,
        },
      },
    });

    await expect(
      harness.service.evaluateAssignSelf(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({
      status: "not_authorized",
      reason: "wrong_project",
    });
    expect(harness.getAvailableAssignees).not.toHaveBeenCalled();
  });

  it("requires a live connection and a valid package ID before fetching", async () => {
    const harness = createHarness();
    vi.mocked(harness.connection.interestedInProject).mockReturnValue(false);

    await expect(
      harness.service.evaluateAssignSelf(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({ status: "unavailable", reason: "connection_removed" });

    vi.mocked(harness.connection.interestedInProject).mockReturnValue(true);
    await expect(
      harness.service.evaluateAssignSelf(MATRIX_USER_ID, harness.connection, 0),
    ).resolves.toEqual({
      status: "ineligible",
      reason: "invalid_work_package_id",
    });
    expect(harness.getOpenProjectForUser).not.toHaveBeenCalled();
  });

  it("distinguishes a disconnected user and malformed client response", async () => {
    const harness = createHarness();
    harness.getOpenProjectForUser.mockResolvedValueOnce(null);

    await expect(
      harness.service.evaluateAssignSelf(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({ status: "not_connected" });

    harness.getIdentity.mockRejectedValueOnce(
      new OpenProjectMalformedResponseError("Invalid identity"),
    );
    await expect(
      harness.service.evaluateAssignSelf(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "malformed_response",
    });
  });

  it("validates a manual target and allows clearing when the form accepts it", async () => {
    const harness = createHarness();
    await expect(
      harness.service.validateAssigneeTarget(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
        { href: ASSIGNEE_HREF, userId: OPENPROJECT_USER_ID },
      ),
    ).resolves.toMatchObject({ status: "eligible", targetHref: ASSIGNEE_HREF });

    await expect(
      harness.service.validateAssigneeTarget(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
        { href: null },
      ),
    ).resolves.toMatchObject({ status: "eligible", targetHref: null });
    expect(harness.getAvailableAssignees).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched IDs and non-user links before assignee lookup", async () => {
    const harness = createHarness();

    for (const target of [
      { href: "/api/v3/users/8", userId: OPENPROJECT_USER_ID },
      { href: "/api/v3/projects/1", userId: OPENPROJECT_USER_ID },
    ]) {
      await expect(
        harness.service.validateAssigneeTarget(
          MATRIX_USER_ID,
          harness.connection,
          WORK_PACKAGE.id,
          target,
        ),
      ).resolves.toEqual({
        status: "ineligible",
        reason: "target_not_available",
      });
    }

    expect(harness.getAvailableAssignees).not.toHaveBeenCalled();
    expect(harness.getWorkPackageForm).not.toHaveBeenCalled();
  });

  it("normalizes an absolute canonical user link before form validation", async () => {
    const harness = createHarness();

    await expect(
      harness.service.validateAssigneeTarget(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
        {
          href: `${BASE_URL.origin}${ASSIGNEE_HREF}`,
          userId: OPENPROJECT_USER_ID,
        },
      ),
    ).resolves.toMatchObject({
      status: "eligible",
      targetHref: ASSIGNEE_HREF,
    });
    expect(harness.getWorkPackageForm).toHaveBeenCalledWith(WORK_PACKAGE.id, {
      lockVersion: 8,
      _links: { assignee: { href: ASSIGNEE_HREF } },
    });
  });

  it("reuses successful assignee results but refreshes them for a new revision", async () => {
    const harness = createHarness();
    const evaluate = () =>
      harness.service.evaluateAssignSelf(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      );

    await evaluate();
    await evaluate();
    expect(harness.getAvailableAssignees).toHaveBeenCalledTimes(1);

    harness.setWorkPackage({ ...createWorkPackage(), lockVersion: 9 });
    await evaluate();
    expect(harness.getAvailableAssignees).toHaveBeenCalledTimes(2);
  });

  it("expires successful assignee results and bypasses the cache on request", async () => {
    const harness = createHarness();
    const evaluate = (bypassAssigneeCache = false) =>
      harness.service.evaluateAssignSelf(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
        { bypassAssigneeCache },
      );

    await evaluate();
    harness.setNow(2_001);
    await evaluate();
    await evaluate(true);

    expect(harness.getAvailableAssignees).toHaveBeenCalledTimes(3);
  });

  it("does not cache a failed assignee request", async () => {
    const harness = createHarness();
    harness.getAvailableAssignees
      .mockRejectedValueOnce(new Error("OpenProject unavailable"))
      .mockResolvedValueOnce([createAvailableAssignee()]);
    const evaluate = () =>
      harness.service.evaluateAssignSelf(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      );

    await expect(evaluate()).resolves.toEqual({
      status: "unavailable",
      reason: "openproject_error",
    });
    await expect(evaluate()).resolves.toMatchObject({ status: "eligible" });
    expect(harness.getAvailableAssignees).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent assignee requests for the same user and revision", async () => {
    const harness = createHarness();
    let resolveAssignees!: (assignees: OpenProjectAvailableAssignee[]) => void;
    const pendingAssignees = new Promise<OpenProjectAvailableAssignee[]>(
      (resolve) => {
        resolveAssignees = resolve;
      },
    );
    harness.getAvailableAssignees.mockReturnValue(pendingAssignees);
    const evaluate = () =>
      harness.service.evaluateAssignSelf(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      );

    const first = evaluate();
    const second = evaluate();
    await vi.waitFor(() =>
      expect(harness.getAvailableAssignees).toHaveBeenCalledTimes(1),
    );
    resolveAssignees([createAvailableAssignee()]);

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        status: "eligible",
        action: "assign_self",
        workPackageId: WORK_PACKAGE.id,
        lockVersion: 8,
        targetHref: ASSIGNEE_HREF,
      },
      {
        status: "eligible",
        action: "assign_self",
        workPackageId: WORK_PACKAGE.id,
        lockVersion: 8,
        targetHref: ASSIGNEE_HREF,
      },
    ]);
  });

  it("does not share cached assignees across Matrix users", async () => {
    const harness = createHarness();

    await harness.service.evaluateAssignSelf(
      MATRIX_USER_ID,
      harness.connection,
      WORK_PACKAGE.id,
    );
    await harness.service.evaluateAssignSelf(
      "@bob:example.org",
      harness.connection,
      WORK_PACKAGE.id,
    );

    expect(harness.getAvailableAssignees).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, { status: "not_authorized", reason: "openproject_permission" }],
    [403, { status: "not_authorized", reason: "openproject_permission" }],
    [404, { status: "not_authorized", reason: "work_package_not_found" }],
    [409, { status: "conflict" }],
  ] as const)(
    "maps an OpenProject %i assignment error",
    async (status, result) => {
      const harness = createHarness();
      harness.getAvailableAssignees.mockRejectedValue({ response: { status } });

      await expect(
        harness.service.evaluateAssignSelf(
          MATRIX_USER_ID,
          harness.connection,
          WORK_PACKAGE.id,
        ),
      ).resolves.toEqual(result);
    },
  );
});
