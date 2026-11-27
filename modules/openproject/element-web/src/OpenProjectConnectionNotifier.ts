import type { ProfileIdentity } from "./capabilities/OpenProjectProfile";

type Listener = (identity: ProfileIdentity) => void;

/** A module-local, disposable signal for successful OpenProject connections. */
export class OpenProjectConnectionNotifier {
  private readonly listeners = new Set<Listener>();
  private readonly pending = new Map<string, ProfileIdentity>();
  private flushQueued = false;
  private disposed = false;

  /** Subscribes to matching successful connection completions. */
  public subscribe(listener: Listener): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Coalesces duplicate completions delivered during the same microtask. */
  public notify(identity: ProfileIdentity): void {
    if (this.disposed) return;
    this.pending.set(`${identity.userId}\u0000${identity.deviceId}`, identity);
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      if (this.disposed) return;
      const identities = [...this.pending.values()];
      this.pending.clear();
      for (const item of identities) {
        for (const listener of this.listeners) listener(item);
      }
    });
  }

  /** Removes all listeners and drops any queued notifications. */
  public dispose(): void {
    this.disposed = true;
    this.pending.clear();
    this.listeners.clear();
  }
}
