import {
  BaseViewModel,
  type ViewModel,
} from "@element-hq/web-shared-components";
import type { OpenProjectContent } from "../../models/OpenProjectMatrixEventContent";
import { createChangeSnapshot, type ChangeSnapshot } from "./ChangeSnapshot";
import { createDetailsSnapshot, type DetailsSnapshot } from "./DetailsSnapshot";

export interface UpdatedViewSnapshot {
  readonly kind: "updated";
  readonly details: DetailsSnapshot;
  readonly header: {
    readonly action: "updated";
    readonly authorName?: string;
  };
  readonly changedDetail?: ChangeSnapshot;
}

export type UpdatedViewModel = ViewModel<UpdatedViewSnapshot | null>;

function createUpdatedViewSnapshot(
  data: OpenProjectContent,
): UpdatedViewSnapshot | null {
  const rawWorkPackage =
    data["org.matrix.matrix-hookshot.openproject.work_package"];
  const changes =
    data["org.matrix.matrix-hookshot.openproject.work_package.changed"];
  if (!rawWorkPackage || !changes) {
    return null;
  }

  const details = createDetailsSnapshot(rawWorkPackage);
  return {
    kind: "updated",
    details,
    header: { action: "updated" },
    changedDetail: createChangeSnapshot(details, changes),
  };
}

export class UpdatedMessageViewModel
  extends BaseViewModel<UpdatedViewSnapshot | null, OpenProjectContent>
  implements UpdatedViewModel
{
  public constructor(data: OpenProjectContent) {
    super(data, createUpdatedViewSnapshot(data));
  }
}
