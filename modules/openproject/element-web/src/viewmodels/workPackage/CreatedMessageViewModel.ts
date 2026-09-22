import {
  BaseViewModel,
  type ViewModel,
} from "@element-hq/web-shared-components";
import type { OpenProjectContent } from "../../models/OpenProjectMatrixEventContent";
import { createDetailsSnapshot, type DetailsSnapshot } from "./DetailsSnapshot";

export interface CreatedViewSnapshot {
  readonly kind: "created";
  readonly details: DetailsSnapshot;
  readonly header: {
    readonly action: "created";
    readonly authorName?: string;
  };
}

export type CreatedViewModel = ViewModel<CreatedViewSnapshot | null>;

function createCreatedViewSnapshot(
  data: OpenProjectContent,
): CreatedViewSnapshot | null {
  const rawWorkPackage =
    data["org.matrix.matrix-hookshot.openproject.work_package"];
  if (!rawWorkPackage) {
    return null;
  }

  const details = createDetailsSnapshot(rawWorkPackage);
  return {
    kind: "created",
    details,
    header: { action: "created", authorName: details.author.name },
  };
}

export class CreatedMessageViewModel
  extends BaseViewModel<CreatedViewSnapshot | null, OpenProjectContent>
  implements CreatedViewModel
{
  public constructor(data: OpenProjectContent) {
    super(data, createCreatedViewSnapshot(data));
  }
}
