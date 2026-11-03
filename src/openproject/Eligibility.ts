import { UserTokenStore } from "../tokens/UserTokenStore";
import { Logger } from "matrix-appservice-bridge";
import {
  OpenProjectAPIClient,
  OpenProjectMalformedResponseError,
} from "./Client";
import type {
  OpenProjectUser,
  OpenProjectStatus,
  OpenProjectFormAllowedValue,
  OpenProjectWorkPackage,
  OpenProjectWorkPackageForm,
} from "./Types";

const log = new Logger("OpenProjectEligibilityService");

/** Connection properties needed to evaluate a work package action. */
export interface OpenProjectEligibilityConnection {
  projectId: number;
  getCompletionStatusOptionId(): string | undefined;
  interestedInProject(projectId: number): boolean;
}

/** Result of checking whether the acting user can mark a package as done. */
export type OpenProjectMarkDoneResult =
  | {
      status: "eligible";
      action: "mark_done";
      workPackageId: number;
      lockVersion: number;
      targetHref: string;
    }
  | {
      status: "ineligible";
      reason:
        | "invalid_work_package_id"
        | "already_closed"
        | "status_not_writable"
        | "target_not_allowed"
        | "status_form_invalid";
    }
  | {
      status: "stale_target";
      reason:
        | "configured_status_missing"
        | "configured_status_open"
        | "default_status_missing"
        | "default_status_ambiguous";
    }
  | { status: "not_connected" }
  | { status: "conflict" }
  | {
      status: "not_authorized";
      reason:
        | "wrong_project"
        | "work_package_not_found"
        | "openproject_permission";
    }
  | {
      status: "unavailable";
      reason: "connection_removed" | "openproject_error" | "malformed_response";
    };

/** Reasons an assignment can be unavailable or could not be evaluated. */
export type OpenProjectAssignmentResult =
  | {
      status: "eligible";
      action?: "assign_self";
      workPackageId: number;
      lockVersion: number;
      targetHref: string | null;
    }
  | {
      status: "ineligible";
      reason:
        | "invalid_work_package_id"
        | "already_assigned"
        | "target_not_available"
        | "assignee_not_writable"
        | "assignment_invalid";
    }
  | { status: "not_connected" }
  | { status: "conflict" }
  | {
      status: "not_authorized";
      reason:
        | "wrong_project"
        | "work_package_not_found"
        | "openproject_permission";
    }
  | {
      status: "unavailable";
      reason: "connection_removed" | "openproject_error" | "malformed_response";
    };

/** Target selection for command-time assignment. */
export type OpenProjectAssignmentTarget =
  | { kind: "self" }
  | { kind: "user"; href: string | null; userId?: number };

interface EvaluationContext {
  client: OpenProjectAPIClient;
  identity: { id: number; href: string; normalizedHref: string };
  workPackage: OpenProjectWorkPackage;
}

type ContextFailure = Exclude<
  OpenProjectAssignmentResult,
  { status: "eligible" }
>;
type IneligibleAssignmentResult = Extract<
  OpenProjectAssignmentResult,
  { status: "ineligible" }
>;

type ContextResult =
  | { ok: true; context: EvaluationContext }
  | { ok: false; result: ContextFailure };

interface CanonicalAssignmentTarget {
  href: string;
  userId: number;
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return undefined;
  }

  const response = error.response;
  if (
    typeof response !== "object" ||
    response === null ||
    !("status" in response)
  ) {
    return undefined;
  }

  return typeof response.status === "number" ? response.status : undefined;
}

function normalizeHref(href: string, origin: string): string | undefined {
  try {
    const url = new URL(href, `${origin}/`);
    if (url.origin !== origin) {
      return undefined;
    }
    return url.pathname;
  } catch {
    return undefined;
  }
}

function canonicalUserHref(
  href: string,
  expectedUserId: number | undefined,
  origin: string,
): { href: string; userId: number } | undefined {
  try {
    const url = new URL(href, `${origin}/`);
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }

    // Example matched: "/api/v3/users/42".
    const match = /^\/api\/v3\/users\/([1-9]\d*)$/.exec(url.pathname);
    if (!match) {
      return undefined;
    }
    const userId = Number(match[1]);
    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      (expectedUserId !== undefined && expectedUserId !== userId)
    ) {
      return undefined;
    }

    return { href: url.pathname, userId };
  } catch {
    return undefined;
  }
}

function matchesUser(
  user: OpenProjectUser | null | undefined,
  userId: number | undefined,
  normalizedHref: string,
  origin: string,
): boolean {
  if (!user) {
    return false;
  }
  if (userId !== undefined && user.id === userId) {
    return true;
  }
  return normalizeHref(user._links.self.href, origin) === normalizedHref;
}

/**
 * Evaluates package-specific assignment eligibility for the acting Matrix user.
 * Each evaluation checks current OpenProject state for the acting Matrix user.
 */
export class OpenProjectEligibilityService {
  constructor(private readonly tokenStore: UserTokenStore) {}

  /** Evaluate whether the sender can assign themself to this work package. */
  public async evaluateAssignSelf(
    matrixUserId: string,
    connection: OpenProjectEligibilityConnection,
    workPackageId: number,
  ): Promise<OpenProjectAssignmentResult> {
    const contextResult = await this.getContext(
      matrixUserId,
      connection,
      workPackageId,
    );
    if (!contextResult.ok) return contextResult.result;

    const { context } = contextResult;
    return this.validateTargetInContext(
      workPackageId,
      { href: context.identity.href, userId: context.identity.id },
      context,
      "assign_self",
    );
  }

  /** Evaluate the configured completion transition against the acting user's current form. */
  public async evaluateMarkDone(
    matrixUserId: string,
    connection: OpenProjectEligibilityConnection,
    workPackageId: number,
  ): Promise<OpenProjectMarkDoneResult> {
    if (!Number.isSafeInteger(workPackageId) || workPackageId <= 0) {
      return { status: "ineligible", reason: "invalid_work_package_id" };
    }
    const contextResult = await this.getContext(
      matrixUserId,
      connection,
      workPackageId,
    );
    if (!contextResult.ok) {
      return this.markDoneContextFailure(contextResult.result);
    }

    const { client, workPackage } = contextResult.context;
    if (
      !workPackage._embedded.status ||
      typeof workPackage._embedded.status.isClosed !== "boolean"
    ) {
      return { status: "unavailable", reason: "malformed_response" };
    }
    if (workPackage._embedded.status.isClosed) {
      return { status: "ineligible", reason: "already_closed" };
    }

    try {
      const form = await client.getWorkPackageForm(workPackageId, {
        lockVersion: workPackage.lockVersion,
      });
      const statusField = form._embedded.schema.status;
      if (!statusField || statusField.writable !== true) {
        return { status: "ineligible", reason: "status_not_writable" };
      }

      let allowedStatuses: OpenProjectStatus[];
      try {
        allowedStatuses = await this.getAllowedStatuses(client, statusField);
      } catch (error) {
        if (httpStatus(error) === 404) {
          return { status: "unavailable", reason: "openproject_error" };
        }
        throw error;
      }
      let targetStatus: OpenProjectStatus | undefined;
      const completionStatusOptionId = connection.getCompletionStatusOptionId();
      if (completionStatusOptionId !== undefined) {
        const configuredId = Number(completionStatusOptionId);
        if (!Number.isSafeInteger(configuredId) || configuredId <= 0) {
          throw new OpenProjectMalformedResponseError(
            "Configured completion status ID is invalid",
          );
        }
        let configuredStatus: OpenProjectStatus;
        try {
          configuredStatus = await client.getStatusByHref(
            `/api/v3/statuses/${configuredId}`,
          );
        } catch (error) {
          if (httpStatus(error) === 404) {
            return {
              status: "stale_target",
              reason: "configured_status_missing",
            };
          }
          throw error;
        }
        if (String(configuredStatus.id) !== completionStatusOptionId) {
          throw new OpenProjectMalformedResponseError(
            "OpenProject status ID does not match the requested status",
          );
        }
        if (!configuredStatus.isClosed) {
          return { status: "stale_target", reason: "configured_status_open" };
        }
        targetStatus = allowedStatuses.find(
          (status) => status.id === configuredStatus.id,
        );
        if (!targetStatus) {
          return { status: "ineligible", reason: "target_not_allowed" };
        }
        if (!targetStatus.isClosed) {
          return { status: "stale_target", reason: "configured_status_open" };
        }
      } else {
        const defaultsById = new Map(
          allowedStatuses
            .filter(
              (status) =>
                status.isClosed && status.name.toLowerCase() === "closed",
            )
            .map((status) => [status.id, status]),
        );
        const defaults = [...defaultsById.values()];
        if (defaults.length === 0) {
          return { status: "stale_target", reason: "default_status_missing" };
        }
        if (defaults.length !== 1) {
          return { status: "stale_target", reason: "default_status_ambiguous" };
        }
        targetStatus = defaults[0];
      }

      const targetHref = this.normalizeStatusHref(
        targetStatus._links.self.href,
        client.getOrigin(),
        targetStatus.id,
      );
      if (!targetHref) {
        throw new OpenProjectMalformedResponseError(
          "OpenProject returned an invalid allowed status link",
        );
      }
      const validatedForm = await client.getWorkPackageForm(workPackageId, {
        lockVersion: workPackage.lockVersion,
        _links: { status: { href: targetHref } },
      });
      if (Object.keys(validatedForm._embedded.validationErrors).length > 0) {
        return { status: "ineligible", reason: "status_form_invalid" };
      }
      return {
        status: "eligible",
        action: "mark_done",
        workPackageId,
        lockVersion: workPackage.lockVersion,
        targetHref,
      };
    } catch (error) {
      const result = this.resultForError(error, "assignees_or_form");
      if (result.status === "ineligible") {
        return { status: "ineligible", reason: "status_form_invalid" };
      }
      return result;
    }
  }

  private async getAllowedStatuses(
    client: OpenProjectAPIClient,
    field: NonNullable<
      OpenProjectWorkPackageForm["_embedded"]["schema"]["status"]
    >,
  ): Promise<OpenProjectStatus[]> {
    const embedded = field._embedded?.allowedValues;
    if (embedded) {
      return embedded.map((value) => this.statusFromAllowedValue(value));
    }
    const linkedValues = field._links?.allowedValues;
    if (!linkedValues) {
      throw new OpenProjectMalformedResponseError(
        "OpenProject status form omitted allowed values",
      );
    }
    if (Array.isArray(linkedValues)) {
      return Promise.all(
        linkedValues.map((link) => client.getStatusByHref(link.href)),
      );
    }
    const path = normalizeHref(linkedValues.href, client.getOrigin());
    if (!path) {
      throw new OpenProjectMalformedResponseError(
        "OpenProject returned an invalid allowed statuses link",
      );
    }
    if (/^\/api\/v3\/statuses\/[1-9]\d*$/.test(path)) {
      return [await client.getStatusByHref(linkedValues.href)];
    }
    return client.getStatusesByAllowedValuesHref(linkedValues.href);
  }

  private statusFromAllowedValue(
    value: OpenProjectFormAllowedValue,
  ): OpenProjectStatus {
    if (
      !Number.isSafeInteger(value.id) ||
      value.id! <= 0 ||
      typeof value.name !== "string" ||
      typeof value.isClosed !== "boolean" ||
      !value._links?.self?.href
    ) {
      throw new OpenProjectMalformedResponseError(
        "OpenProject returned an incomplete allowed status",
      );
    }
    return value as unknown as OpenProjectStatus;
  }

  private normalizeStatusHref(
    href: string,
    origin: string,
    expectedStatusId: number,
  ): string | undefined {
    const normalized = normalizeHref(href, origin);
    const match =
      normalized && /^\/api\/v3\/statuses\/([1-9]\d*)$/.exec(normalized);
    return match && Number(match[1]) === expectedStatusId
      ? normalized
      : undefined;
  }

  private markDoneContextFailure(
    result: ContextFailure,
  ): Exclude<
    OpenProjectMarkDoneResult,
    { status: "eligible" | "stale_target" }
  > {
    if (result.status === "ineligible") {
      return { status: "ineligible", reason: "invalid_work_package_id" };
    }
    return result;
  }

  /** Recheck eligibility and apply an assignment using the fetched revision. */
  public async executeAssignment(
    matrixUserId: string,
    connection: OpenProjectEligibilityConnection,
    workPackageId: number,
    target: OpenProjectAssignmentTarget,
  ): Promise<OpenProjectAssignmentResult> {
    const contextResult = await this.getContext(
      matrixUserId,
      connection,
      workPackageId,
    );
    if (!contextResult.ok) return contextResult.result;

    const { context } = contextResult;
    if (target.kind === "self") {
      return this.executeTargetInContext(
        workPackageId,
        { href: context.identity.href, userId: context.identity.id },
        context,
        "assign_self",
      );
    }

    return this.executeTargetInContext(
      workPackageId,
      { href: target.href, userId: target.userId },
      context,
      undefined,
    );
  }

  private async validateTargetInContext(
    workPackageId: number,
    target: { href: string | null; userId?: number },
    context: EvaluationContext,
    action: "assign_self" | undefined,
  ): Promise<OpenProjectAssignmentResult> {
    const { client, workPackage } = context;
    if (
      action === "assign_self" &&
      this.isAlreadyAssigned(context, {
        href: context.identity.normalizedHref,
        userId: context.identity.id,
      })
    ) {
      return { status: "ineligible", reason: "already_assigned" };
    }

    const normalizedTarget = this.normalizeTarget(target, client.getOrigin());
    if (target.href !== null && normalizedTarget === undefined) {
      return { status: "ineligible", reason: "target_not_available" };
    }
    const targetHref = normalizedTarget?.href ?? null;

    if (
      action === undefined &&
      normalizedTarget &&
      this.isAlreadyAssigned(context, normalizedTarget)
    ) {
      return { status: "ineligible", reason: "already_assigned" };
    }

    try {
      if (
        normalizedTarget &&
        !(await this.isTargetAvailable(context, normalizedTarget))
      ) {
        return { status: "ineligible", reason: "target_not_available" };
      }

      const form = await client.getWorkPackageForm(workPackageId, {
        lockVersion: workPackage.lockVersion,
        _links: { assignee: { href: targetHref } },
      });
      const formFailure = this.validateAssignmentForm(form);
      if (formFailure) return formFailure;

      return {
        status: "eligible",
        ...(action ? { action } : {}),
        workPackageId,
        lockVersion: workPackage.lockVersion,
        targetHref,
      };
    } catch (error) {
      return this.resultForError(error, "assignees_or_form");
    }
  }

  private normalizeTarget(
    target: { href: string | null; userId?: number },
    origin: string,
  ): CanonicalAssignmentTarget | null | undefined {
    if (target.href === null) return null;
    return canonicalUserHref(target.href, target.userId, origin);
  }

  private isAlreadyAssigned(
    context: EvaluationContext,
    target: CanonicalAssignmentTarget,
  ): boolean {
    return matchesUser(
      context.workPackage._embedded.assignee,
      target.userId,
      target.href,
      context.client.getOrigin(),
    );
  }

  private async isTargetAvailable(
    context: EvaluationContext,
    target: CanonicalAssignmentTarget,
  ): Promise<boolean> {
    return context.client.hasAvailableAssignee(
      context.workPackage.id,
      target.userId,
    );
  }

  private validateAssignmentForm(
    form: OpenProjectWorkPackageForm,
  ): IneligibleAssignmentResult | undefined {
    const assigneeField = form._embedded.schema.assignee;
    if (!assigneeField || assigneeField.writable !== true) {
      return { status: "ineligible", reason: "assignee_not_writable" };
    }
    if (Object.keys(form._embedded.validationErrors).length > 0) {
      return { status: "ineligible", reason: "assignment_invalid" };
    }
    return undefined;
  }

  private async executeTargetInContext(
    workPackageId: number,
    target: { href: string | null; userId?: number },
    context: EvaluationContext,
    action: "assign_self" | undefined,
  ): Promise<OpenProjectAssignmentResult> {
    const result = await this.validateTargetInContext(
      workPackageId,
      target,
      context,
      action,
    );
    if (result.status !== "eligible") return result;

    try {
      await context.client.updateWorkPackage(
        workPackageId,
        result.lockVersion,
        {
          _links: { assignee: { href: result.targetHref } },
        },
      );
      return result;
    } catch (error) {
      return this.resultForError(error, "mutation");
    }
  }

  private async getContext(
    matrixUserId: string,
    connection: OpenProjectEligibilityConnection,
    workPackageId: number,
  ): Promise<ContextResult> {
    if (!Number.isSafeInteger(workPackageId) || workPackageId <= 0) {
      return {
        ok: false,
        result: { status: "ineligible", reason: "invalid_work_package_id" },
      };
    }
    if (
      !Number.isSafeInteger(connection.projectId) ||
      connection.projectId <= 0
    ) {
      log.warn("Invalid connected OpenProject project ID");
      return {
        ok: false,
        result: { status: "unavailable", reason: "malformed_response" },
      };
    }
    if (!connection.interestedInProject(connection.projectId)) {
      return {
        ok: false,
        result: { status: "unavailable", reason: "connection_removed" },
      };
    }

    let stage: "client" | "identity" | "work_package" = "client";
    try {
      const client = await this.tokenStore.getOpenProjectForUser(matrixUserId);
      if (!client) {
        return { ok: false, result: { status: "not_connected" } };
      }

      stage = "identity";
      const identity = await client.getIdentity();
      const normalizedHref = normalizeHref(
        identity._links.self.href,
        client.getOrigin(),
      );
      if (normalizedHref !== `/api/v3/users/${identity.id}`) {
        log.warn("OpenProject identity self link does not match its user ID");
        return {
          ok: false,
          result: { status: "unavailable", reason: "malformed_response" },
        };
      }
      stage = "work_package";
      const workPackage = await client.getWorkPackage(workPackageId);
      if (workPackage._embedded.project.id !== connection.projectId) {
        return {
          ok: false,
          result: { status: "not_authorized", reason: "wrong_project" },
        };
      }
      return {
        ok: true,
        context: {
          client,
          identity: {
            id: identity.id,
            href: identity._links.self.href,
            normalizedHref,
          },
          workPackage,
        },
      };
    } catch (error) {
      return { ok: false, result: this.resultForError(error, stage) };
    }
  }

  private resultForError(
    error: unknown,
    stage:
      | "client"
      | "identity"
      | "work_package"
      | "assignees_or_form"
      | "mutation",
  ): ContextFailure {
    if (error instanceof OpenProjectMalformedResponseError) {
      log.warn(
        `Malformed OpenProject response during ${stage}: ${error.message}`,
      );
      return { status: "unavailable", reason: "malformed_response" };
    }
    const status = httpStatus(error);
    if (status === 409) {
      return { status: "conflict" };
    }
    if (status === 401 || status === 403) {
      return { status: "not_authorized", reason: "openproject_permission" };
    }
    if ((status === 400 || status === 422) && stage === "mutation") {
      return { status: "ineligible", reason: "assignment_invalid" };
    }
    if (
      status === 404 &&
      (stage === "work_package" ||
        stage === "assignees_or_form" ||
        stage === "mutation")
    ) {
      return { status: "not_authorized", reason: "work_package_not_found" };
    }
    return { status: "unavailable", reason: "openproject_error" };
  }
}
