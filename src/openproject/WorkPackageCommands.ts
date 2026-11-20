import { UserID } from "matrix-bot-sdk";
import type { MatrixEvent, MessageEventContent } from "matrix-bot-sdk";
import { CommandError, NotLoggedInError } from "../Errors";
import type { UserTokenStore } from "../tokens/UserTokenStore";
import { getAxiosErrorStatus } from "../util/axios";
import type { OpenProjectAPIClient } from "./Client";
import {
  OpenProjectEligibilityService,
  type OpenProjectAssignmentResult,
  type OpenProjectEligibilityConnection,
  type OpenProjectMarkDoneResult,
} from "./Eligibility";
import type { AssignmentCommandInput } from "./CommandParser";
import { parseAssignmentCommandArguments } from "./CommandParser";

/** Services used by commands that operate on OpenProject work packages. */
export interface OpenProjectWorkPackageCommandContext extends OpenProjectEligibilityConnection {
  readonly baseURL: URL;
  readonly tokenStore: UserTokenStore;
  getCompletionStatusOptionId(): string | undefined;
  getWorkPackageIDFromReply(reply?: MatrixEvent<unknown>): number | undefined;
}

interface ResolvedCommandUser {
  href: string | null;
  userId?: number;
}

interface UserResolutionOptions {
  missingMatrixUserMessage: string;
  requireSameOpenProjectInstance: boolean;
  fallbackToNameSearchAfterMatrixError: boolean;
}

/** Executes OpenProject work package commands. */
export class OpenProjectWorkPackageCommandService {
  public constructor(
    private readonly context: OpenProjectWorkPackageCommandContext,
    private readonly eligibilityService: OpenProjectEligibilityService,
  ) {}

  /** Create a work package, optionally using a replied-to message as its description. */
  public async createWorkPackage(
    userId: string,
    reply: MatrixEvent<unknown> | undefined,
    type: string,
    subject: string,
    cmdDescription?: string,
  ): Promise<void> {
    const client = await this.getClient(userId);
    let finalDescription: string | undefined;
    if (reply) {
      if (reply.type !== "m.room.message") {
        throw new CommandError(
          "Reply was not a m.room.message",
          "You can only use textual events as work package descriptions.",
        );
      }
      const replyContent = reply.content as MessageEventContent;
      if (!replyContent.body?.trim()) {
        throw new CommandError(
          "Source message had no body",
          "This event has no content and cannot be used.",
        );
      }
      finalDescription = cmdDescription
        ? `${cmdDescription}\n\n${replyContent.body}`
        : replyContent.body;
    } else {
      finalDescription = cmdDescription;
    }

    const allTypes = await client.getTypesInProject(this.context.projectId);
    const foundType = allTypes.find(
      (candidate) => candidate.name.toLowerCase() === type.toLowerCase(),
    );
    if (!foundType) {
      throw new CommandError(
        "Type not understood",
        `Work package type not known. You can use ${allTypes.map((candidate) => (candidate.name.includes(" ") ? `"${candidate.name}"` : candidate.name)).join(", ")}`,
      );
    }
    await client.createWorkPackage(
      this.context.projectId,
      foundType,
      subject,
      finalDescription,
    );
  }

  /** Close a work package and optionally add a comment. */
  public async closeWorkPackage(
    userId: string,
    reply: MatrixEvent<unknown> | undefined,
    workPackageIdOrComment?: string,
    comment?: string,
  ): Promise<void> {
    let finalComment: string | undefined;
    let workPackageId: number;
    const replyWorkPackageId = this.context.getWorkPackageIDFromReply(reply);
    if (replyWorkPackageId) {
      workPackageId = replyWorkPackageId;
      finalComment = workPackageIdOrComment;
    } else if (workPackageIdOrComment) {
      if (!/^\d+$/.test(workPackageIdOrComment)) {
        throw new CommandError(
          "Invalid work package ID",
          "Work package ID must be a positive safe integer.",
        );
      }
      workPackageId = Number(workPackageIdOrComment);
      finalComment = comment;
    } else {
      throw new CommandError(
        "No ID provided",
        "You must provide a work package ID",
      );
    }
    if (!Number.isSafeInteger(workPackageId) || workPackageId <= 0) {
      throw new CommandError(
        "Invalid work package ID",
        "Work package ID must be a positive safe integer.",
      );
    }

    const result = await this.eligibilityService.evaluateMarkDone(
      userId,
      this.context,
      workPackageId,
    );
    if (result.status !== "eligible") {
      throw this.markDoneCommandError(result);
    }

    const client = await this.getClient(userId);
    try {
      await client.updateWorkPackage(result.workPackageId, result.lockVersion, {
        _links: { status: { href: result.targetHref } },
      });
    } catch (error) {
      throw this.markDoneMutationError(error);
    }
    if (finalComment) {
      try {
        await client.addWorkPackageComment(result.workPackageId, finalComment);
      } catch {
        throw new CommandError(
          "Work package closed but comment failed",
          "The work package was closed, but Hookshot could not add your comment.",
        );
      }
    }
  }

  /** Set a work package's priority. */
  public async setPriority(
    userId: string,
    reply: MatrixEvent<unknown> | undefined,
    workPackageIdOrPriority?: string,
    priority?: string,
  ): Promise<void> {
    const client = await this.getClient(userId);
    let finalPriority: string | undefined;
    let workPackageId: number;
    const replyWorkPackageId = this.context.getWorkPackageIDFromReply(reply);
    if (replyWorkPackageId) {
      workPackageId = replyWorkPackageId;
      finalPriority = workPackageIdOrPriority;
    } else if (workPackageIdOrPriority) {
      workPackageId = parseInt(workPackageIdOrPriority);
      finalPriority = priority;
    } else {
      throw new CommandError(
        "No ID provided",
        "You must provide a work package ID",
      );
    }
    if (isNaN(workPackageId)) {
      throw new CommandError(
        "Invalid work package ID",
        "Work Package ID must be a valid number",
      );
    }

    const priorities = await client.getPriorities();
    if (!finalPriority) {
      throw new CommandError(
        "Priority not provided",
        `Priority not provided. You can use ${priorities.map((candidate) => (candidate.name.includes(" ") ? `"${candidate.name}"` : candidate.name)).join(", ")}`,
      );
    }

    const priorityRef = (await client.getPriorities()).find(
      (candidate) =>
        candidate.name.toLowerCase() === finalPriority?.toLowerCase(),
    );
    if (!priorityRef) {
      throw new CommandError(
        "Priority not understood",
        `Priority not understood. You can use ${priorities.map((candidate) => (candidate.name.includes(" ") ? `"${candidate.name}"` : candidate.name)).join(", ")}`,
      );
    }

    const workPackage = await client.getWorkPackage(workPackageId);
    await client.updateWorkPackage(workPackageId, workPackage.lockVersion, {
      _links: { priority: { href: priorityRef._links.self.href } },
    });
  }

  /** Change the assignee or responsible user for a work package. */
  public async changeWorkPackageUser(
    field: "assignee" | "responsible",
    userId: string,
    reply: MatrixEvent<unknown> | undefined,
    workPackageIdOrUser?: string,
    providedUser?: string,
    ...additionalUserParts: string[]
  ): Promise<void> {
    const replyWorkPackageId = this.context.getWorkPackageIDFromReply(reply);
    const input: AssignmentCommandInput =
      replyWorkPackageId !== undefined
        ? {
            kind: "reply",
            workPackageId: replyWorkPackageId,
            userParts: [
              workPackageIdOrUser,
              providedUser,
              ...additionalUserParts,
            ],
          }
        : {
            kind: "explicit_id",
            workPackageIdArgument: workPackageIdOrUser,
            userParts: [providedUser, ...additionalUserParts],
          };
    const { workPackageId, requestedUser } =
      parseAssignmentCommandArguments(input);

    if (field === "assignee") {
      await this.assignWorkPackage(userId, workPackageId, requestedUser);
      return;
    }
    await this.setResponsibleWorkPackage(userId, workPackageId, requestedUser);
  }

  private async setResponsibleWorkPackage(
    userId: string,
    workPackageId: number,
    responsibleName?: string,
  ): Promise<void> {
    const client = await this.getClient(userId);
    let userHref: { href: string | null };

    if (responsibleName) {
      const target = await this.resolveCommandUser(
        responsibleName,
        userId,
        client,
        {
          missingMatrixUserMessage:
            "Matrix user does not map to a OpenProject user",
          requireSameOpenProjectInstance: false,
          fallbackToNameSearchAfterMatrixError: true,
        },
      );
      userHref = { href: target.href };
    } else {
      userHref = (await client.getIdentity())._links.self;
    }

    const workPackage = await client.getWorkPackage(workPackageId);
    await client.updateWorkPackage(workPackageId, workPackage.lockVersion, {
      _links: { responsible: { href: userHref.href } },
    });
  }

  private async assignWorkPackage(
    matrixUserId: string,
    workPackageId: number,
    assigneeName?: string,
  ): Promise<void> {
    let target: { href: string | null; userId?: number } | undefined;
    if (assigneeName !== undefined) {
      target = await this.resolveCommandUser(
        assigneeName,
        matrixUserId,
        undefined,
        {
          missingMatrixUserMessage:
            "Matrix user does not map to an OpenProject user",
          requireSameOpenProjectInstance: true,
          fallbackToNameSearchAfterMatrixError: false,
        },
      );
    }

    const result = await this.eligibilityService.executeAssignment(
      matrixUserId,
      this.context,
      workPackageId,
      target === undefined ? { kind: "self" } : { kind: "user", ...target },
    );
    if (result.status !== "eligible") {
      throw this.assignmentCommandError(result);
    }
  }

  private async resolveCommandUser(
    requestedName: string,
    requestingMatrixUserId: string,
    requestingClient: OpenProjectAPIClient | undefined,
    options: UserResolutionOptions,
  ): Promise<ResolvedCommandUser> {
    if (["none", "unset"].includes(requestedName.toLowerCase())) {
      return { href: null };
    }

    const targetMatrixUserId = this.parseMatrixUserId(requestedName);
    if (targetMatrixUserId) {
      try {
        const userClient =
          await this.context.tokenStore.getOpenProjectForUser(
            targetMatrixUserId,
          );
        if (!userClient) {
          throw new CommandError(
            "Invalid user",
            options.missingMatrixUserMessage,
          );
        }
        if (
          options.requireSameOpenProjectInstance &&
          userClient.getOrigin() !== this.context.baseURL.origin
        ) {
          throw new CommandError(
            "Invalid user",
            "Matrix user is not connected to this OpenProject instance",
          );
        }

        const identity = await userClient.getIdentity();
        return {
          href: identity._links.self.href,
          userId: identity.id,
        };
      } catch (error) {
        if (
          error instanceof CommandError ||
          !options.fallbackToNameSearchAfterMatrixError
        ) {
          throw error;
        }
      }
    }

    const client =
      requestingClient ?? (await this.getClient(requestingMatrixUserId));
    const foundUser = await client.searchForUserInProject(
      this.context.projectId,
      requestedName,
    );
    if (!foundUser) {
      throw new CommandError(
        "Invalid user",
        "Could not find a user by that name",
      );
    }
    return { href: foundUser.href };
  }

  private markDoneCommandError(
    result: Exclude<OpenProjectMarkDoneResult, { status: "eligible" }>,
  ): CommandError {
    switch (result.status) {
      case "not_connected":
        return new NotLoggedInError();
      case "conflict":
        return new CommandError(
          "Work package changed",
          "The work package changed while its completion workflow was being checked. Please try again.",
        );
      case "not_authorized":
        switch (result.reason) {
          case "wrong_project":
            return new CommandError(
              "Work package belongs to another project",
              "This work package is not part of the project configured for this connection.",
            );
          case "work_package_not_found":
            return new CommandError(
              "Work package not found",
              "The work package could not be found or is not accessible to you.",
            );
          case "openproject_permission":
            return new CommandError(
              "OpenProject permission denied",
              "You do not have permission to check or update this work package in OpenProject.",
            );
        }
        break;
      case "ineligible":
        switch (result.reason) {
          case "invalid_work_package_id":
            return new CommandError(
              "Invalid work package ID",
              "Work package ID must be a positive safe integer.",
            );
          case "already_closed":
            return new CommandError(
              "Work package already closed",
              "This work package is already in a closed status.",
            );
          case "status_not_writable":
            return new CommandError(
              "Work package cannot be closed",
              "OpenProject does not allow you to change this work package's status.",
            );
          case "target_not_allowed":
            return new CommandError(
              "Completion status not allowed",
              "The configured completion status is not available for this work package's current workflow.",
            );
          case "status_form_invalid":
            return new CommandError(
              "Completion transition rejected",
              "OpenProject rejected this completion transition for the work package.",
            );
        }
        break;
      case "stale_target":
        if (
          result.reason === "default_status_missing" ||
          result.reason === "default_status_ambiguous"
        ) {
          return new CommandError(
            "Completion status must be configured",
            "Configure a completion status for this room; the legacy Closed status is missing or ambiguous for this workflow.",
          );
        }
        return new CommandError(
          "Configured completion status is unavailable",
          "The selected completion status is missing or no longer closed. Choose a valid completion status in the room configuration.",
        );
      case "unavailable":
        switch (result.reason) {
          case "connection_removed":
            return new CommandError(
              "OpenProject connection removed",
              "This OpenProject connection is no longer active.",
            );
          case "malformed_response":
            return new CommandError(
              "Invalid OpenProject response",
              "OpenProject returned data that Hookshot could not use to check this completion transition.",
            );
          case "openproject_error":
            return new CommandError(
              "OpenProject unavailable",
              "Hookshot could not check this completion transition in OpenProject. Please try again later.",
            );
        }
        break;
    }
    return new CommandError(
      "Could not close work package",
      "Hookshot could not validate this completion transition.",
    );
  }

  private markDoneMutationError(error: unknown): CommandError {
    const status = getAxiosErrorStatus(error);
    if (status === 409) {
      return new CommandError(
        "Work package changed",
        "The work package changed before it could be closed. No retry was attempted; please run the command again.",
      );
    }
    if (status === 401 || status === 403) {
      return new CommandError(
        "OpenProject permission denied",
        "OpenProject denied permission to close this work package.",
      );
    }
    if (status === 404) {
      return new CommandError(
        "Work package not found",
        "The work package could not be found or is no longer accessible.",
      );
    }
    if (status === 400 || status === 422) {
      return new CommandError(
        "Completion transition rejected",
        "OpenProject rejected this completion transition. The work package may no longer allow it.",
      );
    }
    return new CommandError(
      "OpenProject unavailable",
      "Hookshot could not close this work package in OpenProject. Please try again later.",
    );
  }

  private assignmentCommandError(
    result: Exclude<OpenProjectAssignmentResult, { status: "eligible" }>,
  ): CommandError {
    switch (result.status) {
      case "not_connected":
        return new NotLoggedInError();
      case "conflict":
        return new CommandError(
          "Work package changed",
          "The work package changed while assignment was being checked. Please try again.",
        );
      case "not_authorized":
        switch (result.reason) {
          case "wrong_project":
            return new CommandError(
              "Work package belongs to another project",
              "This work package is not part of the project configured for this connection.",
            );
          case "work_package_not_found":
            return new CommandError(
              "Work package not found",
              "The work package could not be found or is not accessible to you.",
            );
          case "openproject_permission":
            return new CommandError(
              "OpenProject permission denied",
              "You do not have permission to assign this work package in OpenProject.",
            );
          default:
            return new CommandError(
              "Assignment failed",
              "Hookshot could not authorize this assignment.",
            );
        }
      case "ineligible":
        switch (result.reason) {
          case "invalid_work_package_id":
            return new CommandError(
              "Invalid work package ID",
              "Work package ID must be a positive safe integer.",
            );
          case "already_assigned":
            return new CommandError(
              "Already assigned",
              "This work package is already assigned to that user.",
            );
          case "target_not_available":
            return new CommandError(
              "Assignee unavailable",
              "That user cannot be assigned to this work package.",
            );
          case "assignee_not_writable":
            return new CommandError(
              "Assignee cannot be changed",
              "The assignee field cannot be changed on this work package.",
            );
          case "assignment_invalid":
            return new CommandError(
              "Assignment rejected",
              "OpenProject rejected this assignee for the work package.",
            );
          default:
            return new CommandError(
              "Assignment failed",
              "Hookshot could not validate this assignment.",
            );
        }
      case "unavailable":
        switch (result.reason) {
          case "connection_removed":
            return new CommandError(
              "OpenProject connection removed",
              "This OpenProject connection is no longer active.",
            );
          case "malformed_response":
            return new CommandError(
              "Invalid OpenProject response",
              "OpenProject returned data that Hookshot could not use to check this assignment.",
            );
          case "openproject_error":
            return new CommandError(
              "OpenProject unavailable",
              "Hookshot could not check or update this assignment in OpenProject. Please try again later.",
            );
          default:
            return new CommandError(
              "OpenProject unavailable",
              "Hookshot could not check or update this assignment in OpenProject. Please try again later.",
            );
        }
      default:
        return new CommandError(
          "Assignment failed",
          "Hookshot could not complete this assignment.",
        );
    }
  }

  private parseMatrixUserId(value: string): string | undefined {
    try {
      return new UserID(value).toString();
    } catch {
      return undefined;
    }
  }

  private async getClient(userId: string) {
    const client = await this.context.tokenStore.getOpenProjectForUser(userId);
    if (!client) {
      throw new NotLoggedInError();
    }
    return client;
  }
}
