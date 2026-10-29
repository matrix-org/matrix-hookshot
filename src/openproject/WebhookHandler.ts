import { randomUUID } from "node:crypto";
import { MatrixError } from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";
import type { OpenProjectEventsNames } from "../Connections/OpenProjectConnection";
import type { IBridgeStorageProvider } from "../stores/StorageProvider";
import {
  formatWorkPackageAnchorContent,
  formatWorkPackageAnchorReplacement,
  formatWorkPackageActivityForMatrix,
  formatWorkPackageDiff,
} from "./Format";
import { workPackageToCacheState } from "./State";
import type { OpenProjectWebhookPayloadWorkPackage } from "./Types";

const log = new Logger("OpenProjectConnection");

/** Services required to process OpenProject work package webhooks. */
export interface OpenProjectWebhookHandlerContext {
  readonly connectionId: string;
  readonly roomId: string;
  readonly projectId: number;
  readonly baseURL: URL;
  readonly storage: IBridgeStorageProvider;
  isAnchorEnabled(eventName: OpenProjectEventsNames): boolean;
  isInterestedInHookEvent(eventName: OpenProjectEventsNames): boolean;
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

function isMissingAnchorError(error: unknown): error is MatrixError {
  return error instanceof MatrixError && error.errcode === "M_NOT_FOUND";
}

/** Processes work package webhook updates into timeline and activity events. */
export class OpenProjectWebhookHandler {
  public constructor(
    private readonly context: OpenProjectWebhookHandlerContext,
  ) {}

  public async onWorkPackageCreated(
    data: OpenProjectWebhookPayloadWorkPackage,
  ) {
    const workPackage = data.work_package;
    await this.context.runTimelineTransition(workPackage.id, async () => {
      try {
        log.info(
          `onWorkPackageCreated ${this.context.roomId} ${this.context.projectId} ${workPackage.id}`,
        );

        const existing = await this.context.storage.getOpenProjectAnchorState(
          this.context.connectionId,
          workPackage.id,
        );
        if (!existing && this.context.isAnchorEnabled("work_package:created")) {
          const content = formatWorkPackageAnchorContent(
            workPackage,
            this.context.baseURL,
            { snapshotId: randomUUID() },
          );
          const anchorEventId = await this.context.sendEvent(
            content.body,
            content,
            {
              inline: false,
            },
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
        } else if (existing && workPackage.lockVersion > existing.lockVersion) {
          const replacement = formatWorkPackageAnchorReplacement(
            existing.anchorEventId,
            workPackage,
            this.context.baseURL,
            { snapshotId: randomUUID() },
          );
          await this.context.sendEvent(replacement.body, replacement, {
            inline: false,
          });
          await this.context.storage.setOpenProjectAnchorState(
            this.context.connectionId,
            workPackage.id,
            {
              anchorEventId: existing.anchorEventId,
              lockVersion: workPackage.lockVersion,
              lastContent: replacement["m.new_content"],
            },
          );
        }
      } catch (error) {
        log.warn(
          `Failed to update OpenProject anchor for ${this.context.connectionId}/${workPackage.id}; Activity processing will continue`,
          error,
        );
      }

      try {
        await this.processWorkPackageActivity(data, true);
      } catch (error) {
        log.warn(
          `Failed to process OpenProject Activity for ${this.context.connectionId}/${workPackage.id}`,
          error,
        );
      }
    });
  }

  public async onWorkPackageUpdated(
    data: OpenProjectWebhookPayloadWorkPackage,
  ) {
    const workPackage = data.work_package;
    log.info(
      `onWorkPackageUpdated ${this.context.roomId} ${this.context.projectId} ${workPackage.id}`,
    );

    await this.context.runTimelineTransition(workPackage.id, async () => {
      try {
        const activeAnchor =
          await this.context.storage.getOpenProjectAnchorState(
            this.context.connectionId,
            workPackage.id,
          );
        if (
          activeAnchor &&
          workPackage.lockVersion > activeAnchor.lockVersion
        ) {
          const replacement = formatWorkPackageAnchorReplacement(
            activeAnchor.anchorEventId,
            workPackage,
            this.context.baseURL,
            { snapshotId: randomUUID() },
          );
          let missingAnchor = false;
          try {
            await this.context.sendEvent(replacement.body, replacement, {
              inline: false,
            });
          } catch (error) {
            if (!isMissingAnchorError(error)) {
              throw error;
            }
            missingAnchor = true;
            await this.context.storage.deleteOpenProjectAnchorState(
              this.context.connectionId,
              workPackage.id,
            );
            log.info(
              `Removing missing OpenProject anchor ${activeAnchor.anchorEventId} for ${this.context.connectionId}/${workPackage.id}`,
            );
          }
          if (!missingAnchor) {
            await this.context.storage.setOpenProjectAnchorState(
              this.context.connectionId,
              workPackage.id,
              {
                anchorEventId: activeAnchor.anchorEventId,
                lockVersion: workPackage.lockVersion,
                lastContent: replacement["m.new_content"],
              },
            );
          }
        }
      } catch (error) {
        log.warn(
          `Failed to update OpenProject anchor for ${this.context.connectionId}/${workPackage.id}; Activity processing will continue`,
          error,
        );
      }

      try {
        await this.processWorkPackageActivity(data, false);
      } catch (error) {
        log.warn(
          `Failed to process OpenProject Activity for ${this.context.connectionId}/${workPackage.id}`,
          error,
        );
      }
    });
  }

  /** Advance this room's Activity cursor and send at most one event per revision. */
  private async processWorkPackageActivity(
    data: OpenProjectWebhookPayloadWorkPackage,
    created: boolean,
  ): Promise<void> {
    const workPackage = data.work_package;
    const previous = await this.context.storage.getOpenProjectActivityState(
      this.context.connectionId,
      workPackage.id,
    );
    if (previous && workPackage.lockVersion <= previous.lockVersion) {
      return;
    }

    const diff =
      previous && !created
        ? formatWorkPackageDiff(previous, workPackage)
        : null;
    const changes = created
      ? ["created"]
      : previous
        ? (diff?.changes ?? [])
        : ["updated the details"];
    const shouldSend = created
      ? this.context.isInterestedInHookEvent("work_package:created")
      : previous
        ? !!diff &&
          (this.context.isInterestedInHookEvent("work_package:updated") ||
            diff.categories.some((category) =>
              this.context.isInterestedInHookEvent(category),
            ))
        : this.context.isInterestedInHookEvent("work_package:updated");

    if (shouldSend) {
      const activeAnchor = await this.context.storage.getOpenProjectAnchorState(
        this.context.connectionId,
        workPackage.id,
      );
      const content = formatWorkPackageActivityForMatrix(
        workPackage,
        this.context.baseURL,
        changes,
        {
          actor: data.actor,
          created,
          anchorEventId: activeAnchor?.anchorEventId,
        },
      );
      await this.context.sendEvent(content.body, content, { inline: false });
    }

    await this.context.storage.setOpenProjectActivityState(
      this.context.connectionId,
      workPackage.id,
      workPackageToCacheState(workPackage),
    );
  }
}
