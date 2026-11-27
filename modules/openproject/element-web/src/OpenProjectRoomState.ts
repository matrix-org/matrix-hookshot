import type { RoomStateEvent } from "@element-hq/element-web-module-api";

// Reject control characters in command prefixes, e.g. `!openproject\u0001admin`.
const CONTROL_CHARACTER_REGEX = /\p{Cc}/u;
// Split a command prefix at its first whitespace, e.g. `!openproject project-name`.
const WHITESPACE_REGEX = /\s+/u;

export const OPENPROJECT_CONNECTION_EVENT_TYPE =
  "org.matrix.matrix-hookshot.openproject.project";
export const DEFAULT_OPENPROJECT_COMMAND_PREFIX = "!openproject";

/**
 * Return command indicators from valid, enabled OpenProject room state.
 * The state content is supplied by other room members and must be validated.
 */
export function getOpenProjectCommandIndicators(
  stateEvents: readonly RoomStateEvent[],
): string[] {
  const indicators = new Set<string>();

  for (const stateEvent of stateEvents) {
    const content: unknown = stateEvent.content;
    if (
      !isRecord(content) ||
      Object.keys(content).length === 0 ||
      content.disabled === true ||
      !isHttpUrl(content.url)
    ) {
      continue;
    }

    let commandPrefix = DEFAULT_OPENPROJECT_COMMAND_PREFIX;
    if (Object.hasOwn(content, "commandPrefix")) {
      const configuredPrefix = content.commandPrefix;
      if (
        typeof configuredPrefix !== "string" ||
        configuredPrefix.length < 2 ||
        configuredPrefix.length > 48 ||
        CONTROL_CHARACTER_REGEX.test(configuredPrefix)
      ) {
        continue;
      }
      commandPrefix = configuredPrefix;
    }

    const leadingCommand = commandPrefix.trim().split(WHITESPACE_REGEX, 1)[0];
    if (leadingCommand) indicators.add(`${leadingCommand} `);
  }

  return [...indicators];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}
