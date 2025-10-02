export class CommandError extends Error {
  constructor(
    public readonly message: string,
    public readonly humanError?: string,
  ) {
    super(message);
  }
}

export class NotLoggedInError extends CommandError {
  constructor() {
    super("User is not logged in", "You are not logged in");
  }
}

export class ConfigError extends Error {
  constructor(
    public readonly configPath: string,
    public readonly msg?: string,
  ) {
    super(`There was an error in the config (${configPath}): ${msg}`);
  }
}

export enum TokenErrorCode {
  EXPIRED = "The token has expired.",
}
export class TokenError extends Error {
  constructor(
    public readonly code: TokenErrorCode,
    public readonly innerError: string,
  ) {
    super(code);
  }
}

export class ConnectionConfigurationError extends Error {
  constructor(connectionId: string, fieldName: string, message: string) {
    super(
      `Unable to create connection ${connectionId} due to invalid field ${fieldName}: ${message}`,
    );
  }
}
