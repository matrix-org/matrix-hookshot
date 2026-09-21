import * as React from "react";
import { useViewModel } from "@element-hq/web-shared-components";
import type { CreatedViewModel } from "../../viewmodels/workPackage/CreatedMessageViewModel";
import { ActionsView } from "./ActionsView";
import { DescriptionView } from "./DescriptionView";
import { HeaderView } from "./HeaderView";
import { LayoutView } from "./LayoutView";
import { MetadataView } from "./MetadataView";
import { TitleView } from "./TitleView";
import { MessageCard } from "./styles";

export function CreatedView({
  vm,
}: {
  vm: CreatedViewModel;
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
        <DescriptionView {...workPackage.description} />
        <MetadataView
          statusName={workPackage.status.name}
          statusColor={workPackage.status.color}
          typeName={workPackage.type.name}
          assigneeName={workPackage.assignee?.name}
          authorName={workPackage.author.name}
          authorUrl={workPackage.author.url}
        />
        <ActionsView url={workPackage.url} />
      </LayoutView>
    </MessageCard>
  );
}
