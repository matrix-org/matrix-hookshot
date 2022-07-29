import { MatrixEvent, MatrixMessageContent } from "../MatrixEvent";
import { IssuesOpenedEvent, IssuesEditedEvent } from "@octokit/webhooks-types";
import { GetConnectionsResponseItem } from "../provisioning/api";
import { Appservice, IRichReplyMetadata, StateEvent } from "matrix-bot-sdk";
import { BridgeConfig, BridgePermissionLevel } from "../Config/Config";
import { UserTokenStore } from "../UserTokenStore";
import { CommentProcessor } from "../CommentProcessor";
import { MessageSenderClient } from "../MatrixSender";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";
import { GithubInstance } from "../Github/GithubInstance";
import "reflect-metadata";

export type PermissionCheckFn = (service: string, level: BridgePermissionLevel) => boolean;

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
    onMessageEvent?: (ev: MatrixEvent<MatrixMessageContent>, checkPermission: PermissionCheckFn, replyMetadata?: IRichReplyMetadata) => Promise<boolean>;

    onIssueCreated?: (ev: IssuesOpenedEvent) => Promise<void>;

    onIssueStateChange?: (ev: IssuesEditedEvent) => Promise<void>;

    onIssueEdited?: (event: IssuesEditedEvent) => Promise<void>;

    isInterestedInStateEvent: (eventType: string, stateKey: string) => boolean;

    /**
     * Is the connection interested in the event that is being sent from the remote side?
     */
    isInterestedInHookEvent?: (eventType: string) => boolean;

    /**
     * The details to be sent to the provisioner when requested about this connection.
     */
    getProvisionerDetails?: (showSecrets?: boolean) => GetConnectionsResponseItem;

    /**
     * If supported, this is sent when a user attempts to update the configuration of a connection.
     */
    provisionerUpdateConfig?: <T extends Record<string, unknown>>(userId: string, config: T) => void;

    /**
     * If supported, this is sent when a user attempts to remove the connection from a room. The connection
     *  state should be removed and any resources should be cleaned away.
     * @props purgeRemoteConfig Should the remote configuration for the connection be purged (in the case that
     * other connections may be sharing a remote resource).
     */
    onRemove?: () => Promise<void>;

    toString(): string;
}



export interface ConnectionDeclaration<C extends IConnection = IConnection> {
    EventTypes: string[];
    ServiceCategory: string;
    provisionConnection?: (roomId: string, userId: string, data: Record<string, unknown>, opts: ProvisionConnectionOpts) => Promise<{connection: C}>;
    createConnectionForState: (roomId: string, state: StateEvent<Record<string, unknown>>, opts: InstantiateConnectionOpts) => C|Promise<C>
}

export const ConnectionDeclarations: Array<ConnectionDeclaration> = [];

export interface InstantiateConnectionOpts {
    as: Appservice,
    config: BridgeConfig,
    tokenStore: UserTokenStore,
    commentProcessor: CommentProcessor,
    messageClient: MessageSenderClient,
    storage: IBridgeStorageProvider,
    github?: GithubInstance,
}
export interface ProvisionConnectionOpts extends InstantiateConnectionOpts {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getAllConnectionsOfType<T extends IConnection>(typeT: new (...params : any[]) => T): T[],
}


export function Connection<T extends ConnectionDeclaration>(connectionType: T) {
    // Event type clashes
    if (ConnectionDeclarations.find(
        (existingConn) => !!connectionType.EventTypes.find(
            (evtType) => existingConn.EventTypes.includes(evtType))
        )
    ) {
        throw Error(`Provisioning connection for ${connectionType.EventTypes[0]} has a event type clash with another connection`);
    }
    ConnectionDeclarations.push(connectionType);
    return connectionType;
}
