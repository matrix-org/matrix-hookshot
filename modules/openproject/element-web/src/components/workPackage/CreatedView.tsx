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

export function CreatedView({ vm }: { vm: CreatedViewModel }) {
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
        <DescriptionView {...details.description} />
        <MetadataView
          statusName={details.status.name}
          statusColor={details.status.color}
          typeName={details.type.name}
          assigneeName={details.assignee?.name}
          authorName={details.author.name}
          authorUrl={details.author.url}
        />
        <ActionsView url={details.url} />
      </LayoutView>
    </MessageCard>
  );
}
