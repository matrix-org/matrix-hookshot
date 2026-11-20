import * as React from "react";
import "./../css/index.css";
import type {
  Api,
  CustomMessageComponentProps,
  Module,
  ModuleFactory,
} from "@element-hq/element-web-module-api";
import {
  getOpenProjectCapabilityBot,
  isOpenProjectAnchorForBot,
  OpenProjectCapabilityClient,
} from "./capabilities/OpenProjectCapabilityClient";
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

function getWorkPackageId(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const id = (value as { id?: unknown }).id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0
    ? id
    : undefined;
}

class HookshotOpenProjectModule implements Module {
  public static readonly moduleApiVersion = "^2.6.0";

  private readonly capabilityBotUserId: string | undefined;
  private readonly capabilityClient: OpenProjectCapabilityClient | undefined;

  public constructor(private readonly api: Api) {
    this.capabilityBotUserId = getOpenProjectCapabilityBot(
      getElementConfig(api),
    );
    this.capabilityClient = this.capabilityBotUserId
      ? new OpenProjectCapabilityClient(api.client.toDevice, api.profile)
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
        const anchorContent = isOpenProjectAnchorForBot(
          content,
          mxEvent.sender,
          this.capabilityBotUserId,
        )
          ? content
          : undefined;
        const capabilityClient = this.capabilityClient;
        const workPackageId = getWorkPackageId(
          content["org.matrix.matrix-hookshot.openproject.work_package"],
        );

        if (
          capabilityClient !== undefined &&
          anchorContent !== undefined &&
          workPackageId !== undefined
        ) {
          return (
            <OpenProjectAnchorRenderer
              anchor={{
                eventId: mxEvent.eventId,
                roomId: mxEvent.roomId,
                workPackageId,
                recipientUserId: mxEvent.sender,
              }}
              capabilityClient={capabilityClient}
              data={anchorContent}
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
