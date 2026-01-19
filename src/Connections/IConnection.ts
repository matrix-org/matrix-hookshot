import { MatrixEvent, MatrixMessageContent } from "../MatrixEvent";
import { IssuesOpenedEvent, IssuesEditedEvent } from "@octokit/webhooks-types";
import { ConnectionWarning, GetConnectionsResponseItem } from "../widgets/Api";
import {
  Appservice,
  Intent,
  IRichReplyMetadata,
  RoomEvent,
  StateEvent,
} from "matrix-bot-sdk";
import { BridgeConfig, BridgePermissionLevel } from "../config/Config";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { CommentProcessor } from "../CommentProcessor";
import { MessageSenderClient } from "../MatrixSender";
import { IBridgeStorageProvider } from "../stores/StorageProvider";
import { GithubInstance } from "../github/GithubInstance";
import "reflect-metadata";
import { IJsonType } from "matrix-bot-sdk/lib/helpers/Types";
import { ConnectionType } from "./type";

export type PermissionCheckFn = (
  service: string,
  level: BridgePermissionLevel,
) => boolean;

export interface IConnectionState {
  priority?: number;
  commandPrefix?: string;
}

export interface IConnection {
  /**
   * The roomId that this connection serves.
   */
  roomId: string;

  priority: number;

  /**
   * If true, the connection cannot be altered in any way.
   */
  isStatic?: boolean;

  /**
   * Ensures that the current state loaded into the connection has been granted by
   * the remote service. I.e. If the room is bridged into a GitHub repository,
   * check that the *sender* has permission to bridge it.
   *
   * If a grant cannot be found, it may be determined by doing an API lookup against
   * the remote service.
   *
   * @param sender The matrix ID of the sender of the event.
   * @throws If the grant cannot be found, and cannot be detetermined, this will throw.
   */
  ensureGrant?: (sender?: string) => void;

  /**
   * The unique connection ID. This is a opaque hash of the roomId, connection type and state key.
   */
  get connectionId(): string;
  /**
   * When a room gets an update to its state.
   */
  onStateUpdate?: (ev: MatrixEvent<unknown>) => Promise<void>;
  /**
   * When a room gets any event
   */
  onEvent?: (ev: MatrixEvent<unknown>) => Promise<void>;

  /**
   * When a room gets a message event.
   * @returns Was the message handled
   */
  onMessageEvent?: (
    ev: MatrixEvent<MatrixMessageContent>,
    checkPermission: PermissionCheckFn,
    parentEvent?: RoomEvent<IJsonType>,
  ) => Promise<boolean>;

  onIssueCreated?: (ev: IssuesOpenedEvent) => Promise<void>;

  onIssueStateChange?: (ev: IssuesEditedEvent) => Promise<void>;

  onIssueEdited?: (event: IssuesEditedEvent) => Promise<void>;

  isInterestedInStateEvent: (eventType: string, stateKey: string) => boolean;

  /**
   * The room is being migrated, and this state should be migrated away.
   * @param newRoomId
   */
  migrateToNewRoom?(newRoomId: string): Promise<void>;

  /**
   * The details to be sent to the provisioner when requested about this connection.
   */
  getProvisionerDetails?: (showSecrets?: boolean) => GetConnectionsResponseItem;

  /**
   * If supported, this is sent when a user attempts to update the configuration of a connection.
   */
  provisionerUpdateConfig?: <T extends Record<string, unknown>>(
    userId: string,
    config: T,
  ) => Promise<void>;

  /**
   * If supported, this is sent when a user attempts to remove the connection from a room. The connection
   *  state should be removed and any resources should be cleaned away.
   * @props purgeRemoteConfig Should the remote configuration for the connection be purged (in the case that
   * other connections may be sharing a remote resource).
   */
  onRemove?: () => Promise<void>;

  toString(): string;

  conflictsWithCommandPrefix?: (commandPrefix: string) => boolean;
}

export type ConnectionDeclaration<C extends IConnection = IConnection> =
  | ConnectionDeclarationBase<C>
  | ConnectionDeclarationWithStatic<C>;

interface ConnectionDeclarationBase<C extends IConnection = IConnection> {
  EventTypes: string[];
  ServiceCategory: ConnectionType;
  provisionConnection?: (
    roomId: string,
    userId: string,
    data: Record<string, unknown>,
    opts: ProvisionConnectionOpts,
  ) => Promise<{ connection: C; warning?: ConnectionWarning }>;
  createConnectionForState: (
    roomId: string,
    state: StateEvent<Record<string, unknown>>,
    opts: InstantiateConnectionOpts,
  ) => C | Promise<C>;
}

interface ConnectionDeclarationWithStatic<C extends IConnection = IConnection>
  extends ConnectionDeclarationBase<C> {
  SupportsStaticConfiguration: true;
  validateState: (data: Record<string, unknown>) => void;
}

export const ConnectionDeclarations: Array<ConnectionDeclaration> = [];

export interface InstantiateConnectionOpts {
  as: Appservice;
  intent: Intent;
  config: BridgeConfig;
  tokenStore: UserTokenStore;
  commentProcessor: CommentProcessor;
  messageClient: MessageSenderClient;
  storage: IBridgeStorageProvider;
  github?: GithubInstance;
  isStatic?: boolean;
}
export interface ProvisionConnectionOpts extends InstantiateConnectionOpts {
  getAllConnectionsOfType<T extends IConnection>(
    typeT: new (...params: any[]) => T,
  ): T[];
}

export function Connection<T extends ConnectionDeclaration>(connectionType: T) {
  // Event type clashes
  if (
    ConnectionDeclarations.find(
      (existingConn) =>
        !!connectionType.EventTypes.find((evtType) =>
          existingConn.EventTypes.includes(evtType),
        ),
    )
  ) {
    throw Error(
      `Provisioning connection for ${connectionType.EventTypes[0]} has a event type clash with another connection`,
    );
  }
  ConnectionDeclarations.push(connectionType);
  return connectionType;
}
