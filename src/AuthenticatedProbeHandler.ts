import {
  HookshotCapabilitiesProbeRequest,
  isVersionedHookshotAnchorEventContent,
} from "./ToDeviceProtocol";
import type {
  HookshotProbeHandler,
  HookshotProbeContext,
} from "./ToDeviceReceiver";

export const OPENPROJECT_INTEGRATION_ID = "openproject";

interface AnchorEvent {
  // The SDK event response omits room_id; the lookup is scoped by the request path.
  room_id?: string;
  sender: string;
  content: unknown;
}

export interface AuthenticatedProbeServices {
  getAnchorEvent: (
    roomId: string,
    eventId: string,
    recipientBotUserId: string,
  ) => Promise<AnchorEvent>;
  assertRoomReadAccess: (
    userId: string,
    roomId: string,
    recipientBotUserId: string,
  ) => Promise<void>;
  getOpenProjectForUser: (userId: string) => Promise<unknown | null>;
  getOpenProjectConnections: (
    projectId: number,
  ) => ReadonlyArray<{ roomId: string; botUserId?: string }>;
}

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

function isValidAnchor(
  event: AnchorEvent,
  request: HookshotCapabilitiesProbeRequest,
  context: HookshotProbeContext,
): boolean {
  return (
    (event.room_id === undefined || event.room_id === request.room_id) &&
    event.sender === context.recipientBotUserId &&
    isVersionedHookshotAnchorEventContent(event.content, request.integration_id)
  );
}

/**
 * Creates the first integration-specific authenticated probe handler.
 *
 * The service boundary keeps the receiver independent from connection and
 * token storage. It also makes it explicit that the Matrix to-device sender,
 * rather than request content, supplies the caller identity.
 */
export function createAuthenticatedProbeHandler(
  services: AuthenticatedProbeServices,
): HookshotProbeHandler {
  return async (
    request: HookshotCapabilitiesProbeRequest,
    context: HookshotProbeContext,
  ) => {
    if (request.integration_id !== OPENPROJECT_INTEGRATION_ID) {
      return { result: "unavailable" as const };
    }

    let anchor: AnchorEvent;
    try {
      anchor = await services.getAnchorEvent(
        request.room_id,
        request.anchor_event_id,
        context.recipientBotUserId,
      );
    } catch {
      return { result: "not_authorized" as const };
    }

    if (!isValidAnchor(anchor, request, context)) {
      return { result: "not_authorized" as const };
    }

    const projectId = getOpenProjectProjectId(anchor.content);
    if (projectId === undefined) {
      return { result: "not_authorized" as const };
    }

    if (
      !services
        .getOpenProjectConnections(projectId)
        .some(
          (connection) =>
            connection.roomId === request.room_id &&
            (connection.botUserId === undefined ||
              connection.botUserId === context.recipientBotUserId),
        )
    ) {
      return { result: "not_authorized" as const };
    }

    try {
      await services.assertRoomReadAccess(
        context.sender,
        request.room_id,
        context.recipientBotUserId,
      );
    } catch {
      return { result: "not_authorized" as const };
    }

    let openProjectClient: unknown | null;
    try {
      openProjectClient = await services.getOpenProjectForUser(context.sender);
    } catch {
      return { result: "unavailable" as const };
    }

    return openProjectClient
      ? { result: "ok" as const, connection: "connected" as const }
      : { result: "not_connected" as const };
  };
}
