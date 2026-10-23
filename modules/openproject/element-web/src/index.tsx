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
  isOpenProjectActivityContent,
  isOpenProjectAnchorContent,
  OpenProjectCapabilityClient,
  isOpenProjectContent,
} from "./OpenProjectCapabilityClient";
import { OpenProjectAnchorRenderer } from "./OpenProjectAnchorRenderer";
import { OpenProjectActivityRenderer } from "./OpenProjectActivityRenderer";

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

    function shouldRenderActivity(
      mxEvent: CustomMessageComponentProps["mxEvent"],
    ): boolean {
      if (mxEvent.type !== "m.room.message") {
        return false;
      }
      return isOpenProjectActivityContent(mxEvent.content);
    }

    const activityHints = {
      allowEditingEvent: false,
      renderAsInfoMessage: true,
      renderGroupSummary: {
        getKey: (mxEvent: CustomMessageComponentProps["mxEvent"]) => {
          const content = mxEvent.content;
          if (!isOpenProjectContent(content)) {
            return "OpenProjectActivityContent";
          }

          const workPackageId =
            content["org.matrix.matrix-hookshot.openproject.work_package"].id;
          const actorId =
            content["org.matrix.matrix-hookshot.openproject.actor"]?.id ?? "";
          return `OpenProjectActivityContent-${workPackageId}-${actorId}`;
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
      shouldRenderActivity,
      (props, originalComponentFn) => {
        const content = props.mxEvent.content;

        if (!isOpenProjectActivityContent(content)) {
          return originalComponentFn!();
        }

        return (
          <OpenProjectActivityRenderer
            data={content}
            roomId={props.mxEvent.roomId}
            onViewTimelineCard={(permalink) =>
              this.api.navigation.toMatrixToLink(permalink)
            }
          />
        );
      },
      activityHints,
    );
  }
}

export default HookshotOpenProjectModule satisfies ModuleFactory;
