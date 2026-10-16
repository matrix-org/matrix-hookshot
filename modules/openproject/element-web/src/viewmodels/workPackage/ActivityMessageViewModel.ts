import {
  BaseViewModel,
  type ViewModel,
} from "@element-hq/web-shared-components";
import type { OpenProjectActivityContent } from "../../models/OpenProjectMatrixEventContent";
import {
  isMatrixEventId,
  isMatrixRoomId,
} from "../../OpenProjectCapabilityClient";

export type OpenProjectActivityEventContent = OpenProjectActivityContent;

export interface ActivityViewSnapshot {
  readonly kind: "activity";
  readonly workPackage: {
    readonly id: number;
    readonly subject: string;
    readonly url: string;
  };
  readonly changeSummary: string;
  readonly actor?: {
    readonly name: string;
    readonly url: string;
  };
}

export interface ActivityViewActions {
  readonly onViewTimelineCard?: () => void;
}

export type ActivityViewModel = ViewModel<
  ActivityViewSnapshot | null,
  ActivityViewActions
>;

export interface ActivityMessageViewModelProps {
  readonly data: OpenProjectActivityEventContent;
  readonly roomId: string;
  readonly onViewTimelineCard?: (permalink: string) => void;
}

function createActivityViewSnapshot(
  data: OpenProjectActivityEventContent,
): ActivityViewSnapshot | null {
  const workPackage =
    data["org.matrix.matrix-hookshot.openproject.work_package"];
  const changes = data["org.matrix.matrix-hookshot.openproject.changes"] || [];
  if (!workPackage) {
    return null;
  }

  const firstChange = changes[0] ?? "updated the details";
  const remainingChanges = changes.length - 1;
  const remainingSummary =
    remainingChanges > 0
      ? ` and made ${remainingChanges} more ${remainingChanges === 1 ? "update" : "updates"}`
      : "";
  const changeSummary = `${firstChange}${remainingSummary}.`;

  return {
    kind: "activity",
    workPackage,
    changeSummary,
    actor:
      "org.matrix.matrix-hookshot.openproject.actor" in data
        ? data["org.matrix.matrix-hookshot.openproject.actor"]
        : undefined,
  };
}

function createViewTimelineCardAction(
  props: ActivityMessageViewModelProps,
): (() => void) | undefined {
  const anchorEventId =
    props.data["org.matrix.matrix-hookshot.openproject.anchor_event_id"];
  if (
    !props.onViewTimelineCard ||
    !isMatrixEventId(anchorEventId) ||
    !isMatrixRoomId(props.roomId)
  ) {
    return undefined;
  }

  const permalink = `https://matrix.to/#/${encodeURIComponent(props.roomId)}/${encodeURIComponent(anchorEventId)}`;
  return () => props.onViewTimelineCard?.(permalink);
}

export class ActivityMessageViewModel
  extends BaseViewModel<
    ActivityViewSnapshot | null,
    ActivityMessageViewModelProps
  >
  implements ActivityViewModel
{
  public readonly onViewTimelineCard?: () => void;

  public constructor(props: ActivityMessageViewModelProps) {
    super(props, createActivityViewSnapshot(props.data));
    this.onViewTimelineCard = createViewTimelineCardAction(props);
  }
}
