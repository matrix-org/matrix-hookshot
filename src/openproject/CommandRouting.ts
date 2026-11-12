import type { ResolvedCommand } from "../BotCommands";

// Example: "!op close" has a matching space after the "!op" prefix.
const PREFIX_BOUNDARY_REGEX = /\s/;
// Example: "!op close 42" matches "!op".
const FIRST_COMMAND_TOKEN_REGEX = /^\S+/;
// Example: "!op   project" matches the three spaces between the words.
const COMMAND_WORD_SEPARATOR_REGEX = /\s+/;

/** The project information needed to route a command within one room. */
export interface OpenProjectCommandTarget {
  projectId: number;
  routingPrefix: string;
}

/** A command and the project connection selected for it. */
export interface OpenProjectCommandRoute<T> extends ResolvedCommand {
  connection: T;
}

function matchesPrefix(body: string, prefix: string): boolean {
  return (
    body.startsWith(prefix) &&
    (body.length === prefix.length ||
      PREFIX_BOUNDARY_REGEX.test(body.charAt(prefix.length)))
  );
}

function routeFor<T extends OpenProjectCommandTarget>(
  connection: T,
  body: string,
  prefix: string,
  isShorthand: boolean,
): OpenProjectCommandRoute<T> {
  return {
    connection,
    commandText: body.slice(prefix.length).trimStart(),
    prefix,
    isShorthand,
  };
}

/** Select an OpenProject command using every project connection in the room. */
export function resolveOpenProjectCommand<T extends OpenProjectCommandTarget>(
  connections: readonly T[],
  body: string,
  replyProjectId?: number,
): OpenProjectCommandRoute<T> | undefined {
  const explicit = connections
    .filter(
      (connection) =>
        connection.routingPrefix.includes(" ") &&
        matchesPrefix(body, connection.routingPrefix),
    )
    .sort((a, b) => b.routingPrefix.length - a.routingPrefix.length);
  if (explicit.length > 0) {
    // Duplicate project prefixes cannot identify a unique connection.
    if (explicit[0].routingPrefix === explicit[1]?.routingPrefix) {
      return undefined;
    }
    return routeFor(explicit[0], body, explicit[0].routingPrefix, false);
  }

  const shorthand = FIRST_COMMAND_TOKEN_REGEX.exec(body)?.[0];
  if (!shorthand) {
    return undefined;
  }
  const aliasMatches = connections.filter(
    (connection) =>
      shorthand === "!openproject" ||
      shorthand ===
        connection.routingPrefix.split(COMMAND_WORD_SEPARATOR_REGEX, 1)[0],
  );
  if (replyProjectId !== undefined) {
    const project = aliasMatches.find(
      (connection) => connection.projectId === replyProjectId,
    );
    return project ? routeFor(project, body, shorthand, true) : undefined;
  }

  const bare = aliasMatches.filter(
    (connection) => connection.routingPrefix === shorthand,
  );
  if (bare.length === 1) {
    return routeFor(bare[0], body, shorthand, false);
  }
  // Help is safe without a project, even when several connections share an alias.
  if (body.slice(shorthand.length).trim() === "help" && aliasMatches.length) {
    return routeFor(aliasMatches[0], body, shorthand, true);
  }
  return undefined;
}
