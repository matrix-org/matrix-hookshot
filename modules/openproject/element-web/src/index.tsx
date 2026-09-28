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
  OpenProjectCapabilityClient,
} from "./OpenProjectCapabilityClient";
import { OpenProjectMessageRenderer } from "./OpenProjectMessageRenderer";
import type { OpenProjectContent } from "./models/OpenProjectMatrixEventContent";
import { OpenProjectAnchorRenderer } from "./OpenProjectAnchorRenderer";

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
      ? new OpenProjectCapabilityClient(
          new HookshotToDeviceClient(),
          this.capabilityBotUserId,
        )
      : undefined;
  }

  public async load(): Promise<void> {
    function shouldRender(
      mxEvent: CustomMessageComponentProps["mxEvent"],
    ): boolean {
      if (mxEvent.type !== "m.room.message") {
        return false;
      }
      const content = mxEvent.content;
      return !!content["org.matrix.matrix-hookshot.openproject.work_package"];
    }

    this.api.customComponents.registerMessageRenderer(
      shouldRender,
      (props) => {
        const mxEvent = props.mxEvent;
        const content = mxEvent.content;
        const isAnchor = isOpenProjectAnchorForBot(
          content,
          mxEvent.sender,
          this.capabilityBotUserId,
        );
        const capabilityClient = this.capabilityClient;
        const renderAnchor = capabilityClient !== undefined && isAnchor;

        if (renderAnchor) {
          return (
            <OpenProjectAnchorRenderer
              anchor={{ eventId: mxEvent.eventId, roomId: mxEvent.roomId }}
              capabilityClient={capabilityClient}
              data={content as OpenProjectContent}
            />
          );
        }
        return (
          <OpenProjectMessageRenderer data={content as OpenProjectContent} />
        );
      },
      { allowEditingEvent: false },
    );
  }
}

export default HookshotOpenProjectModule satisfies ModuleFactory;
