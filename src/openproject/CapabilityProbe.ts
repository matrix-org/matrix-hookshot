import {
  HookshotCapabilitiesProbeRequest,
  HookshotLoginStartRequest,
  HookshotLoginStatusRequest,
  isVersionedHookshotAnchorEventContent,
} from "../ToDeviceProtocol";
import type {
  HookshotProbeHandler,
  HookshotProbeContext,
} from "../ToDeviceReceiver";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_ANCHOR_STATE_ACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "./Schema";
import type { OpenProjectAnchorState } from "./State";
import type { OpenProjectCardActionsResult } from "./Eligibility";
import type {
  HookshotCapabilityAction,
  HookshotLoginCapability,
} from "../ToDeviceProtocol";
import { createMatrixProbeServices } from "../CapabilityMatrixServices";
import { BridgePermissionLevel } from "../config/BridgePermissionLevel";
import type { Appservice } from "matrix-bot-sdk";
import type { BridgeConfig } from "../config/Config";
import type { ConnectionManager } from "../ConnectionManager";
import type { IBridgeStorageProvider } from "../stores/StorageProvider";
import type { UserTokenStore } from "../tokens/UserTokenStore";

export const OPENPROJECT_INTEGRATION_ID = "openproject";

interface AnchorEvent {
  // The SDK event response omits room_id; the lookup is scoped by the request path.
  room_id?: string;
  sender: string;
  content: unknown;
}

export interface OpenProjectProbeServices extends ReturnType<
  typeof createMatrixProbeServices
> {
  hasOpenProjectCommandPermission: (userId: string) => boolean;
  hasOpenProjectLoginPermission: (userId: string) => boolean;
  isLoginServiceConfigured: () => boolean;
  getOpenProjectConnections: (
    projectId: number,
  ) => ReadonlyArray<OpenProjectCapabilityConnection>;
  getOpenProjectAnchorState: (
    connectionId: string,
    workPackageId: number,
  ) => Promise<OpenProjectAnchorState | null>;
}

export interface OpenProjectCapabilityConnection {
  connectionId: string;
  roomId: string;
  botUserId: string;
  projectId: number;
  commandPrefix: string;
  evaluateCardActions: (
    matrixUserId: string,
    workPackageId: number,
  ) => Promise<OpenProjectCardActionsResult>;
}

type ProbeFailureResult = "not_connected" | "not_authorized" | "unavailable";
type EvaluatedOpenProjectCardActions = Extract<
  OpenProjectCardActionsResult,
  { status: "evaluated" }
>;
type OpenProjectActionResult =
  | EvaluatedOpenProjectCardActions["assignSelf"]
  | EvaluatedOpenProjectCardActions["markDone"];
type OpenProjectEvaluationFailure = Exclude<
  OpenProjectCardActionsResult,
  { status: "evaluated" }
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOpenProjectProjectId(content: unknown): number | undefined {
  if (!isRecord(content)) {
    return undefined;
  }

  const project = content["org.matrix.matrix-hookshot.openproject.project"];
  if (!isRecord(project) || typeof project.id !== "number") {
    return undefined;
  }

  return Number.isSafeInteger(project.id) && project.id > 0
    ? project.id
    : undefined;
}

function getOpenProjectWorkPackageId(content: unknown): number | undefined {
  if (!isRecord(content)) {
    return undefined;
  }

  const workPackage =
    content["org.matrix.matrix-hookshot.openproject.work_package"];
  if (!isRecord(workPackage) || typeof workPackage.id !== "number") {
    return undefined;
  }

  return Number.isSafeInteger(workPackage.id) && workPackage.id > 0
    ? workPackage.id
    : undefined;
}

function isCurrentActiveAnchor(
  state: OpenProjectAnchorState | null,
  eventId: string,
  projectId: number,
  workPackageId: number,
): boolean {
  if (
    !state ||
    state.anchorEventId !== eventId ||
    !isRecord(state.lastContent)
  ) {
    return false;
  }
  const project =
    state.lastContent["org.matrix.matrix-hookshot.openproject.project"];
  const workPackage =
    state.lastContent["org.matrix.matrix-hookshot.openproject.work_package"];
  return (
    state.lastContent["org.matrix.matrix-hookshot.openproject.anchor_state"] ===
      OPENPROJECT_ANCHOR_STATE_ACTIVE &&
    isRecord(project) &&
    project.id === projectId &&
    isRecord(workPackage) &&
    workPackage.id === workPackageId
  );
}

function isValidAnchor(
  event: AnchorEvent,
  request: OpenProjectAnchorRequest,
  context: HookshotProbeContext,
): boolean {
  return (
    (event.room_id === undefined || event.room_id === request.room_id) &&
    event.sender === context.recipientBotUserId &&
    isRecord(event.content) &&
    event.content["org.matrix.matrix-hookshot.openproject.anchor_state"] ===
      OPENPROJECT_ANCHOR_STATE_ACTIVE &&
    isVersionedHookshotAnchorEventContent(
      event.content,
      request.integration_id,
      OPENPROJECT_EVENT_SCHEMA_VERSION,
      OPENPROJECT_ANCHOR_EVENT_KIND,
    )
  );
}

export type OpenProjectAnchorRequest = Pick<
  | HookshotCapabilitiesProbeRequest
  | HookshotLoginStartRequest
  | HookshotLoginStatusRequest,
  "integration_id" | "room_id" | "anchor_event_id"
>;

export type OpenProjectAuthorizationResult =
  | {
      status: "authorized";
      connection: OpenProjectCapabilityConnection;
      projectId: number;
      workPackageId: number;
    }
  | { status: "not_authorized" | "unavailable" };

/** Revalidate the original anchor and the sender's current room permissions. */
export async function authorizeOpenProjectRequest(
  services: OpenProjectProbeServices,
  request: OpenProjectAnchorRequest,
  context: HookshotProbeContext,
): Promise<OpenProjectAuthorizationResult> {
  if (request.integration_id !== OPENPROJECT_INTEGRATION_ID) {
    return { status: "unavailable" };
  }

  let anchor: AnchorEvent;
  try {
    anchor = await services.getAnchorEvent(
      request.room_id,
      request.anchor_event_id,
      context.recipientBotUserId,
    );
  } catch (error) {
    const status = getHttpStatus(error);
    return {
      status:
        status === 403 || status === 404 ? "not_authorized" : "unavailable",
    };
  }

  if (!isValidAnchor(anchor, request, context)) {
    return { status: "not_authorized" };
  }

  const projectId = getOpenProjectProjectId(anchor.content);
  const workPackageId = getOpenProjectWorkPackageId(anchor.content);
  if (projectId === undefined || workPackageId === undefined) {
    return { status: "not_authorized" };
  }

  let connections: OpenProjectCapabilityConnection[];
  try {
    connections = services
      .getOpenProjectConnections(projectId)
      .filter(
        (candidate) =>
          candidate.roomId === request.room_id &&
          candidate.botUserId === context.recipientBotUserId &&
          candidate.projectId === projectId,
      );
  } catch {
    return { status: "unavailable" };
  }
  if (connections.length === 0) {
    return { status: "not_authorized" };
  }

  const currentConnections: OpenProjectCapabilityConnection[] = [];
  try {
    for (const connection of connections) {
      const activeAnchor = await services.getOpenProjectAnchorState(
        connection.connectionId,
        workPackageId,
      );
      if (
        isCurrentActiveAnchor(
          activeAnchor,
          request.anchor_event_id,
          projectId,
          workPackageId,
        )
      ) {
        currentConnections.push(connection);
      }
    }
  } catch {
    return { status: "unavailable" };
  }
  if (currentConnections.length !== 1) {
    return { status: "not_authorized" };
  }

  try {
    await services.assertRoomReadAccess(
      context.sender,
      request.room_id,
      context.recipientBotUserId,
    );
  } catch {
    return { status: "not_authorized" };
  }

  try {
    if (!services.hasOpenProjectCommandPermission(context.sender)) {
      return { status: "not_authorized" };
    }
  } catch {
    return { status: "not_authorized" };
  }

  let canSendMessage: boolean;
  try {
    canSendMessage = await services.canSendRoomMessage(
      context.sender,
      request.room_id,
      context.recipientBotUserId,
    );
  } catch {
    return { status: "unavailable" };
  }
  if (!canSendMessage) {
    return { status: "not_authorized" };
  }

  return {
    status: "authorized",
    connection: currentConnections[0],
    projectId,
    workPackageId,
  };
}

/**
 * Creates the OpenProject authenticated card probe handler.
 *
 * The service boundary keeps the receiver independent from connection and
 * token storage. It also makes it explicit that the Matrix to-device sender,
 * rather than request content, supplies the caller identity.
 */
export function createOpenProjectProbeHandler(
  services: OpenProjectProbeServices,
): HookshotProbeHandler {
  return async (
    request: HookshotCapabilitiesProbeRequest,
    context: HookshotProbeContext,
  ) => {
    const authorization = await authorizeOpenProjectRequest(
      services,
      request,
      context,
    );
    if (authorization.status !== "authorized") {
      return { result: authorization.status };
    }
    const { connection, projectId, workPackageId } = authorization;

    let evaluation: OpenProjectCardActionsResult;
    try {
      evaluation = await connection.evaluateCardActions(
        context.sender,
        workPackageId,
      );
    } catch {
      return { result: "unavailable" as const };
    }

    const evaluationFailure = getEvaluationFailure(evaluation);
    if (evaluationFailure) {
      return evaluationFailure === "not_connected"
        ? {
            result: "not_connected" as const,
            connection: "not_connected" as const,
            login: getLoginCapability(services, context.sender),
          }
        : { result: evaluationFailure };
    }
    if (evaluation.status !== "evaluated") {
      return { result: "unavailable" as const };
    }

    let currentConnection: OpenProjectCapabilityConnection | undefined;
    let isCurrentAnchor = false;
    try {
      currentConnection = services
        .getOpenProjectConnections(projectId)
        .find(
          (candidate) =>
            candidate.connectionId === connection.connectionId &&
            candidate.roomId === request.room_id &&
            candidate.botUserId === context.recipientBotUserId &&
            candidate.projectId === projectId,
        );
      if (currentConnection) {
        const currentState = await services.getOpenProjectAnchorState(
          connection.connectionId,
          workPackageId,
        );
        isCurrentAnchor = isCurrentActiveAnchor(
          currentState,
          request.anchor_event_id,
          projectId,
          workPackageId,
        );
      }
    } catch {
      return { result: "unavailable" as const };
    }
    if (!currentConnection || !isCurrentAnchor) {
      return { result: "not_authorized" as const };
    }

    const actions: HookshotCapabilityAction[] = [];
    const prefix = currentConnection.commandPrefix.trimEnd();
    if (!isSafeCommandPrefix(prefix)) {
      return { result: "unavailable" as const };
    }
    if (evaluation.assignSelf.status === "eligible") {
      actions.push({
        id: "assign_self",
        label: "Assign to me",
        command: `${prefix} assign ${workPackageId}`,
      });
    }
    if (evaluation.markDone.status === "eligible") {
      actions.push({
        id: "mark_done",
        label: "Mark as done",
        command: `${prefix} close ${workPackageId}`,
      });
    }
    return {
      result: "ok" as const,
      connection: "connected" as const,
      actions,
    };
  };
}

/** Wire OpenProject dependencies into its probe without exposing them to Bridge. */
export function createOpenProjectCapabilityProbe(dependencies: {
  appservice: Appservice;
  config: BridgeConfig;
  getConnectionManager: () => ConnectionManager | undefined;
  storage: IBridgeStorageProvider;
  tokenStore: Pick<UserTokenStore, "openProjectOAuth">;
}): HookshotProbeHandler {
  const { appservice, config, getConnectionManager, storage, tokenStore } =
    dependencies;
  return createOpenProjectProbeHandler({
    ...createMatrixProbeServices(appservice),
    hasOpenProjectCommandPermission: (userId) =>
      config.checkPermission(
        userId,
        OPENPROJECT_INTEGRATION_ID,
        BridgePermissionLevel.commands,
      ),
    hasOpenProjectLoginPermission: (userId) =>
      config.checkPermission(
        userId,
        OPENPROJECT_INTEGRATION_ID,
        BridgePermissionLevel.login,
      ),
    isLoginServiceConfigured: () => tokenStore.openProjectOAuth !== undefined,
    getOpenProjectConnections: (projectId) =>
      (
        getConnectionManager()?.getConnectionsForOpenProject(projectId) ?? []
      ).map((connection) => connection.getCapabilityConnection()),
    getOpenProjectAnchorState: (connectionId, workPackageId) =>
      storage.getOpenProjectAnchorState(connectionId, workPackageId),
  });
}

function getLoginCapability(
  services: OpenProjectProbeServices,
  sender: string,
): HookshotLoginCapability {
  try {
    if (!services.hasOpenProjectLoginPermission(sender)) {
      return "not_authorized";
    }
  } catch {
    return "not_authorized";
  }

  try {
    return services.isLoginServiceConfigured() ? "available" : "unavailable";
  } catch {
    return "unavailable";
  }
}

function getEvaluationFailure(
  evaluation: OpenProjectCardActionsResult,
): ProbeFailureResult | undefined {
  if (evaluation.status !== "evaluated") {
    return getActionFailure(evaluation);
  }
  const failures = [
    getActionFailure(evaluation.assignSelf),
    getActionFailure(evaluation.markDone),
  ];
  if (failures.includes("unavailable")) return "unavailable";
  if (failures.includes("not_connected")) return "not_connected";
  if (failures.includes("not_authorized")) return "not_authorized";
  return undefined;
}

function getActionFailure(
  result: OpenProjectActionResult | OpenProjectEvaluationFailure,
): ProbeFailureResult | undefined {
  switch (result.status) {
    case "not_connected":
      return "not_connected";
    case "not_authorized":
      return "not_authorized";
    case "unavailable":
    case "conflict":
      return "unavailable";
    case "ineligible":
      return result.reason === "invalid_work_package_id"
        ? "not_authorized"
        : undefined;
    case "eligible":
    case "stale_target":
      return undefined;
    default:
      return "unavailable";
  }
}

function isSafeCommandPrefix(prefix: string): boolean {
  return (
    prefix.length >= 2 &&
    prefix.length <= 48 &&
    prefix.trim() === prefix &&
    !/[\p{Cc}]/u.test(prefix)
  );
}

function getHttpStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  if (typeof error.statusCode === "number") {
    return error.statusCode;
  }
  if (isRecord(error.response) && typeof error.response.status === "number") {
    return error.response.status;
  }
  return undefined;
}
