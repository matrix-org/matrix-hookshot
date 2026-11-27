import type {
  OpenProjectAnchor,
  OpenProjectCapabilityClient,
} from "../../capabilities/OpenProjectCapabilityClient";
import {
  isOpenProjectLoginStartResponse,
  isOpenProjectLoginStatusResponse,
} from "../../capabilities/OpenProjectCapabilityClient";
import type { ProfileIdentity } from "../../capabilities/OpenProjectProfile";
import { isTrustedOpenProjectAuthorizationUrl } from "../../utils/config";

/** Delay between settled, still-disconnected login-status checks. */
export const OPENPROJECT_LOGIN_POLL_INTERVAL_MS = 2_000;
/** Maximum time spent checking for a newly stored OpenProject token. */
export const OPENPROJECT_LOGIN_POLL_DURATION_MS = 120_000;

export type OpenProjectAccountConnectionState =
  | { readonly kind: "starting" }
  | { readonly kind: "ready"; readonly authorizationUrl: string }
  | { readonly kind: "polling"; readonly authorizationUrl: string }
  | { readonly kind: "connected" }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "configuration_error" }
  | { readonly kind: "expired" }
  | { readonly kind: "session_changed" }
  | { readonly kind: "cancelled" };

export type OpenProjectLoginClient = Pick<
  OpenProjectCapabilityClient,
  | "loginStart"
  | "loginStatus"
  | "getSessionIdentity"
  | "isSessionIdentityCurrent"
  | "watchSessionIdentity"
>;

/** Owns one login attempt, its trusted URL, session watch, and polling timers. */
export class OpenProjectAccountConnectionViewModel {
  private state: OpenProjectAccountConnectionState = { kind: "starting" };
  private readonly listeners = new Set<
    (state: OpenProjectAccountConnectionState) => void
  >();
  private sessionIdentity: ProfileIdentity | undefined;
  private unsubscribeSession: (() => void) | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private pollDeadline = 0;
  private attempt = 0;
  private pollGeneration = 0;
  private started = false;
  private completed = false;
  private disposed = false;
  private pollInFlightGeneration: number | undefined;

  public constructor(
    private readonly client: OpenProjectLoginClient,
    private readonly anchor: OpenProjectAnchor,
    private readonly baseUrl: URL | undefined,
    private readonly onComplete: (identity: ProfileIdentity) => void,
  ) {}

  public getSnapshot(): OpenProjectAccountConnectionState {
    return this.state;
  }

  public subscribe(
    listener: (state: OpenProjectAccountConnectionState) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Starts one login-start request. Repeated calls while it is pending coalesce. */
  public start = (): void => {
    if (this.disposed || this.started) {
      return;
    }
    this.started = true;
    try {
      this.sessionIdentity = this.client.getSessionIdentity();
      this.unsubscribeSession = this.client.watchSessionIdentity(
        this.sessionIdentity,
        this.handleSessionChange,
      );
    } catch {
      this.setState({ kind: "unavailable" });
      return;
    }
    void this.startAttempt();
  };

  /** Opens the already-rendered authorization link and starts status polling. */
  public beginAuthorizationCheck = (): void => {
    if (this.disposed || this.state.kind !== "ready" || this.completed) {
      return;
    }
    const authorizationUrl = this.state.authorizationUrl;
    this.pollDeadline = Date.now() + OPENPROJECT_LOGIN_POLL_DURATION_MS;
    const generation = ++this.pollGeneration;
    this.setState({ kind: "polling", authorizationUrl });
    this.expiryTimer = setTimeout(
      () => this.expire(generation),
      OPENPROJECT_LOGIN_POLL_DURATION_MS,
    );
    void this.poll(generation);
  };

  /** Explicitly retries login-start with a new request ID and fresh OAuth state. */
  public retry = (): void => {
    if (
      this.disposed ||
      this.completed ||
      !["denied", "unavailable", "expired"].includes(this.state.kind)
    ) {
      return;
    }
    void this.startAttempt();
  };

  /** Cancels pending work and clears the authorization URL and timers. */
  public cancel = (): void => {
    if (this.disposed || this.completed) {
      return;
    }
    this.invalidateWork();
    this.setState({ kind: "cancelled" });
  };

  /** Releases timers and subscriptions when the dialog is closed or unmounted. */
  public dispose = (): void => {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.invalidateWork();
    this.state = { kind: "cancelled" };
    this.listeners.clear();
  };

  private async startAttempt(): Promise<void> {
    this.clearPollingTimers();
    const attempt = ++this.attempt;
    if (!this.isSessionCurrent()) {
      return;
    }
    if (!this.baseUrl) {
      this.setState({ kind: "configuration_error" });
      return;
    }

    this.setState({ kind: "starting" });
    try {
      const response = await this.client.loginStart(this.anchor);
      if (!this.isCurrentAttempt(attempt)) {
        return;
      }
      if (!isOpenProjectLoginStartResponse(response)) {
        this.setState({ kind: "unavailable" });
        return;
      }
      switch (response.result) {
        case "ready":
          if (
            !isTrustedOpenProjectAuthorizationUrl(
              response.auth_url,
              this.baseUrl,
            )
          ) {
            this.setState({ kind: "configuration_error" });
            return;
          }
          this.setState({
            kind: "ready",
            authorizationUrl: new URL(response.auth_url).href,
          });
          break;
        case "already_connected":
          this.complete();
          break;
        case "not_authorized":
          this.setState({ kind: "denied" });
          break;
        case "unavailable":
          this.setState({ kind: "unavailable" });
          break;
      }
    } catch {
      if (this.isCurrentAttempt(attempt)) {
        this.setState({ kind: "unavailable" });
      }
    }
  }

  private async poll(generation: number): Promise<void> {
    if (
      !this.isCurrentPoll(generation) ||
      this.pollInFlightGeneration === generation
    ) {
      return;
    }
    this.pollInFlightGeneration = generation;
    try {
      const response = await this.client.loginStatus(this.anchor);
      if (!this.isCurrentPoll(generation)) {
        return;
      }
      if (!isOpenProjectLoginStatusResponse(response)) {
        this.failPolling();
        return;
      }
      switch (response.result) {
        case "connected":
          this.complete();
          return;
        case "unavailable":
          this.failPolling();
          return;
        case "not_connected": {
          const delay = Math.min(
            OPENPROJECT_LOGIN_POLL_INTERVAL_MS,
            this.pollDeadline - Date.now(),
          );
          if (delay <= 0) {
            this.expire(generation);
            return;
          }
          this.pollTimer = setTimeout(() => {
            this.pollTimer = undefined;
            void this.poll(generation);
          }, delay);
          return;
        }
      }
    } catch {
      if (this.isCurrentPoll(generation)) {
        this.failPolling();
      }
    } finally {
      if (this.pollInFlightGeneration === generation) {
        this.pollInFlightGeneration = undefined;
      }
    }
  }

  private complete(): void {
    if (this.completed || !this.isSessionCurrent()) {
      return;
    }
    this.completed = true;
    this.invalidateWork();
    this.setState({ kind: "connected" });
    if (this.sessionIdentity) {
      this.onComplete(this.sessionIdentity);
    }
  }

  private failPolling(): void {
    this.clearPollingTimers();
    this.attempt++;
    this.setState({ kind: "unavailable" });
  }

  private expire(generation: number): void {
    if (!this.isCurrentPoll(generation)) {
      return;
    }
    this.clearPollingTimers();
    this.attempt++;
    this.setState({ kind: "expired" });
  }

  private isCurrentAttempt(attempt: number): boolean {
    return (
      !this.disposed && attempt === this.attempt && this.isSessionCurrent()
    );
  }

  private isCurrentPoll(generation: number): boolean {
    return (
      !this.disposed &&
      this.state.kind === "polling" &&
      generation === this.pollGeneration &&
      this.isSessionCurrent()
    );
  }

  private isSessionCurrent(): boolean {
    if (
      !this.sessionIdentity ||
      !this.client.isSessionIdentityCurrent(this.sessionIdentity)
    ) {
      this.handleSessionChange();
      return false;
    }
    return true;
  }

  private readonly handleSessionChange = (): void => {
    if (this.disposed || this.completed) {
      return;
    }
    this.invalidateWork();
    this.setState({ kind: "session_changed" });
  };

  private invalidateWork(): void {
    this.attempt++;
    this.clearPollingTimers();
    this.unsubscribeSession?.();
    this.unsubscribeSession = undefined;
  }

  private clearPollingTimers(): void {
    this.pollGeneration++;
    if (this.expiryTimer !== undefined) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = undefined;
    }
    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private setState(state: OpenProjectAccountConnectionState): void {
    if (this.disposed && state.kind !== "cancelled") {
      return;
    }
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
