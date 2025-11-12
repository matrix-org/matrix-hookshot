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
    cause?: Error,
  ) {
    super(`There was an error in the config (${configPath}): ${msg}`, {
      cause,
    });
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
