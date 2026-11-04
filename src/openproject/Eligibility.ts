import { UserTokenStore } from "../tokens/UserTokenStore";
import { Logger } from "matrix-appservice-bridge";
import { getAxiosErrorStatus } from "../util/axios";
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

type OpenProjectSharedFailure =
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

type OpenProjectContextFailure =
  | OpenProjectSharedFailure
  | { status: "ineligible"; reason: "invalid_work_package_id" };

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
        | "already_closed"
        | "status_not_writable"
        | "target_not_allowed"
        | "status_form_invalid";
    }
  | {
      status: "stale_target";
      reason:
        | "configured_status_open"
        | "default_status_missing"
        | "default_status_ambiguous";
    }
  | OpenProjectContextFailure;

/** Result of evaluating and executing a mark-done command. */
export type OpenProjectMarkDoneCommandResult =
  | OpenProjectMarkDoneResult
  | { status: "comment_failed" };

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
        | "already_assigned"
        | "target_not_available"
        | "assignee_not_writable"
        | "assignment_invalid";
    }
  | OpenProjectContextFailure;

/** Results of evaluating both card actions against one live package snapshot. */
export type OpenProjectCardActionsResult =
  | {
      status: "evaluated";
      assignSelf: OpenProjectAssignmentResult;
      markDone: OpenProjectMarkDoneResult;
    }
  | OpenProjectContextFailure;

/** Target selection for command-time assignment. */
export type OpenProjectAssignmentTarget =
  | { kind: "self" }
  | { kind: "user"; href: string | null; userId?: number };

interface EvaluationContext {
  client: OpenProjectAPIClient;
  identity: { id: number; href: string; normalizedHref: string };
  workPackage: OpenProjectWorkPackage;
}

type ContextResult =
  | { ok: true; context: EvaluationContext }
  | { ok: false; result: OpenProjectContextFailure };

type ErrorStage =
  | "client"
  | "identity"
  | "work_package"
  | "assignees_or_form"
  | "status_options"
  | "assignment_mutation"
  | "mark_done_mutation";

interface CanonicalAssignmentTarget {
  href: string;
  userId: number;
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

  /**
   * Evaluate both card actions from one identity and work-package snapshot.
   * The checks are read-only and assignment availability is fetched on every call.
   */
  public async evaluateCardActions(
    matrixUserId: string,
    connection: OpenProjectEligibilityConnection,
    workPackageId: number,
  ): Promise<OpenProjectCardActionsResult> {
    const contextResult = await this.getContext(
      matrixUserId,
      connection,
      workPackageId,
    );
    if (!contextResult.ok) return contextResult.result;

    const { context } = contextResult;
    const completionStatusOptionId = connection.getCompletionStatusOptionId();
    const [assignSelf, markDone] = await Promise.all([
      this.evaluateAssignSelfInContext(workPackageId, context),
      this.evaluateMarkDoneInContext(
        completionStatusOptionId,
        workPackageId,
        context,
      ),
    ]);
    return { status: "evaluated", assignSelf, markDone };
  }

  /** Evaluate whether the sender can assign themself to this work package. */
  public async evaluateAssignSelfCommand(
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

    return this.evaluateAssignSelfInContext(
      workPackageId,
      contextResult.context,
    );
  }

  /** Evaluate the configured completion transition against the acting user's current form. */
  public async evaluateMarkDoneCommand(
    matrixUserId: string,
    connection: OpenProjectEligibilityConnection,
    workPackageId: number,
  ): Promise<OpenProjectMarkDoneResult> {
    const contextResult = await this.getContext(
      matrixUserId,
      connection,
      workPackageId,
    );
    if (!contextResult.ok) return contextResult.result;

    return this.evaluateMarkDoneInContext(
      connection.getCompletionStatusOptionId(),
      workPackageId,
      contextResult.context,
    );
  }

  /** Evaluate, close, and optionally comment using the same OpenProject context. */
  public async executeMarkDoneCommand(
    matrixUserId: string,
    connection: OpenProjectEligibilityConnection,
    workPackageId: number,
    comment?: string,
  ): Promise<OpenProjectMarkDoneCommandResult> {
    const contextResult = await this.getContext(
      matrixUserId,
      connection,
      workPackageId,
    );
    if (!contextResult.ok) return contextResult.result;

    const { context } = contextResult;
    const result = await this.evaluateMarkDoneInContext(
      connection.getCompletionStatusOptionId(),
      workPackageId,
      context,
    );
    if (result.status !== "eligible") return result;

    try {
      await context.client.updateWorkPackage(
        result.workPackageId,
        result.lockVersion,
        { _links: { status: { href: result.targetHref } } },
      );
    } catch (error) {
      return this.resultForMarkDoneMutationError(error);
    }

    if (comment) {
      try {
        await context.client.addWorkPackageComment(
          result.workPackageId,
          comment,
        );
      } catch {
        return { status: "comment_failed" };
      }
    }
    return result;
  }

  private async evaluateMarkDoneInContext(
    completionStatusOptionId: string | undefined,
    workPackageId: number,
    context: EvaluationContext,
  ): Promise<OpenProjectMarkDoneResult> {
    const { client, workPackage } = context;
    if (
      !workPackage._embedded.status ||
      typeof workPackage._embedded.status.isClosed !== "boolean"
    ) {
      return { status: "unavailable", reason: "malformed_response" };
    }
    if (workPackage._embedded.status.isClosed) {
      return { status: "ineligible", reason: "already_closed" };
    }

    let errorStage: "assignees_or_form" | "status_options" =
      "assignees_or_form";
    try {
      const form = await client.getWorkPackageForm(workPackageId, {
        lockVersion: workPackage.lockVersion,
      });
      const statusField = form._embedded.schema.status;
      if (!statusField || statusField.writable !== true) {
        return { status: "ineligible", reason: "status_not_writable" };
      }

      errorStage = "status_options";
      const allowedStatuses = await this.getAllowedStatuses(
        client,
        statusField,
      );
      errorStage = "assignees_or_form";
      let targetStatus: OpenProjectStatus | undefined;
      if (completionStatusOptionId !== undefined) {
        targetStatus = allowedStatuses.find(
          (status) => String(status.id) === completionStatusOptionId,
        );
        if (!targetStatus) {
          return { status: "ineligible", reason: "target_not_allowed" };
        }
        if (!targetStatus.isClosed) {
          return { status: "stale_target", reason: "configured_status_open" };
        }
      } else {
        const defaults = [
          ...new Map(
            allowedStatuses
              .filter(
                (status) =>
                  status.isClosed && status.name.toLowerCase() === "closed",
              )
              .map((status) => [status.id, status]),
          ).values(),
        ];
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
      return this.resultForError(error, errorStage);
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

  private async evaluateAssignSelfInContext(
    workPackageId: number,
    context: EvaluationContext,
  ): Promise<OpenProjectAssignmentResult> {
    return this.evaluateAssignmentTargetInContext(
      workPackageId,
      { kind: "self" },
      context,
    );
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

    return this.executeAssignmentInContext(
      workPackageId,
      target,
      contextResult.context,
    );
  }

  private async evaluateAssignmentTargetInContext(
    workPackageId: number,
    target: OpenProjectAssignmentTarget,
    context: EvaluationContext,
  ): Promise<OpenProjectAssignmentResult> {
    const { client, workPackage } = context;
    const action = target.kind === "self" ? "assign_self" : undefined;
    const targetHref =
      target.kind === "self" ? context.identity.href : target.href;
    const targetUserId =
      target.kind === "self" ? context.identity.id : target.userId;
    const normalizedTarget = this.normalizeTarget(
      { href: targetHref, userId: targetUserId },
      client.getOrigin(),
    );
    if (targetHref !== null && normalizedTarget === undefined) {
      return { status: "ineligible", reason: "target_not_available" };
    }
    if (normalizedTarget && this.isAlreadyAssigned(context, normalizedTarget)) {
      return { status: "ineligible", reason: "already_assigned" };
    }
    const canonicalTargetHref = normalizedTarget?.href ?? null;

    try {
      if (
        normalizedTarget &&
        !(await this.isTargetAvailable(context, normalizedTarget))
      ) {
        return { status: "ineligible", reason: "target_not_available" };
      }

      const form = await client.getWorkPackageForm(workPackageId, {
        lockVersion: workPackage.lockVersion,
        _links: { assignee: { href: canonicalTargetHref } },
      });
      const assigneeField = form._embedded.schema.assignee;
      if (!assigneeField || assigneeField.writable !== true) {
        return { status: "ineligible", reason: "assignee_not_writable" };
      }
      if (Object.keys(form._embedded.validationErrors).length > 0) {
        return { status: "ineligible", reason: "assignment_invalid" };
      }

      return {
        status: "eligible",
        ...(action ? { action } : {}),
        workPackageId,
        lockVersion: workPackage.lockVersion,
        targetHref: canonicalTargetHref,
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

  private async executeAssignmentInContext(
    workPackageId: number,
    target: OpenProjectAssignmentTarget,
    context: EvaluationContext,
  ): Promise<OpenProjectAssignmentResult> {
    const result = await this.evaluateAssignmentTargetInContext(
      workPackageId,
      target,
      context,
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
      return this.resultForAssignmentMutationError(error);
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
    stage: ErrorStage,
  ): OpenProjectSharedFailure {
    if (error instanceof OpenProjectMalformedResponseError) {
      log.warn(
        `Malformed OpenProject response during ${stage}: ${error.message}`,
      );
      return { status: "unavailable", reason: "malformed_response" };
    }
    const status = getAxiosErrorStatus(error);
    if (status === 409) {
      return { status: "conflict" };
    }
    if (status === 401 || status === 403) {
      return { status: "not_authorized", reason: "openproject_permission" };
    }
    if (status === 404 && stage === "status_options") {
      return { status: "unavailable", reason: "openproject_error" };
    }
    if (
      status === 404 &&
      (stage === "work_package" ||
        stage === "assignees_or_form" ||
        stage === "assignment_mutation" ||
        stage === "mark_done_mutation")
    ) {
      return { status: "not_authorized", reason: "work_package_not_found" };
    }
    return { status: "unavailable", reason: "openproject_error" };
  }

  private resultForAssignmentMutationError(
    error: unknown,
  ): OpenProjectAssignmentResult {
    const status = getAxiosErrorStatus(error);
    if (status === 400 || status === 422) {
      return { status: "ineligible", reason: "assignment_invalid" };
    }
    return this.resultForError(error, "assignment_mutation");
  }

  private resultForMarkDoneMutationError(
    error: unknown,
  ): OpenProjectMarkDoneResult {
    const status = getAxiosErrorStatus(error);
    if (status === 400 || status === 422) {
      return { status: "ineligible", reason: "status_form_invalid" };
    }
    return this.resultForError(error, "mark_done_mutation");
  }
}
