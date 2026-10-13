/** Serializes timeline transitions for each connection/work-package pair. */
export class TimelineManager {
  private readonly transitions = new Map<string, Promise<unknown>>();

  /** Run a transition after earlier transitions for the same anchor finish. */
  public runTransition<T>(
    connectionId: string,
    workPackageId: number,
    transition: () => Promise<T>,
  ): Promise<T> {
    const key = `${connectionId}:${workPackageId}`;
    const previous = this.transitions.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(transition);
    this.transitions.set(key, current);

    return current.finally(() => {
      if (this.transitions.get(key) === current) {
        this.transitions.delete(key);
      }
    });
  }
}
