import { randomUUID } from "node:crypto";
import type { IBridgeStorageProvider } from "../stores/StorageProvider";
import { CommandError, NotLoggedInError } from "../Errors";
import type { UserTokenStore } from "../tokens/UserTokenStore";
import {
  formatInactiveWorkPackageAnchorReplacement,
  formatWorkPackageAnchorContent,
} from "./Format";
import { parseWorkPackageId } from "./CommandParser";
import type { OpenProjectAnchorState } from "./State";
import {
  OPENPROJECT_ANCHOR_EVENT_KIND,
  OPENPROJECT_ANCHOR_STATE_ACTIVE,
  OPENPROJECT_EVENT_SCHEMA_VERSION,
} from "./Schema";

/** Services used to add and remove OpenProject timeline anchors. */
export interface OpenProjectTimelineCommandContext {
  readonly connectionId: string;
  readonly projectId: number;
  readonly baseURL: URL;
  readonly storage: IBridgeStorageProvider;
  readonly tokenStore: UserTokenStore;
  runTimelineTransition<T>(
    workPackageId: number,
    transition: () => Promise<T>,
  ): Promise<T | undefined>;
  sendEvent(
    body: string,
    extraContent?: object,
    opts?: { inline: boolean },
  ): Promise<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidAnchorStateForRemoval(
  value: unknown,
  workPackageId: number,
): value is OpenProjectAnchorState {
  if (!isRecord(value) || !isRecord(value.lastContent)) {
    return false;
  }

  const content = value.lastContent;
  const workPackage =
    content["org.matrix.matrix-hookshot.openproject.work_package"];
  // Check only the fields needed for a safe removal so absent display data
  // does not prevent cleanup of a valid anchor.
  return (
    typeof value.anchorEventId === "string" &&
    value.anchorEventId.length > 0 &&
    typeof value.lockVersion === "number" &&
    Number.isSafeInteger(value.lockVersion) &&
    value.lockVersion >= 0 &&
    content.msgtype === "m.notice" &&
    typeof content.body === "string" &&
    content["org.matrix.matrix-hookshot.openproject.schema_version"] ===
      OPENPROJECT_EVENT_SCHEMA_VERSION &&
    content["org.matrix.matrix-hookshot.openproject.event_kind"] ===
      OPENPROJECT_ANCHOR_EVENT_KIND &&
    content["org.matrix.matrix-hookshot.openproject.anchor_state"] ===
      OPENPROJECT_ANCHOR_STATE_ACTIVE &&
    typeof content["org.matrix.matrix-hookshot.openproject.snapshot_id"] ===
      "string" &&
    isRecord(workPackage) &&
    workPackage.id === workPackageId &&
    typeof workPackage.subject === "string" &&
    typeof workPackage.url === "string"
  );
}

/** Executes commands that manage OpenProject work package timeline anchors. */
export class OpenProjectTimelineCommandService {
  public constructor(
    private readonly context: OpenProjectTimelineCommandContext,
  ) {}

  /** Add a work package as an active timeline anchor. */
  public async addTimelineWorkPackage(
    userId: string,
    workPackageIdArgument: string,
  ): Promise<void> {
    const workPackageId = parseWorkPackageId(workPackageIdArgument);
    const client = await this.getClient(userId);
    const workPackage = await client.getWorkPackage(workPackageId);
    if (workPackage._embedded.project.id !== this.context.projectId) {
      throw new CommandError(
        "Work package belongs to another project",
        "This work package is not part of the project configured for this connection.",
      );
    }

    await this.context.runTimelineTransition(workPackage.id, async () => {
      const activeAnchor = await this.context.storage.getOpenProjectAnchorState(
        this.context.connectionId,
        workPackage.id,
      );
      if (activeAnchor) {
        return;
      }

      const content = formatWorkPackageAnchorContent(
        workPackage,
        this.context.baseURL,
        { snapshotId: randomUUID() },
      );
      const anchorEventId = await this.context.sendEvent(
        content.body,
        content,
        { inline: false },
      );
      await this.context.storage.setOpenProjectAnchorState(
        this.context.connectionId,
        workPackage.id,
        {
          anchorEventId,
          lockVersion: workPackage.lockVersion,
          lastContent: content,
        },
      );
    });
  }

  /** Remove a work package's active timeline anchor. */
  public async removeTimelineWorkPackage(
    workPackageIdArgument: string,
  ): Promise<void> {
    const workPackageId = parseWorkPackageId(workPackageIdArgument);
    await this.context.runTimelineTransition(workPackageId, async () => {
      const activeAnchor = await this.context.storage.getOpenProjectAnchorState(
        this.context.connectionId,
        workPackageId,
      );
      if (!activeAnchor) {
        return;
      }
      if (!isValidAnchorStateForRemoval(activeAnchor, workPackageId)) {
        throw new CommandError(
          "Invalid stored timeline anchor",
          "The stored timeline anchor is invalid and cannot be removed safely.",
        );
      }

      const replacement = formatInactiveWorkPackageAnchorReplacement(
        activeAnchor.anchorEventId,
        activeAnchor.lastContent,
        randomUUID(),
      );
      await this.context.sendEvent(replacement.body, replacement, {
        inline: false,
      });
      await this.context.storage.deleteOpenProjectAnchorState(
        this.context.connectionId,
        workPackageId,
      );
    });
  }

  private async getClient(userId: string) {
    const client = await this.context.tokenStore.getOpenProjectForUser(userId);
    if (!client) {
      throw new NotLoggedInError();
    }
    return client;
  }
}
