import { isMatrixDeviceId, isMatrixUserId } from "../utils/identifiers";

export interface OpenProjectProfileValue {
  readonly userId?: string;
  readonly deviceId?: string;
}

export interface OpenProjectProfileWatchable {
  readonly value: OpenProjectProfileValue;
  watch(listener: (profile: OpenProjectProfileValue) => void): void;
  unwatch(listener: (profile: OpenProjectProfileValue) => void): void;
}

export interface ProfileIdentity {
  readonly userId: string;
  readonly deviceId: string;
}

interface ProfileChangeListener {
  readonly identity: ProfileIdentity;
  readonly onChange: () => void;
}

/** Captures and watches the account/device identity for active probes. */
export class OpenProjectProfileMonitor {
  private readonly listeners = new Set<ProfileChangeListener>();
  private watching = false;

  public constructor(private readonly profile: OpenProjectProfileWatchable) {}

  public capture(): ProfileIdentity | undefined {
    const { userId, deviceId } = this.profile.value;
    if (!isMatrixUserId(userId) || !isMatrixDeviceId(deviceId)) {
      return undefined;
    }
    return { userId, deviceId };
  }

  public isCurrent(identity: ProfileIdentity): boolean {
    const current = this.capture();
    if (!current) {
      return false;
    }
    return (
      current.userId === identity.userId &&
      current.deviceId === identity.deviceId
    );
  }

  public watchForChange(
    identity: ProfileIdentity,
    onChange: () => void,
  ): () => void {
    const listener: ProfileChangeListener = { identity, onChange };
    this.listeners.add(listener);
    if (!this.watching) {
      this.watching = true;
      try {
        this.profile.watch(this.onProfileChange);
      } catch (error) {
        this.watching = false;
        this.listeners.delete(listener);
        throw error;
      }
    }

    let subscribed = true;
    return (): void => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      this.listeners.delete(listener);
      if (this.watching && this.listeners.size === 0) {
        this.profile.unwatch(this.onProfileChange);
        this.watching = false;
      }
    };
  }

  private readonly onProfileChange = (
    profile: OpenProjectProfileValue,
  ): void => {
    for (const listener of Array.from(this.listeners)) {
      if (
        profile.userId !== listener.identity.userId ||
        profile.deviceId !== listener.identity.deviceId
      ) {
        listener.onChange();
      }
    }
  };
}
