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
  OpenProjectIdentity,
  OpenProjectStatus,
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

function createStatus(
  id: number,
  name: string,
  isClosed: boolean,
): OpenProjectStatus {
  return {
    id,
    name,
    isClosed,
    isDefault: false,
    isReadonly: false,
    color: "#000000",
    _links: { self: { href: `/api/v3/statuses/${id}`, title: name } },
  };
}

function createStatusForm(
  allowedValues: OpenProjectStatus[],
  options: {
    writable?: boolean;
    validationErrors?: Record<string, { message: string }>;
  } = {},
): OpenProjectWorkPackageForm {
  return {
    _embedded: {
      payload: {},
      schema: {
        status: {
          writable: options.writable ?? true,
          _embedded: {
            allowedValues: allowedValues.map((status) => ({ ...status })),
          },
        },
      },
      validationErrors: options.validationErrors ?? {},
    },
  };
}

function createHarness() {
  let workPackage = createWorkPackage();
  const getIdentity = vi.fn(async () => createIdentity());
  const getWorkPackage = vi.fn(async () => workPackage);
  const hasAvailableAssignee = vi.fn(
    async (_workPackageId: number, userId: number) =>
      userId === OPENPROJECT_USER_ID,
  );
  const getWorkPackageForm = vi.fn(async () => createForm());
  const getStatusByHref = vi.fn(async (href: string) => {
    const match = /statuses\/(\d+)$/.exec(href);
    return createStatus(Number(match?.[1]), "Done", true);
  });
  const getStatusesByAllowedValuesHref = vi.fn(
    async () => [] as OpenProjectStatus[],
  );
  const updateWorkPackage = vi.fn(async () => undefined);
  const client = {
    getOrigin: () => BASE_URL.origin,
    getIdentity,
    getWorkPackage,
    hasAvailableAssignee,
    getWorkPackageForm,
    getStatusByHref,
    getStatusesByAllowedValuesHref,
    updateWorkPackage,
  } as unknown as OpenProjectAPIClient;
  const getOpenProjectForUser = vi.fn(
    async (): Promise<OpenProjectAPIClient | null> => client,
  );
  const tokenStore = {
    getOpenProjectForUser,
  } as unknown as UserTokenStore;
  const service = new OpenProjectEligibilityService(tokenStore);
  const connection: OpenProjectEligibilityConnection = {
    projectId: WORK_PACKAGE._embedded.project.id,
    getCompletionStatusOptionId: vi.fn(() => undefined),
    interestedInProject: vi.fn(() => true),
  };

  return {
    service,
    connection,
    client,
    getIdentity,
    getWorkPackage,
    hasAvailableAssignee,
    getWorkPackageForm,
    getStatusByHref,
    getStatusesByAllowedValuesHref,
    updateWorkPackage,
    getOpenProjectForUser,
    setWorkPackage(next: OpenProjectWorkPackage) {
      workPackage = next;
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

    expect(harness.hasAvailableAssignee).toHaveBeenCalledWith(
      WORK_PACKAGE.id,
      OPENPROJECT_USER_ID,
    );
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
    expect(harness.hasAvailableAssignee).not.toHaveBeenCalled();
    expect(harness.getWorkPackageForm).not.toHaveBeenCalled();
  });

  it("rejects a target absent from the package-specific assignee list", async () => {
    const harness = createHarness();
    harness.hasAvailableAssignee.mockResolvedValue(false);

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
      "assignee form error",
      createForm({
        validationErrors: { assignee: { message: "Not allowed" } },
      }),
      "assignment_invalid",
    ],
    [
      "other form error",
      createForm({
        validationErrors: { subject: { message: "Subject is required" } },
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
    expect(harness.hasAvailableAssignee).not.toHaveBeenCalled();
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

  it("assigns a manual target and allows clearing when the form accepts it", async () => {
    const harness = createHarness();
    await expect(
      harness.service.executeAssignment(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
        { kind: "user", href: ASSIGNEE_HREF, userId: OPENPROJECT_USER_ID },
      ),
    ).resolves.toMatchObject({ status: "eligible", targetHref: ASSIGNEE_HREF });

    await expect(
      harness.service.executeAssignment(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
        { kind: "user", href: null },
      ),
    ).resolves.toMatchObject({ status: "eligible", targetHref: null });
    expect(harness.hasAvailableAssignee).toHaveBeenCalledTimes(1);
    expect(harness.updateWorkPackage).toHaveBeenNthCalledWith(
      1,
      WORK_PACKAGE.id,
      8,
      { _links: { assignee: { href: ASSIGNEE_HREF } } },
    );
    expect(harness.updateWorkPackage).toHaveBeenNthCalledWith(
      2,
      WORK_PACKAGE.id,
      8,
      { _links: { assignee: { href: null } } },
    );
  });

  it("rejects mismatched IDs and non-user links before assignee lookup", async () => {
    const harness = createHarness();

    for (const target of [
      { href: "/api/v3/users/8", userId: OPENPROJECT_USER_ID },
      { href: "/api/v3/projects/1", userId: OPENPROJECT_USER_ID },
    ]) {
      await expect(
        harness.service.executeAssignment(
          MATRIX_USER_ID,
          harness.connection,
          WORK_PACKAGE.id,
          { kind: "user", ...target },
        ),
      ).resolves.toEqual({
        status: "ineligible",
        reason: "target_not_available",
      });
    }

    expect(harness.hasAvailableAssignee).not.toHaveBeenCalled();
    expect(harness.getWorkPackageForm).not.toHaveBeenCalled();
    expect(harness.updateWorkPackage).not.toHaveBeenCalled();
  });

  it("normalizes an absolute canonical user link before form validation", async () => {
    const harness = createHarness();

    await expect(
      harness.service.executeAssignment(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
        {
          kind: "user",
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
    expect(harness.updateWorkPackage).toHaveBeenCalledWith(WORK_PACKAGE.id, 8, {
      _links: { assignee: { href: ASSIGNEE_HREF } },
    });
  });

  it("rechecks target availability for every evaluation", async () => {
    const harness = createHarness();
    const evaluate = () =>
      harness.service.evaluateAssignSelf(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      );

    harness.hasAvailableAssignee
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(evaluate()).resolves.toMatchObject({ status: "eligible" });
    await expect(evaluate()).resolves.toEqual({
      status: "ineligible",
      reason: "target_not_available",
    });
    expect(harness.hasAvailableAssignee).toHaveBeenNthCalledWith(
      1,
      WORK_PACKAGE.id,
      OPENPROJECT_USER_ID,
    );
    expect(harness.hasAvailableAssignee).toHaveBeenNthCalledWith(
      2,
      WORK_PACKAGE.id,
      OPENPROJECT_USER_ID,
    );
  });

  it("reports a failed assignee lookup as unavailable", async () => {
    const harness = createHarness();
    harness.hasAvailableAssignee.mockRejectedValueOnce(
      new Error("OpenProject unavailable"),
    );
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
    expect(harness.hasAvailableAssignee).toHaveBeenCalledOnce();
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
      harness.hasAvailableAssignee.mockRejectedValue({ response: { status } });

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

describe("OpenProjectEligibilityService mark done", () => {
  it("allows the configured closed status when the acting user's form accepts it", async () => {
    const harness = createHarness();
    vi.mocked(harness.connection.getCompletionStatusOptionId).mockReturnValue(
      "9",
    );
    const form = createStatusForm([createStatus(9, "Resolved", true)]);
    harness.getWorkPackageForm.mockResolvedValue(form);

    await expect(
      harness.service.evaluateMarkDone(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({
      status: "eligible",
      action: "mark_done",
      workPackageId: WORK_PACKAGE.id,
      lockVersion: 8,
      targetHref: "/api/v3/statuses/9",
    });
    expect(harness.getStatusByHref).toHaveBeenCalledWith("/api/v3/statuses/9");
    expect(
      harness.connection.getCompletionStatusOptionId,
    ).toHaveBeenCalledOnce();
    expect(harness.getWorkPackageForm).toHaveBeenNthCalledWith(
      1,
      WORK_PACKAGE.id,
      { lockVersion: 8 },
    );
    expect(harness.getWorkPackageForm).toHaveBeenNthCalledWith(
      2,
      WORK_PACKAGE.id,
      {
        lockVersion: 8,
        _links: { status: { href: "/api/v3/statuses/9" } },
      },
    );
  });

  it("uses only statuses allowed by the acting user's workflow form", async () => {
    const harness = createHarness();
    vi.mocked(harness.connection.getCompletionStatusOptionId).mockReturnValue(
      "9",
    );
    harness.getWorkPackageForm.mockResolvedValue(
      createStatusForm([createStatus(10, "Closed", true)]),
    );

    await expect(
      harness.service.evaluateMarkDone(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({ status: "ineligible", reason: "target_not_allowed" });
    expect(harness.getWorkPackageForm).toHaveBeenCalledOnce();
  });

  it("fetches linked allowed statuses and honors form validation errors", async () => {
    const harness = createHarness();
    vi.mocked(harness.connection.getCompletionStatusOptionId).mockReturnValue(
      "9",
    );
    const form = createStatusForm([]);
    form._embedded.schema.status!._embedded = undefined;
    form._embedded.schema.status!._links = {
      allowedValues: [{ href: "/api/v3/statuses/9" }],
    };
    harness.getWorkPackageForm.mockResolvedValue(form);
    harness.getWorkPackageForm
      .mockResolvedValueOnce(form)
      .mockResolvedValueOnce(
        createStatusForm([], {
          validationErrors: {
            status: { message: "This transition is forbidden" },
          },
        }),
      );

    await expect(
      harness.service.evaluateMarkDone(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({ status: "ineligible", reason: "status_form_invalid" });
    expect(harness.getStatusByHref).toHaveBeenCalledWith("/api/v3/statuses/9");
    expect(harness.getWorkPackageForm).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "read-only",
      createStatusForm([createStatus(9, "Closed", true)], { writable: false }),
      "ineligible",
      "status_not_writable",
    ],
    [
      "missing status property",
      createForm(),
      "ineligible",
      "status_not_writable",
    ],
  ] as const)("rejects a %s form", async (_name, form, status, reason) => {
    const harness = createHarness();
    harness.getWorkPackageForm.mockResolvedValue(form);

    await expect(
      harness.service.evaluateMarkDone(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({ status, reason });
  });

  it("reports stale configured statuses and already-closed packages", async () => {
    const harness = createHarness();
    vi.mocked(harness.connection.getCompletionStatusOptionId).mockReturnValue(
      "9",
    );
    harness.getWorkPackageForm.mockResolvedValue(
      createStatusForm([createStatus(9, "Resolved", true)]),
    );
    harness.getStatusByHref.mockResolvedValue(
      createStatus(9, "Resolved", false),
    );

    await expect(
      harness.service.evaluateMarkDone(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({
      status: "stale_target",
      reason: "configured_status_open",
    });

    harness.setWorkPackage({
      ...createWorkPackage(),
      _embedded: {
        ...createWorkPackage()._embedded,
        status: createStatus(9, "Resolved", true),
      },
    });
    await expect(
      harness.service.evaluateMarkDone(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({ status: "ineligible", reason: "already_closed" });
  });

  it("reports a deleted configured status as stale", async () => {
    const harness = createHarness();
    vi.mocked(harness.connection.getCompletionStatusOptionId).mockReturnValue(
      "9",
    );
    harness.getWorkPackageForm.mockResolvedValue(
      createStatusForm([createStatus(9, "Resolved", true)]),
    );
    harness.getStatusByHref.mockRejectedValue({ response: { status: 404 } });

    await expect(
      harness.service.evaluateMarkDone(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({
      status: "stale_target",
      reason: "configured_status_missing",
    });
  });

  it.each([
    [[], "default_status_missing"],
    [[createStatus(9, "Resolved", true)], "default_status_missing"],
    [
      [createStatus(9, "Closed", true), createStatus(10, "Closed", true)],
      "default_status_ambiguous",
    ],
  ] as const)(
    "requires a unique allowed Closed default",
    async (allowed, reason) => {
      const harness = createHarness();
      harness.getWorkPackageForm.mockResolvedValue(
        createStatusForm([...allowed]),
      );

      await expect(
        harness.service.evaluateMarkDone(
          MATRIX_USER_ID,
          harness.connection,
          WORK_PACKAGE.id,
        ),
      ).resolves.toEqual({ status: "stale_target", reason });
    },
  );

  it("reports form lookup failures as unavailable", async () => {
    const harness = createHarness();
    harness.getWorkPackageForm.mockRejectedValue(new Error("offline"));

    await expect(
      harness.service.evaluateMarkDone(
        MATRIX_USER_ID,
        harness.connection,
        WORK_PACKAGE.id,
      ),
    ).resolves.toEqual({ status: "unavailable", reason: "openproject_error" });
  });
});
