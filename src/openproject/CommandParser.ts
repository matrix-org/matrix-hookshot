import { CommandError } from "../Errors";
import type { MatrixMessageContent } from "../MatrixEvent";

interface ReplyEvent {
  type: string;
  content: unknown;
}

/** Parsed work package and optional assignee from an assignment command. */
export interface AssignmentCommandArguments {
  workPackageId: number;
  requestedUser?: string;
}

/**
 * Assignment command input, distinguishing a replied-to work package from an
 * ID supplied directly in the command.
 */
export type AssignmentCommandInput =
  | {
      kind: "reply";
      workPackageId: number;
      userParts: readonly (string | undefined)[];
    }
  | {
      kind: "explicit_id";
      workPackageIdArgument?: string;
      userParts: readonly (string | undefined)[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse and validate a positive OpenProject work package ID. */
export function parseWorkPackageId(argument: string): number {
  // Example accepted: "12345".
  const containsOnlyDigits = /^\d+$/.test(argument);
  if (!containsOnlyDigits) {
    throw new CommandError(
      "Invalid work package ID",
      "Work package ID must be a positive safe integer.",
    );
  }
  const workPackageId = Number(argument);
  if (!Number.isSafeInteger(workPackageId) || workPackageId <= 0) {
    throw new CommandError(
      "Invalid work package ID",
      "Work package ID must be a positive safe integer.",
    );
  }
  return workPackageId;
}

/** Read the OpenProject project ID attached to a replied-to event. */
export function getProjectIdFromReplyContent(
  content: unknown,
): number | undefined {
  if (!isRecord(content)) {
    return undefined;
  }

  const project = content["org.matrix.matrix-hookshot.openproject.project"];
  if (
    !isRecord(project) ||
    typeof project.id !== "number" ||
    !Number.isSafeInteger(project.id) ||
    project.id <= 0
  ) {
    return undefined;
  }
  return project.id;
}

/**
 * Resolve a work package ID from a Hookshot reply, returning undefined when
 * the valid reply belongs to another OpenProject connection.
 */
export function getWorkPackageIdFromReply(
  reply: ReplyEvent | undefined,
  expectedProjectId: number,
): number | undefined {
  if (!reply) {
    return undefined;
  }

  const content = isRecord(reply.content) ? reply.content : undefined;
  const workPackage =
    content?.["org.matrix.matrix-hookshot.openproject.work_package"];
  const workPackageId = isRecord(workPackage) ? workPackage.id : undefined;
  const projectId = getProjectIdFromReplyContent(reply.content);
  if (
    reply.type !== "m.room.message" ||
    typeof workPackageId !== "number" ||
    !Number.isSafeInteger(workPackageId) ||
    workPackageId <= 0 ||
    projectId === undefined
  ) {
    throw new CommandError(
      "Did not reference a hookshot event",
      "You must reply to a work package message when running this command.",
    );
  }

  return projectId === expectedProjectId ? workPackageId : undefined;
}

/**
 * Replace an Element user pill's display label with its Matrix ID for the
 * assignment command parser, when the pill is the command's trailing argument.
 */
export function normalizeAssignmentMention(
  content: MatrixMessageContent,
): string {
  // Reply metadata can add mentions, so require exactly one user mention.
  const mentions = (
    content as MatrixMessageContent & { "m.mentions"?: unknown }
  )["m.mentions"];
  const userIds = isRecord(mentions) ? mentions.user_ids : undefined;
  if (
    !Array.isArray(userIds) ||
    userIds.length !== 1 ||
    typeof userIds[0] !== "string"
  ) {
    return content.body;
  }

  const userId = userIds[0];
  // Example accepted: "@alice:example.org".
  const isValidMatrixUserId = /^@[^:\s]+:[^\s]+$/.test(userId);
  if (
    !isValidMatrixUserId ||
    content.format !== "org.matrix.custom.html" ||
    typeof content.formatted_body !== "string"
  ) {
    return content.body;
  }

  // Example matched: "!op assign <a href=\"...\">Alice</a>".
  const trailingPill = /^(.*)<a\b[^>]*>([^<>]+)<\/a>\s*$/.exec(
    content.formatted_body,
  );
  if (!trailingPill) {
    return content.body;
  }

  // Example accepted: "!op responsible 123 ".
  const hasAssignmentCommandPrefix =
    /\b(?:assign|responsible)(?:\s+[1-9]\d*)?\s+$/.test(trailingPill[1]);
  if (
    !hasAssignmentCommandPrefix ||
    content.body.trimEnd() !== `${trailingPill[1]}${trailingPill[2]}`
  ) {
    return content.body;
  }

  return `${trailingPill[1]}${userId}`;
}

/** Parse an assignment command's ID and optional multiword user argument. */
export function parseAssignmentCommandArguments(
  input: AssignmentCommandInput,
): AssignmentCommandArguments {
  if (input.kind === "reply") {
    return {
      workPackageId: input.workPackageId,
      requestedUser: joinUserArgument(input.userParts),
    };
  }

  if (!input.workPackageIdArgument) {
    throw new CommandError(
      "No ID provided",
      "You must provide a work package ID",
    );
  }

  return {
    workPackageId: parseWorkPackageId(input.workPackageIdArgument),
    requestedUser: joinUserArgument(input.userParts),
  };
}

function joinUserArgument(
  parts: readonly (string | undefined)[],
): string | undefined {
  return (
    parts.filter((part): part is string => part !== undefined).join(" ") ||
    undefined
  );
}
