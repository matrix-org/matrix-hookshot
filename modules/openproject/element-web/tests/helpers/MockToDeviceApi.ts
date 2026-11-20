import { vi } from "vitest";
import type {
  IncomingToDeviceMessage,
  OutgoingToDeviceMessage,
  ToDeviceApi,
} from "@element-hq/element-web-module-api";
import type {
  OpenProjectProfileValue,
  OpenProjectProfileWatchable,
} from "../../src/capabilities/OpenProjectProfile";

type ToDeviceListener = (message: IncomingToDeviceMessage) => void;

export class MockToDeviceApi implements ToDeviceApi {
  public readonly calls: string[] = [];
  public readonly sentMessages: OutgoingToDeviceMessage[] = [];
  private readonly subscriptions = new Map<string, Set<ToDeviceListener>>();
  private readonly sendFailures = new Map<number, Error>();

  public readonly sendMessage = vi.fn(
    async (message: OutgoingToDeviceMessage): Promise<void> => {
      this.calls.push("send");
      this.sentMessages.push(message);
      const failure = this.sendFailures.get(this.sentMessages.length);
      if (failure) {
        throw failure;
      }
    },
  );

  public failOnSendCall(callNumber: number, error: Error): void {
    this.sendFailures.set(callNumber, error);
  }

  public readonly onMessage = vi.fn(
    (type: string, listener: ToDeviceListener): (() => void) => {
      this.calls.push("subscribe");
      const listeners = this.subscriptions.get(type) ?? new Set();
      listeners.add(listener);
      this.subscriptions.set(type, listeners);
      let subscribed = true;
      return (): void => {
        if (!subscribed) {
          return;
        }
        subscribed = false;
        this.calls.push("unsubscribe");
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.subscriptions.delete(type);
        }
      };
    },
  );

  public deliver(
    subscriptionType: string,
    message: IncomingToDeviceMessage,
  ): void {
    for (const listener of Array.from(
      this.subscriptions.get(subscriptionType) ?? [],
    )) {
      listener(message);
    }
  }

  public get listenerCount(): number {
    let count = 0;
    for (const listeners of this.subscriptions.values()) {
      count += listeners.size;
    }
    return count;
  }
}

export class MockProfile implements OpenProjectProfileWatchable {
  private readonly listeners = new Set<
    (profile: OpenProjectProfileValue) => void
  >();

  public constructor(
    public value: OpenProjectProfileValue = {
      userId: "@alice:example.org",
      deviceId: "ALICE_DEVICE",
    },
  ) {}

  public watch(listener: (profile: OpenProjectProfileValue) => void): void {
    this.listeners.add(listener);
  }

  public unwatch(listener: (profile: OpenProjectProfileValue) => void): void {
    this.listeners.delete(listener);
  }

  public update(value: OpenProjectProfileValue): void {
    this.value = value;
    for (const listener of Array.from(this.listeners)) {
      listener(value);
    }
  }

  public get listenerCount(): number {
    return this.listeners.size;
  }
}
