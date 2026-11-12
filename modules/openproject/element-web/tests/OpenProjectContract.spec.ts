import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  isOpenProjectAnchorContent,
  isOpenProjectUpdateContent,
} from "../src/OpenProjectCapabilityClient";
import { OpenProjectAnchorRenderer } from "../src/OpenProjectAnchorRenderer";
import { OpenProjectUpdateRenderer } from "../src/OpenProjectUpdateRenderer";
import type { OpenProjectAnchorContent } from "../src/models/OpenProjectMatrixEventContent";
import {
  activeAnchorContent,
  activeReplacement,
  anchorEventId,
  compactUpdateContent,
  inactiveReplacement,
  noDeadlineAnchorContent,
  updatedAnchorContent,
} from "./fixtures/OpenProjectContractFixtures";

const anchor = {
  roomId: "!openproject:example.org",
  eventId: anchorEventId,
  workPackageId: 50,
  recipientUserId: "@hookshot_openproject:example.org",
};

function renderAnchor(data: OpenProjectAnchorContent) {
  return renderToStaticMarkup(
    React.createElement(OpenProjectAnchorRenderer, { anchor, data }),
  );
}

describe("Hookshot to Element work-package contract", () => {
  it("renders a complete active snapshot with assignee and ordinary due date", () => {
    expect(isOpenProjectAnchorContent(activeAnchorContent)).toBe(true);

    const markup = renderAnchor(activeAnchorContent);
    expect(markup).toContain("Build the bridge");
    expect(markup).toContain("Assigned to Alice");
    expect(markup).toContain("Due 30 Sept");
    expect(markup).toContain("New");
    expect(markup).toContain("View package");
  });

  it("renders the effective replacement with milestone date and closed status", () => {
    expect(activeReplacement["m.relates_to"].event_id).toBe(anchorEventId);
    expect(activeReplacement["m.new_content"]).toEqual(updatedAnchorContent);
    expect(isOpenProjectAnchorContent(activeReplacement["m.new_content"])).toBe(
      true,
    );

    const markup = renderAnchor(updatedAnchorContent);
    expect(markup).toContain("Build the updated bridge");
    expect(markup).toContain("Unassigned");
    expect(markup).toContain("Date 15 Oct");
    expect(markup).toContain("Closed");
  });

  it("shows an explicit no-deadline value", () => {
    expect(renderAnchor(noDeadlineAnchorContent)).toContain("No due date");
  });

  it("accepts the complete inactive replacement with the agreed compact presentation", () => {
    const inactiveContent = inactiveReplacement["m.new_content"];
    expect(inactiveReplacement["m.relates_to"].event_id).toBe(anchorEventId);
    expect(isOpenProjectAnchorContent(inactiveContent)).toBe(true);
    expect(
      inactiveContent["org.matrix.matrix-hookshot.openproject.snapshot_id"],
    ).not.toBe(
      updatedAnchorContent[
        "org.matrix.matrix-hookshot.openproject.snapshot_id"
      ],
    );

    const markup = renderAnchor(inactiveContent);
    expect(markup).toContain("removed from timeline");
    expect(markup).toContain("work_packages/50");
    expect(markup).not.toContain("View package");
  });

  it("renders Compact updates as display-only messages", () => {
    expect(isOpenProjectUpdateContent(compactUpdateContent)).toBe(true);

    const markup = renderToStaticMarkup(
      React.createElement(OpenProjectUpdateRenderer, {
        data: compactUpdateContent,
      }),
    );
    expect(markup).toContain("Webhook actor");
    expect(markup).toContain("updated the subject");
    expect(markup).toContain("Build the updated bridge");
    expect(markup).not.toContain("View package");
  });
});
