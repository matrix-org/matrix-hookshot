import { describe, expect, it } from "vitest";
import { workPackageToCacheState } from "../../src/openproject/State";
import type { OpenProjectWebhookPayloadWorkPackage } from "../../src/openproject/Types";
import { WORK_PACKAGE } from "./WorkPackageFixtures";

describe("OpenProject work-package cache state", () => {
  it("keeps the revision and normalized milestone date", () => {
    const workPackage = {
      ...WORK_PACKAGE,
      date: "2026-09-30",
    };

    expect(workPackageToCacheState(workPackage)).toMatchObject({
      lockVersion: workPackage.lockVersion,
      date: workPackage.date,
    });
  });

  it("keeps a webhook actor separate from the work-package snapshot", () => {
    const payload: OpenProjectWebhookPayloadWorkPackage = {
      action: "work_package:updated",
      actor: {
        id: 12,
        name: "Webhook User",
      },
      work_package: WORK_PACKAGE,
    };

    expect(payload.actor).toEqual({ id: 12, name: "Webhook User" });
    expect(workPackageToCacheState(payload.work_package)).not.toHaveProperty(
      "actor",
    );
  });
});
