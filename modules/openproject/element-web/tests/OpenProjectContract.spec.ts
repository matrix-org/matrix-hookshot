import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  isOpenProjectAnchorContent,
  isOpenProjectActivityContent,
} from "../src/OpenProjectCapabilityClient";
import { OpenProjectAnchorRenderer } from "../src/OpenProjectAnchorRenderer";
import { OpenProjectActivityRenderer } from "../src/OpenProjectActivityRenderer";
import type { OpenProjectAnchorContent } from "../src/models/OpenProjectMatrixEventContent";
import {
  activeAnchorContent,
  activeReplacement,
  anchorEventId,
  compactActivityContent,
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

  it("renders Activity messages with a link to the original timeline card", () => {
    expect(isOpenProjectActivityContent(compactActivityContent)).toBe(true);

    const markup = renderToStaticMarkup(
      React.createElement(OpenProjectActivityRenderer, {
        data: compactActivityContent,
        roomId: anchor.roomId,
        onViewTimelineCard: () => {},
      }),
    );
    expect(markup).toContain("Webhook actor");
    expect(markup).toContain("updated the subject");
    expect(markup).toContain("Build the updated bridge");
    expect(markup).toContain("View timeline card");
    expect(markup).not.toContain("View package");
  });

  it("hides the timeline-card link when the event ID is malformed", () => {
    const malformed = {
      ...compactActivityContent,
      "org.matrix.matrix-hookshot.openproject.anchor_event_id":
        "https://attacker.example/",
    };
    const markup = renderToStaticMarkup(
      React.createElement(OpenProjectActivityRenderer, {
        data: malformed,
        roomId: anchor.roomId,
        onViewTimelineCard: () => {},
      }),
    );

    expect(markup).toContain("Build the updated bridge");
    expect(markup).not.toContain("View timeline card");
  });

  it("keeps Activity readable after removal and links to the new ID after re-add", () => {
    const {
      "org.matrix.matrix-hookshot.openproject.anchor_event_id": _removedId,
      ...removedContent
    } = compactActivityContent;
    expect(_removedId).toBe(anchorEventId);
    const removedMarkup = renderToStaticMarkup(
      React.createElement(OpenProjectActivityRenderer, {
        data: removedContent,
        roomId: anchor.roomId,
        onViewTimelineCard: () => {},
      }),
    );
    expect(removedMarkup).toContain("Build the updated bridge");
    expect(removedMarkup).not.toContain("View timeline card");

    const reAddedContent = {
      ...compactActivityContent,
      "org.matrix.matrix-hookshot.openproject.anchor_event_id":
        "$re-added-anchor:example.org",
    };
    const reAddedMarkup = renderToStaticMarkup(
      React.createElement(OpenProjectActivityRenderer, {
        data: reAddedContent,
        roomId: anchor.roomId,
        onViewTimelineCard: () => {},
      }),
    );
    expect(reAddedMarkup).toContain("View timeline card");
  });
});
