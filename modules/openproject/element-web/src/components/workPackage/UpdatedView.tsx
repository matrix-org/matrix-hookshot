import * as React from "react";
import { useViewModel } from "@element-hq/web-shared-components";
import type { UpdatedViewModel } from "../../viewmodels/workPackage/UpdatedMessageViewModel";
import { ChangedDetailsView } from "./ChangedDetailsView";
import { HeaderView } from "./HeaderView";
import { LayoutView } from "./LayoutView";
import { TitleView } from "./TitleView";
import { MessageCard } from "./styles";

export function UpdatedView({
  vm,
}: {
  vm: UpdatedViewModel;
}) {
  const snapshot = useViewModel(vm);
  if (!snapshot) {
    return null;
  }

  const { workPackage, header } = snapshot;

  return (
    <MessageCard>
      <HeaderView
        id={workPackage.id}
        url={workPackage.url}
        action={header.action}
        authorName={header.authorName}
      />
      <LayoutView borderColor={workPackage.type.color}>
        <TitleView
          id={workPackage.id}
          subject={workPackage.subject}
          url={workPackage.url}
        />
        {snapshot.changedDetail ? (
          <ChangedDetailsView
            change={snapshot.changedDetail}
            descriptionAsDetails
          />
        ) : null}
      </LayoutView>
    </MessageCard>
  );
}
