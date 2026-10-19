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
  readonly changeSummary: string;
}

export interface ActivityViewActions {
  readonly onViewTimelineCard?: () => void;
}

export type ActivityViewModel = ViewModel<
  ActivityViewSnapshot,
  ActivityViewActions
>;

export interface ActivityMessageViewModelProps {
  readonly data: OpenProjectActivityEventContent;
  readonly roomId: string;
  readonly onViewTimelineCard?: (permalink: string) => void;
}

function createActivityViewSnapshot(
  data: OpenProjectActivityEventContent,
): ActivityViewSnapshot {
  const changeSummary = data["formatted_body"] ?? data["body"];

  return {
    kind: "activity",
    changeSummary,
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
  extends BaseViewModel<ActivityViewSnapshot, ActivityMessageViewModelProps>
  implements ActivityViewModel
{
  public readonly onViewTimelineCard?: () => void;

  public constructor(props: ActivityMessageViewModelProps) {
    super(props, createActivityViewSnapshot(props.data));
    this.onViewTimelineCard = createViewTimelineCardAction(props);
  }
}
