import { isMatrixUserId } from "./identifiers";

/** Integration ID used to find the OpenProject bot in Hookshot configuration. */
export const OPENPROJECT_INTEGRATION_ID = "openproject";
/** Maximum accepted length for an authorization URL received over to-device. */
export const HOOKSHOT_LOGIN_URL_MAX_LENGTH = 4096;

interface JsonRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads and validates the OpenProject bot ID from Element's Hookshot config. */
export function getOpenProjectCapabilityBot(
  config: unknown,
): string | undefined {
  if (!isRecord(config)) {
    return undefined;
  }

  const hookshotConfig = config["org.matrix.matrix-hookshot"];
  if (!isRecord(hookshotConfig)) {
    return undefined;
  }

  const integrationBots = hookshotConfig.integrationBots;
  if (!isRecord(integrationBots)) {
    return undefined;
  }

  const botUserId = integrationBots[OPENPROJECT_INTEGRATION_ID];
  return isMatrixUserId(botUserId) ? botUserId : undefined;
}

/** Reads and validates the Hookshot OpenProject base URL from Element config. */
export function getOpenProjectBaseUrl(config: unknown): URL | undefined {
  if (!isRecord(config)) {
    return undefined;
  }
  const hookshotConfig = config["org.matrix.matrix-hookshot"];
  if (
    !isRecord(hookshotConfig) ||
    typeof hookshotConfig.openProjectBaseUrl !== "string"
  ) {
    return undefined;
  }

  try {
    const rawBaseUrl = hookshotConfig.openProjectBaseUrl;
    const baseUrl = new URL(rawBaseUrl);
    if (
      baseUrl.username !== "" ||
      baseUrl.password !== "" ||
      hasUrlCredentials(rawBaseUrl) ||
      /[?#]/u.test(rawBaseUrl) ||
      baseUrl.search !== "" ||
      baseUrl.hash !== "" ||
      (baseUrl.protocol !== "https:" &&
        !(
          baseUrl.protocol === "http:" &&
          isLocalDevelopmentHost(baseUrl.hostname)
        ))
    ) {
      return undefined;
    }
    return baseUrl;
  } catch {
    return undefined;
  }
}

/** Validates a Hookshot authorization URL against the configured trusted base. */
export function isTrustedOpenProjectAuthorizationUrl(
  value: unknown,
  baseUrl: URL | undefined,
): value is string {
  if (
    !baseUrl ||
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > HOOKSHOT_LOGIN_URL_MAX_LENGTH ||
    value.includes("#")
  ) {
    return false;
  }
  try {
    const authorizationUrl = new URL(value);
    const expectedUrl = new URL("/oauth/authorize", baseUrl);
    return (
      authorizationUrl.username === "" &&
      authorizationUrl.password === "" &&
      !hasUrlCredentials(value) &&
      authorizationUrl.hash === "" &&
      authorizationUrl.origin === expectedUrl.origin &&
      authorizationUrl.pathname === expectedUrl.pathname
    );
  } catch {
    return false;
  }
}

function isLocalDevelopmentHost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

function hasUrlCredentials(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:\/\/[^/?#]*@/iu.test(value);
}
