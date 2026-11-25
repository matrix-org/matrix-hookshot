import * as React from "react";
import "./../css/index.css";
import type {
  Api,
  CustomMessageComponentProps,
  CustomMessageRenderHints,
  Module,
  ModuleFactory,
  Room,
  RoomStateEvent,
  Watchable,
} from "@element-hq/element-web-module-api";
import {
  isOpenProjectAnchorForBot,
  isOpenProjectActivityContent,
  isOpenProjectContent,
  isOpenProjectAnchorContent,
  isOpenProjectCommandContent,
  OpenProjectCapabilityClient,
  isOpenProjectCommandRequest,
} from "./capabilities/OpenProjectCapabilityClient";
import { getOpenProjectCapabilityBot } from "./utils/config";
import { OpenProjectAnchorRenderer } from "./OpenProjectAnchorRenderer";
import { OpenProjectActivityRenderer } from "./OpenProjectActivityRenderer";
import {
  getOpenProjectCommandIndicators,
  OPENPROJECT_CONNECTION_EVENT_TYPE,
} from "./OpenProjectRoomState";

interface TrackedRoomState {
  watchable: Watchable<RoomStateEvent[]>;
  listener: (value: RoomStateEvent[]) => void;
}

function getElementConfig(api: Api): unknown {
  try {
    return api.config.get();
  } catch {
    return undefined;
  }
}

class HookshotOpenProjectModule implements Module {
  public static readonly moduleApiVersion = "^2.6.0";

  private readonly capabilityBotUserId: string | undefined;
  private readonly capabilityClient: OpenProjectCapabilityClient | undefined;
  private readonly roomStates = new Map<string, TrackedRoomState>();
  private currentRoomIds = new Set<string>();

  public constructor(private readonly api: Api) {
    this.capabilityBotUserId = getOpenProjectCapabilityBot(
      getElementConfig(api),
    );
    this.capabilityClient = this.capabilityBotUserId
      ? new OpenProjectCapabilityClient(api.client.toDevice, api.profile)
      : undefined;
  }

  public async load(): Promise<void> {
    void this.initializeRoomTracking().catch((error: unknown) => {
      console.error("Failed to initialize OpenProject room tracking", error);
    });

    const shouldRenderAnchor = (
      mxEvent: CustomMessageComponentProps["mxEvent"],
    ): boolean => {
      if (mxEvent.type !== "m.room.message") {
        return false;
      }
      const indicators = this.getCommandIndicators(mxEvent.roomId);
      return (
        indicators.length > 0 && isOpenProjectAnchorContent(mxEvent.content)
      );
    };

    const anchorHints: CustomMessageRenderHints = {
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
              snapshotId:
                content["org.matrix.matrix-hookshot.openproject.snapshot_id"],
              workPackageId,
              recipientUserId: mxEvent.sender,
            }}
            capabilityClient={isAnchorForBot ? capabilityClient : undefined}
            data={content}
            onActionCommand={(command) =>
              this.api.composer.insertPlaintextIntoComposer(command, {
                view: "room",
              })
            }
          />
        );
      },
      anchorHints,
    );

    const shouldRenderActivity = (
      mxEvent: CustomMessageComponentProps["mxEvent"],
    ): boolean => {
      if (mxEvent.type !== "m.room.message") {
        return false;
      }
      const indicators = this.getCommandIndicators(mxEvent.roomId);
      return (
        indicators.length > 0 && isOpenProjectActivityContent(mxEvent.content)
      );
    };

    const activityHints: CustomMessageRenderHints = {
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

    const shouldRenderOpenProjectCommand = (
      mxEvent: CustomMessageComponentProps["mxEvent"],
    ): boolean => {
      if (mxEvent.type !== "m.room.message") {
        return false;
      }
      const indicators = this.getCommandIndicators(mxEvent.roomId);
      return (
        indicators.length > 0 &&
        isOpenProjectCommandContent(mxEvent.content, indicators)
      );
    };

    this.api.customComponents.registerMessageRenderer(
      shouldRenderOpenProjectCommand,
      (_props, originalComponentFn) => originalComponentFn!(),
      {
        allowEditingEvent: false,
        renderAsInfoMessage: true,
        renderGroupSummary: {
          getKey: () => "OpenProjectCommand",
          getSummary: (events) => {
            const commandCount = events.filter((event) =>
              isOpenProjectCommandRequest(
                event.content,
                this.getCommandIndicators(event.roomId),
              ),
            ).length;
            return `${commandCount} OpenProject commands`;
          },
        },
      },
    );
  }

  private async initializeRoomTracking(): Promise<void> {
    const roomListStore = this.api.stores.roomListStore;
    await roomListStore.waitForReady();
    const rooms = roomListStore.getRooms();
    rooms.watch(this.onRoomsChanged);
    this.onRoomsChanged(rooms.value);
  }

  private getCommandIndicators(roomId: string): string[] {
    if (!this.currentRoomIds.has(roomId)) return [];

    let tracked = this.roomStates.get(roomId);
    if (!tracked) {
      const room = this.api.client.getRoom(roomId);
      if (!room) return [];

      const watchable = room.getStateEvents(OPENPROJECT_CONNECTION_EVENT_TYPE);
      const listener = (): void => {};
      tracked = { watchable, listener };
      this.roomStates.set(roomId, tracked);
      watchable.watch(listener);
    }

    return getOpenProjectCommandIndicators(tracked.watchable.value);
  }

  private onRoomsChanged = (rooms: Room[]): void => {
    const currentRoomIds = new Set(rooms.map((room) => room.id));
    this.currentRoomIds = currentRoomIds;
    for (const [roomId, tracked] of this.roomStates) {
      if (currentRoomIds.has(roomId)) continue;
      tracked.watchable.unwatch(tracked.listener);
      this.roomStates.delete(roomId);
    }
  };
}

export default HookshotOpenProjectModule satisfies ModuleFactory;
