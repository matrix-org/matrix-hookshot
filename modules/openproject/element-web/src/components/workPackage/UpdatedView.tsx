import * as React from "react";
import { useViewModel } from "@element-hq/web-shared-components";
import type { UpdatedViewModel } from "../../viewmodels/workPackage/UpdatedMessageViewModel";
import { ChangedDetailsView } from "./ChangedDetailsView";
import { HeaderView } from "./HeaderView";
import { LayoutView } from "./LayoutView";
import { TitleView } from "./TitleView";
import { MessageCard } from "./styles";

export function UpdatedView({ vm }: { vm: UpdatedViewModel }) {
  const snapshot = useViewModel(vm);
  if (!snapshot) {
    return null;
  }

  const { details, header } = snapshot;

  return (
    <MessageCard>
      <HeaderView
        id={details.id}
        url={details.url}
        action={header.action}
        authorName={header.authorName}
      />
      <LayoutView borderColor={details.type.color}>
        <TitleView
          id={details.id}
          subject={details.subject}
          url={details.url}
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
