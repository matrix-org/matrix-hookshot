import type {
  HookshotLoginStartRequest,
  HookshotLoginStatusRequest,
  HookshotLoginStatusResult,
} from "../ToDeviceProtocol";
import type { HookshotProbeContext } from "../ToDeviceReceiver";
import {
  authorizeOpenProjectRequest,
  OpenProjectProbeServices,
} from "./CapabilityProbe";

export type OpenProjectLoginStartResponseState =
  | { result: "ready"; auth_url: string }
  | {
      result: "already_connected" | "not_authorized" | "unavailable";
    };

export interface OpenProjectLoginHandlerServices extends OpenProjectProbeServices {
  getOpenProjectToken: (userId: string) => Promise<string | null>;
  createOAuthState: (userId: string) => string;
  getAuthUrl: (state: string) => Promise<string>;
  discardOAuthState: (state: string) => void;
}

/** Create an OpenProject login-start handler with fresh request authorization. */
export function createOpenProjectLoginStartHandler(
  services: OpenProjectLoginHandlerServices,
): (
  request: HookshotLoginStartRequest,
  context: HookshotProbeContext,
) => Promise<OpenProjectLoginStartResponseState> {
  return async (request, context) => {
    const authorization = await authorizeOpenProjectRequest(
      services,
      request,
      context,
    );
    if (authorization.status !== "authorized") {
      return { result: authorization.status };
    }

    if (!hasLoginPermission(services, context.sender)) {
      return { result: "not_authorized" };
    }
    if (!isLoginServiceConfigured(services)) {
      return { result: "unavailable" };
    }

    let token: string | null;
    try {
      token = await services.getOpenProjectToken(context.sender);
    } catch {
      return { result: "unavailable" };
    }
    if (token !== null) {
      return { result: "already_connected" };
    }

    // State is created only after the account and all request permissions are rechecked.
    const currentAuthorization = await authorizeOpenProjectRequest(
      services,
      request,
      context,
    );
    if (currentAuthorization.status !== "authorized") {
      return { result: currentAuthorization.status };
    }
    if (!hasLoginPermission(services, context.sender)) {
      return { result: "not_authorized" };
    }
    if (!isLoginServiceConfigured(services)) {
      return { result: "unavailable" };
    }

    try {
      token = await services.getOpenProjectToken(context.sender);
    } catch {
      return { result: "unavailable" };
    }
    if (token !== null) {
      return { result: "already_connected" };
    }

    let state: string | undefined;
    try {
      state = services.createOAuthState(context.sender);
      const authUrl = await services.getAuthUrl(state);
      return { result: "ready", auth_url: authUrl };
    } catch {
      if (state !== undefined) {
        try {
          services.discardOAuthState(state);
        } catch {
          // State cleanup is best-effort; never expose OAuth internals here.
        }
      }
      return { result: "unavailable" };
    }
  };
}

/** Create a status handler that reveals only whether a token is stored. */
export function createOpenProjectLoginStatusHandler(
  services: OpenProjectLoginHandlerServices,
): (
  request: HookshotLoginStatusRequest,
  context: HookshotProbeContext,
) => Promise<{ result: HookshotLoginStatusResult }> {
  return async (request, context) => {
    const authorization = await authorizeOpenProjectRequest(
      services,
      request,
      context,
    );
    if (authorization.status !== "authorized") {
      return { result: "unavailable" };
    }
    if (!hasLoginPermission(services, context.sender)) {
      return { result: "unavailable" };
    }
    if (!isLoginServiceConfigured(services)) {
      return { result: "unavailable" };
    }

    try {
      const token = await services.getOpenProjectToken(context.sender);
      return { result: token === null ? "not_connected" : "connected" };
    } catch {
      return { result: "unavailable" };
    }
  };
}

function hasLoginPermission(
  services: OpenProjectLoginHandlerServices,
  userId: string,
): boolean {
  try {
    return services.hasOpenProjectLoginPermission(userId);
  } catch {
    return false;
  }
}

function isLoginServiceConfigured(
  services: OpenProjectLoginHandlerServices,
): boolean {
  try {
    return services.isLoginServiceConfigured();
  } catch {
    return false;
  }
}
