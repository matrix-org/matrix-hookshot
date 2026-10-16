import * as React from "react";
import { useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";
import { ActivityView } from "./components/workPackage/ActivityView";
import {
  ActivityMessageViewModel,
  type OpenProjectActivityEventContent,
} from "./viewmodels/workPackage/ActivityMessageViewModel";

export function OpenProjectActivityRenderer({
  data,
  roomId,
  onViewTimelineCard,
}: {
  data: OpenProjectActivityEventContent;
  roomId: string;
  onViewTimelineCard?: (permalink: string) => void;
}) {
  const vm = useCreateAutoDisposedViewModel(
    () => new ActivityMessageViewModel({ data, roomId, onViewTimelineCard }),
  );
  return <ActivityView vm={vm} />;
}
