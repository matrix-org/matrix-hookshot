import { UserTokenStore } from "../tokens/UserTokenStore";
import {
  OpenProjectAPIClient,
  OpenProjectMalformedResponseError,
} from "./Client";
import type {
  OpenProjectAvailableAssignee,
  OpenProjectUser,
  OpenProjectWorkPackage,
} from "./Types";

const DEFAULT_ASSIGNEE_CACHE_TTL_MS = 30_000;

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

/** Options for assignment eligibility checks. */
export interface OpenProjectEligibilityOptions {
  /** Skip the short-lived assignee collection cache for command execution. */
  bypassAssigneeCache?: boolean;
}

/** Target selection for command-time assignment. */
export type OpenProjectAssignmentTarget =
  | { kind: "self" }
  | { kind: "user"; href: string | null; userId?: number };

interface AssigneeCacheEntry {
  origin: string;
  matrixUserId: string;
  openProjectUserId: number;
  workPackageId: number;
  lockVersion: number;
  expiresAt?: number;
  promise: Promise<OpenProjectAvailableAssignee[]>;
}

function assigneeCacheKey(
  origin: string,
  matrixUserId: string,
  openProjectUserId: number,
  workPackageId: number,
  lockVersion: number,
): string {
  return JSON.stringify([
    origin,
    matrixUserId,
    openProjectUserId,
    workPackageId,
    lockVersion,
  ]);
}

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
 * The service keeps only short-lived, successful assignee collections in memory.
 */
export class OpenProjectEligibilityService {
  private readonly assigneeCache = new Map<string, AssigneeCacheEntry>();
  private readonly identityByMatrixUser = new Map<string, number>();

  constructor(
    private readonly tokenStore: UserTokenStore,
    private readonly assigneeCacheTtlMs = DEFAULT_ASSIGNEE_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Evaluate whether the sender can assign themself to this work package. */
  public async evaluateAssignSelf(
    matrixUserId: string,
    connection: OpenProjectEligibilityConnection,
    workPackageId: number,
    options: OpenProjectEligibilityOptions = {},
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
      matrixUserId,
      workPackageId,
      { href: context.identity.href, userId: context.identity.id },
      options,
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
    options: OpenProjectEligibilityOptions = {},
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
        matrixUserId,
        workPackageId,
        { href: context.identity.href, userId: context.identity.id },
        options,
        context,
        "assign_self",
      );
    }

    return this.executeTargetInContext(
      matrixUserId,
      workPackageId,
      { href: target.href, userId: target.userId },
      options,
      context,
      undefined,
    );
  }

  /**
   * Validate a manual assignee target against the sender's current package state.
   * A null href represents clearing the assignee.
   */
  public async validateAssigneeTarget(
    matrixUserId: string,
    connection: OpenProjectEligibilityConnection,
    workPackageId: number,
    target: { href: string | null; userId?: number },
    options: OpenProjectEligibilityOptions = {},
  ): Promise<OpenProjectAssignmentResult> {
    const contextResult = await this.getContext(
      matrixUserId,
      connection,
      workPackageId,
    );
    if (!contextResult.ok) return contextResult.result;

    return this.validateTargetInContext(
      matrixUserId,
      workPackageId,
      target,
      options,
      contextResult.context,
      undefined,
    );
  }

  private async validateTargetInContext(
    matrixUserId: string,
    workPackageId: number,
    target: { href: string | null; userId?: number },
    options: OpenProjectEligibilityOptions,
    context: EvaluationContext,
    action: "assign_self" | undefined,
  ): Promise<OpenProjectAssignmentResult> {
    const { client, identity, workPackage } = context;
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
        const assignees = await this.getAssignees(
          client,
          matrixUserId,
          identity.id,
          workPackage,
          options.bypassAssigneeCache === true,
        );
        const isAvailable = assignees.some((assignee) => {
          const assigneeHref = normalizeHref(
            assignee._links.self.href,
            client.getOrigin(),
          );
          return (
            (targetId !== undefined && assignee.id === targetId) ||
            (assigneeHref !== undefined && assigneeHref === canonicalHref)
          );
        });
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
      if (Object.hasOwn(form._embedded.validationErrors, "assignee")) {
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
    matrixUserId: string,
    workPackageId: number,
    target: { href: string | null; userId?: number },
    options: OpenProjectEligibilityOptions,
    context: EvaluationContext,
    action: "assign_self" | undefined,
  ): Promise<OpenProjectAssignmentResult> {
    const result = await this.validateTargetInContext(
      matrixUserId,
      workPackageId,
      target,
      options,
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

  /** Invalidate cached assignee collections for this Matrix user. */
  public invalidateAssigneeCache(
    matrixUserId: string,
    workPackageId?: number,
  ): void {
    for (const [key, entry] of this.assigneeCache) {
      if (
        entry.matrixUserId === matrixUserId &&
        (workPackageId === undefined || entry.workPackageId === workPackageId)
      ) {
        this.assigneeCache.delete(key);
      }
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
        return {
          ok: false,
          result: { status: "unavailable", reason: "malformed_response" },
        };
      }
      this.observeIdentity(matrixUserId, client.getOrigin(), identity.id);

      stage = "work_package";
      const workPackage = await client.getWorkPackage(workPackageId);
      if (workPackage._embedded.project.id !== connection.projectId) {
        return {
          ok: false,
          result: { status: "not_authorized", reason: "wrong_project" },
        };
      }
      this.removeExpiredCacheEntries();
      this.removeOlderRevisions(
        client.getOrigin(),
        matrixUserId,
        identity.id,
        workPackage.id,
        workPackage.lockVersion,
      );

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

  private async getAssignees(
    client: OpenProjectAPIClient,
    matrixUserId: string,
    openProjectUserId: number,
    workPackage: OpenProjectWorkPackage,
    bypassCache: boolean,
  ): Promise<OpenProjectAvailableAssignee[]> {
    if (bypassCache) {
      return this.fetchAssignees(client, workPackage.id);
    }

    const cacheKey = assigneeCacheKey(
      client.getOrigin(),
      matrixUserId,
      openProjectUserId,
      workPackage.id,
      workPackage.lockVersion,
    );
    const cached = this.assigneeCache.get(cacheKey);
    if (cached) {
      return cached.promise;
    }

    const entry: AssigneeCacheEntry = {
      origin: client.getOrigin(),
      matrixUserId,
      openProjectUserId,
      workPackageId: workPackage.id,
      lockVersion: workPackage.lockVersion,
      promise: this.fetchAssignees(client, workPackage.id),
    };
    this.assigneeCache.set(cacheKey, entry);
    try {
      const assignees = await entry.promise;
      entry.expiresAt = this.now() + this.assigneeCacheTtlMs;
      return assignees;
    } catch (error) {
      this.assigneeCache.delete(cacheKey);
      throw error;
    }
  }

  private async fetchAssignees(
    client: OpenProjectAPIClient,
    workPackageId: number,
  ): Promise<OpenProjectAvailableAssignee[]> {
    return client.getAvailableAssignees(workPackageId);
  }

  private observeIdentity(
    matrixUserId: string,
    origin: string,
    openProjectUserId: number,
  ): void {
    const identityKey = JSON.stringify([origin, matrixUserId]);
    const previous = this.identityByMatrixUser.get(identityKey);
    if (previous !== undefined && previous !== openProjectUserId) {
      this.invalidateAssigneeCache(matrixUserId);
    }
    this.identityByMatrixUser.set(identityKey, openProjectUserId);
  }

  private removeOlderRevisions(
    origin: string,
    matrixUserId: string,
    openProjectUserId: number,
    workPackageId: number,
    lockVersion: number,
  ): void {
    for (const [key, entry] of this.assigneeCache) {
      if (
        entry.origin === origin &&
        entry.matrixUserId === matrixUserId &&
        entry.openProjectUserId === openProjectUserId &&
        entry.workPackageId === workPackageId &&
        entry.lockVersion !== lockVersion
      ) {
        this.assigneeCache.delete(key);
      }
    }
  }

  private removeExpiredCacheEntries(): void {
    const now = this.now();
    for (const [key, entry] of this.assigneeCache) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        this.assigneeCache.delete(key);
      }
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
