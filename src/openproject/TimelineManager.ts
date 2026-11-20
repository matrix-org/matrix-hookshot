/** Serializes timeline transitions for each connection/work-package pair. */
export class TimelineManager {
  private readonly transitions = new Map<string, Promise<unknown>>();
  private readonly connectionTransitions = new Map<string, Promise<unknown>>();

  /** Run a transition after earlier transitions for the same anchor finish. */
  public runTransition<T>(
    connectionId: string,
    workPackageId: number,
    transition: () => Promise<T>,
  ): Promise<T> {
    const key = `${connectionId}:${workPackageId}`;
    const previous = this.transitions.get(key) ?? Promise.resolve();
    const connectionTransition =
      this.connectionTransitions.get(connectionId) ?? Promise.resolve();
    const current = Promise.all([
      previous.catch(() => undefined),
      connectionTransition.catch(() => undefined),
    ]).then(transition);
    this.transitions.set(key, current);

    return current.finally(() => {
      if (this.transitions.get(key) === current) {
        this.transitions.delete(key);
      }
    });
  }

  /**
   * Run connection-wide cleanup after its current transitions finish. Per-key
   * transitions queued while cleanup runs wait until it has completed.
   */
  public runConnectionTransition<T>(
    connectionId: string,
    transition: () => Promise<T>,
  ): Promise<T> {
    const prefix = `${connectionId}:`;
    const pendingTransitions = [...this.transitions.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, pending]) => pending.catch(() => undefined));
    const previousConnectionTransition =
      this.connectionTransitions.get(connectionId) ?? Promise.resolve();
    const current = previousConnectionTransition
      .catch(() => undefined)
      .then(() => Promise.all(pendingTransitions))
      .then(transition);
    this.connectionTransitions.set(connectionId, current);

    return current.finally(() => {
      if (this.connectionTransitions.get(connectionId) === current) {
        this.connectionTransitions.delete(connectionId);
      }
    });
  }
}
