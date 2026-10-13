import * as React from "react";
import "./../css/index.css";
import type {
  Api,
  CustomMessageComponentProps,
  Module,
  ModuleFactory,
} from "@element-hq/element-web-module-api";
import { HookshotToDeviceClient } from "./HookshotToDeviceClient";
import {
  getOpenProjectCapabilityBot,
  isOpenProjectAnchorForBot,
  isOpenProjectUpdateContent,
  isOpenProjectAnchorContent,
  OpenProjectCapabilityClient,
  isOpenProjectContent,
} from "./OpenProjectCapabilityClient";
import { OpenProjectAnchorRenderer } from "./OpenProjectAnchorRenderer";
import { OpenProjectUpdateRenderer } from "./OpenProjectUpdateRenderer";

function getElementConfig(api: Api): unknown {
  try {
    return api.config.get();
  } catch {
    return undefined;
  }
}

class HookshotOpenProjectModule implements Module {
  public static readonly moduleApiVersion = "^2.0.0";

  private readonly capabilityBotUserId: string | undefined;
  private readonly capabilityClient: OpenProjectCapabilityClient | undefined;

  public constructor(private readonly api: Api) {
    this.capabilityBotUserId = getOpenProjectCapabilityBot(
      getElementConfig(api),
    );
    this.capabilityClient = this.capabilityBotUserId
      ? new OpenProjectCapabilityClient(new HookshotToDeviceClient())
      : undefined;
  }

  public async load(): Promise<void> {
    function shouldRenderAnchor(
      mxEvent: CustomMessageComponentProps["mxEvent"],
    ): boolean {
      if (mxEvent.type !== "m.room.message") {
        return false;
      }
      return isOpenProjectAnchorContent(mxEvent.content);
    }

    const anchorHints = {
      allowEditingEvent: false,
      renderSenderProfile: false,
    };

    this.api.customComponents.registerMessageRenderer(
      shouldRenderAnchor,
      (props, originalComponentFn) => {
        const mxEvent = props.mxEvent;
        const content = mxEvent.content;

        if (!isOpenProjectAnchorContent(content)) {
          return originalComponentFn!();
        }

        const isAnchorForBot = isOpenProjectAnchorForBot(
          content,
          mxEvent.sender,
          this.capabilityBotUserId,
        );
        const capabilityClient = isAnchorForBot
          ? this.capabilityClient
          : undefined;

        const workPackageId =
          content["org.matrix.matrix-hookshot.openproject.work_package"].id;

        return (
          <OpenProjectAnchorRenderer
            anchor={{
              eventId: mxEvent.eventId,
              roomId: mxEvent.roomId,
              workPackageId,
              recipientUserId: mxEvent.sender,
            }}
            capabilityClient={isAnchorForBot ? capabilityClient : undefined}
            data={content}
          />
        );
      },
      anchorHints,
    );

    function shouldRenderUpdate(
      mxEvent: CustomMessageComponentProps["mxEvent"],
    ): boolean {
      if (mxEvent.type !== "m.room.message") {
        return false;
      }
      // Use this renderer as fallback for all OpenProject content.
      return isOpenProjectContent(mxEvent.content) && !isOpenProjectAnchorContent(mxEvent.content);
    }

    const updateHints = {
      allowEditingEvent: false,
      renderAsInfoMessage: true,
      renderGroupSummary: {
        getKey: (mxEvent: CustomMessageComponentProps["mxEvent"]) => {
          const content = mxEvent.content;
          if (!isOpenProjectContent(content)) {
            return "OpenProjectUpdateContent";
          }

          const workPackageId =
            content["org.matrix.matrix-hookshot.openproject.work_package"].id;
          const actorId =
            content["org.matrix.matrix-hookshot.openproject.actor"]?.id ?? "";
          return `OpenProjectUpdateContent-${workPackageId}-${actorId}`;
        },
        getSummary: (
          events: readonly CustomMessageComponentProps["mxEvent"][],
        ) => {
          const content = events[0]?.content;
          if (!isOpenProjectContent(content)) {
            return `${events.length} OpenProject change${events.length !== 1 ? "s" : ""}`;
          }

          const workPackage =
            content["org.matrix.matrix-hookshot.openproject.work_package"];
          const actor = content["org.matrix.matrix-hookshot.openproject.actor"];
          const actorName =
            typeof actor?.name === "string" ? actor.name : "Someone";
          return `${actorName} made ${events.length} change${events.length !== 1 ? "s" : ""} to #${workPackage.id}`;
        },
      },
    };

    this.api.customComponents.registerMessageRenderer(
      shouldRenderUpdate,
      (props, originalComponentFn) => {
        const content = props.mxEvent.content;

        if (!isOpenProjectUpdateContent(content)) {
          return originalComponentFn!();
        }

        return <OpenProjectUpdateRenderer data={content} />;
      },
      updateHints,
    );
  }
}

export default HookshotOpenProjectModule satisfies ModuleFactory;
