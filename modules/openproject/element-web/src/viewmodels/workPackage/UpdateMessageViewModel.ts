import {
  BaseViewModel,
  type ViewModel,
} from "@element-hq/web-shared-components";
import type {
  OpenProjectInactiveAnchorContent,
  OpenProjectUpdateContent,
} from "../../models/OpenProjectMatrixEventContent";

export type OpenProjectUpdateEventContent =
  | OpenProjectUpdateContent
  | OpenProjectInactiveAnchorContent;

export interface UpdateViewSnapshot {
  readonly kind: "update";
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

export type UpdateViewModel = ViewModel<UpdateViewSnapshot | null>;

function createUpdateViewSnapshot(
  data: OpenProjectUpdateEventContent,
): UpdateViewSnapshot | null {
  const workPackage =
    data["org.matrix.matrix-hookshot.openproject.work_package"];
  const changes =
    "org.matrix.matrix-hookshot.openproject.changes" in data
      ? data["org.matrix.matrix-hookshot.openproject.changes"]
      : ["removed the work package from the timeline"];
  if (!workPackage) {
    return null;
  }

  const firstChange = changes[0] ?? "updated the details";
  const remainingChanges = changes.length - 1;
  const remainingSummary =
    remainingChanges > 0
      ? ` and made ${remainingChanges} more ${remainingChanges === 1 ? "update" : "updates"}`
      : "";

  return {
    kind: "update",
    workPackage,
    changeSummary: `${firstChange}${remainingSummary}`,
    actor:
      "org.matrix.matrix-hookshot.openproject.actor" in data
        ? data["org.matrix.matrix-hookshot.openproject.actor"]
        : undefined,
  };
}

export class UpdateMessageViewModel
  extends BaseViewModel<
    UpdateViewSnapshot | null,
    OpenProjectUpdateEventContent
  >
  implements UpdateViewModel
{
  public constructor(data: OpenProjectUpdateEventContent) {
    super(data, createUpdateViewSnapshot(data));
  }
}
