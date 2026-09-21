import {
  BaseViewModel,
  type ViewModel,
} from "@element-hq/web-shared-components";
import type { OpenProjectContent } from "../../models/OpenProjectMatrixEventContent";
import { createChangeViewModel } from "./ChangeViewModel";
import {
  createDetailsViewModel,
  type DetailsViewModel,
} from "./DetailsViewModel";
import type { ChangeViewModel } from "./ChangeViewModel";

export interface UpdatedViewSnapshot {
  readonly kind: "updated";
  readonly workPackage: DetailsViewModel;
  readonly header: {
    readonly action: "updated";
    readonly authorName?: string;
  };
  readonly changedDetail?: ChangeViewModel;
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

  const workPackage = createDetailsViewModel(rawWorkPackage);
  return {
    kind: "updated",
    workPackage,
    header: { action: "updated" },
    changedDetail: createChangeViewModel(workPackage, changes),
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
