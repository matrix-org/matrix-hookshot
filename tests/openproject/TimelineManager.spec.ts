import { describe, expect, it } from "vitest";

import { TimelineManager } from "../../src/openproject/TimelineManager";

describe("OpenProject timeline connection cleanup", () => {
  it("waits for pending anchors and blocks new transitions until cleanup ends", async () => {
    const manager = new TimelineManager();
    let finishAnchor!: () => void;
    let finishCleanup!: () => void;
    const anchorFinished = new Promise<void>((resolve) => {
      finishAnchor = resolve;
    });
    const cleanupFinished = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const calls: string[] = [];

    const pendingAnchor = manager.runTransition("connection", 1, async () => {
      calls.push("anchor-started");
      await anchorFinished;
      calls.push("anchor-finished");
    });
    const pendingCleanup = manager.runConnectionTransition(
      "connection",
      async () => {
        calls.push("cleanup-started");
        await cleanupFinished;
        calls.push("cleanup-finished");
      },
    );
    const pendingLaterAnchor = manager.runTransition(
      "connection",
      2,
      async () => {
        calls.push("later-anchor");
      },
    );

    await Promise.resolve();
    expect(calls).toEqual(["anchor-started"]);

    finishAnchor();
    await pendingAnchor;
    await Promise.resolve();
    expect(calls).toEqual([
      "anchor-started",
      "anchor-finished",
      "cleanup-started",
    ]);

    finishCleanup();
    await Promise.all([pendingCleanup, pendingLaterAnchor]);
    expect(calls).toEqual([
      "anchor-started",
      "anchor-finished",
      "cleanup-started",
      "cleanup-finished",
      "later-anchor",
    ]);
  });
});
