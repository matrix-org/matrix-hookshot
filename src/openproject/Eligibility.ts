import { UserTokenStore } from "../tokens/UserTokenStore";
import { Logger } from "matrix-appservice-bridge";
import {
  OpenProjectAPIClient,
  OpenProjectMalformedResponseError,
} from "./Client";
import type { OpenProjectUser, OpenProjectWorkPackage } from "./Types";

const log = new Logger("OpenProjectEligibilityService");

/** Connection properties needed to evaluate a work package action. */
export interface OpenProjectEligibilityConnection {
  projectId: number;
  interestedInProject(projectId: number): boolean;
}

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

type ContextResult =
  | { ok: true; context: EvaluationContext }
  | { ok: false; result: ContextFailure };

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
    if (
      matchesUser(
        context.workPackage._embedded.assignee,
        context.identity.id,
        context.identity.normalizedHref,
        context.client.getOrigin(),
      )
    ) {
      return { status: "ineligible", reason: "already_assigned" };
    }

    return this.validateTargetInContext(
      workPackageId,
      { href: context.identity.href, userId: context.identity.id },
      context,
      "assign_self",
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

    const { context } = contextResult;
    if (target.kind === "self") {
      if (
        matchesUser(
          context.workPackage._embedded.assignee,
          context.identity.id,
          context.identity.normalizedHref,
          context.client.getOrigin(),
        )
      ) {
        return { status: "ineligible", reason: "already_assigned" };
      }

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
    const canonicalTarget =
      target.href === null
        ? undefined
        : canonicalUserHref(target.href, target.userId, client.getOrigin());
    if (target.href !== null && canonicalTarget === undefined) {
      return { status: "ineligible", reason: "target_not_available" };
    }
    const canonicalHref = canonicalTarget?.href ?? null;
    const targetId = canonicalTarget?.userId;

    if (
      canonicalHref !== null &&
      action === undefined &&
      matchesUser(
        workPackage._embedded.assignee,
        targetId,
        canonicalHref,
        client.getOrigin(),
      )
    ) {
      return { status: "ineligible", reason: "already_assigned" };
    }

    try {
      if (canonicalHref !== null) {
        if (targetId === undefined) {
          return { status: "ineligible", reason: "target_not_available" };
        }
        const isAvailable = await client.hasAvailableAssignee(
          workPackage.id,
          targetId,
        );
        if (!isAvailable) {
          return { status: "ineligible", reason: "target_not_available" };
        }
      }

      const form = await client.getWorkPackageForm(workPackageId, {
        lockVersion: workPackage.lockVersion,
        _links: { assignee: { href: canonicalHref } },
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
        targetHref: canonicalHref,
      };
    } catch (error) {
      return this.resultForError(error, "assignees_or_form");
    }
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
