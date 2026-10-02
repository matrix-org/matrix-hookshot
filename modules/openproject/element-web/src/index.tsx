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
} from "./OpenProjectCapabilityClient";
import type { OpenProjectContent } from "./models/OpenProjectMatrixEventContent";
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
    function shouldRender(
      mxEvent: CustomMessageComponentProps["mxEvent"],
    ): boolean {
      if (mxEvent.type !== "m.room.message") {
        return false;
      }
      return (
        isOpenProjectAnchorContent(mxEvent.content) ||
        isOpenProjectUpdateContent(mxEvent.content)
      );
    }

    this.api.customComponents.registerMessageRenderer(
      shouldRender,
      (props) => {
        const mxEvent = props.mxEvent;
        const content = mxEvent.content;

        if (isOpenProjectUpdateContent(content)) {
          return <OpenProjectUpdateRenderer data={content} />;
        }

        if (!isOpenProjectAnchorContent(content)) {
          return <></>;
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
            data={content as OpenProjectContent}
          />
        );
      },
      { allowEditingEvent: false },
    );
  }
}

export default HookshotOpenProjectModule satisfies ModuleFactory;
