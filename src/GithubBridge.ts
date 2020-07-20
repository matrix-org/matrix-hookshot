import { Appservice, IAppserviceRegistration, RichRepliesPreprocessor, IRichReplyMetadata } from "matrix-bot-sdk";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { BridgeConfig } from "./Config";
import { IGitHubWebhookEvent, IOAuthRequest, IOAuthTokens, NotificationsEnableEvent,
    NotificationsDisableEvent } from "./GithubWebhooks";
import { CommentProcessor } from "./CommentProcessor";
import { MessageQueue, createMessageQueue } from "./MessageQueue/MessageQueue";
import { AdminRoom, BRIDGE_ROOM_TYPE, AdminAccountData } from "./AdminRoom";
import { UserTokenStore } from "./UserTokenStore";
import { MatrixEvent, MatrixMemberContent, MatrixMessageContent } from "./MatrixEvent";
import LogWrapper from "./LogWrapper";
import { MessageSenderClient } from "./MatrixSender";
import { promises as fs } from "fs";
import { UserNotificationsEvent } from "./UserNotificationWatcher";
import { RedisStorageProvider } from "./Stores/RedisStorageProvider";
import { MemoryStorageProvider } from "./Stores/MemoryStorageProvider";
import { NotificationProcessor } from "./NotificationsProcessor";
import { IStorageProvider } from "./Stores/StorageProvider";
import { retry } from "./PromiseUtil";
import { IConnection } from "./Connections/IConnection";
import { GitHubRepoConnection } from "./Connections/GithubRepo";
import { GitHubIssueConnection } from "./Connections/GithubIssue";
import { GitHubProjectConnection } from "./Connections/GithubProject";

const log = new LogWrapper("GithubBridge");

export class GithubBridge {
    private octokit!: Octokit;
    private as!: Appservice;
    private adminRooms: Map<string, AdminRoom> = new Map();
    private commentProcessor!: CommentProcessor;
    private notifProcessor!: NotificationProcessor;
    private queue!: MessageQueue;
    private tokenStore!: UserTokenStore;
    private messageClient!: MessageSenderClient;

    private connections: IConnection[] = [];

    constructor(private config: BridgeConfig, private registration: IAppserviceRegistration) { }

    private createConnectionForState(roomId: string, state: MatrixEvent<any>) {
        if (state.content.disabled === false) {
            log.debug(`${roomId} has disabled state for ${state.type}`);
            return;
        }

        if (GitHubRepoConnection.EventTypes.includes(state.type)) {
            return new GitHubRepoConnection(roomId, this.as, state.content, this.tokenStore, this.octokit);
        }

        if (GitHubIssueConnection.EventTypes.includes(state.type)) {
            return new GitHubIssueConnection(roomId, this.as, state.content, state.state_key || "", this.tokenStore, this.commentProcessor, this.messageClient, this.octokit);
        }
        return;
    }

    private async createConnectionsForRoomId(roomId: string): Promise<IConnection[]> {
        const state = await this.as.botClient.getRoomState(roomId);
        return state.map((event) => this.createConnectionForState(roomId, event)).filter((connection) => !!connection) as unknown as IConnection[];
    }

    private getConnectionsForGithubIssue(org: string, repo: string, issueNumber: number) {
        return this.connections.filter((c) => (c instanceof GitHubIssueConnection && c.org === org && c.repo === repo && c.issueNumber === issueNumber) ||
            (c instanceof GitHubRepoConnection && c.org === org && c.repo === repo));
    }

    public stop() {
        this.as.stop();
        this.queue.stop();
    }

    public async start() {
        log.info('Starting up');
        this.queue = createMessageQueue(this.config);
        this.messageClient = new MessageSenderClient(this.queue);

        // TODO: Make this generic.
        const auth = {
            id: parseInt(this.config.github.auth.id as string, 10),
            privateKey: await fs.readFile(this.config.github.auth.privateKeyFile, "utf-8"),
            installationId: parseInt(this.config.github.installationId as string, 10),
        };

        this.octokit = new Octokit({
            authStrategy: createAppAuth,
            auth,
            userAgent: "matrix-github v0.0.1",
        });

        try {
            await this.octokit.rateLimit.get();
            log.info("Auth check success");
        } catch (ex) {
            log.info("Auth check failed:", ex);
            throw Error("Attempting to verify GitHub authentication configration failed");
        }

        let storage: IStorageProvider;
        if (this.config.queue.host && this.config.queue.port) {
            log.info(`Initialising Redis storage (on ${this.config.queue.host}:${this.config.queue.port})`);
            storage = new RedisStorageProvider(this.config.queue.host, this.config.queue.port);
        } else {
            log.info('Initialising memory storage');
            storage = new MemoryStorageProvider();
        }


        this.notifProcessor = new NotificationProcessor(storage, this.messageClient);

        this.as = new Appservice({
            homeserverName: this.config.bridge.domain,
            homeserverUrl: this.config.bridge.url,
            port: this.config.bridge.port,
            bindAddress: this.config.bridge.bindAddress,
            registration: this.registration,
            storage,
        });

        this.commentProcessor = new CommentProcessor(this.as, this.config.bridge.mediaUrl);

        this.tokenStore = new UserTokenStore(this.config.passFile || "./passkey.pem", this.as.botIntent);
        await this.tokenStore.load();

        this.as.on("query.room", async (roomAlias, cb) => {
            try {
                cb(await this.onQueryRoom(roomAlias));
            } catch (ex) {
                log.error("Failed to create room:", ex);
                cb(false);
            }
        });

        this.as.on("room.invite", async (roomId, event) => {
            return this.onRoomInvite(roomId, event);
        });

        this.as.on("room.message", async (roomId, event) => {
            return this.onRoomMessage(roomId, event);
        });

        this.as.on("room.event", async (roomId, event) => {
            return this.onRoomEvent(roomId, event);
        });

        this.as.on("room.join", async (roomId, event) => {
            return this.onRoomJoin(roomId, event);
        });

        this.queue.subscribe("comment.*");
        this.queue.subscribe("issue.*");
        this.queue.subscribe("response.matrix.message");
        this.queue.subscribe("notifications.user.events");

        this.queue.on<IGitHubWebhookEvent>("comment.created", async (msg) => {
            const connections = this.getConnectionsForGithubIssue(msg.data.repository!.owner.login, msg.data.repository!.name, msg.data.issue!.number);
            connections.map(async (c) => {
                try {
                    if (c.onCommentCreated)
                        await c.onCommentCreated(msg.data);
                } catch (ex) {
                    log.warn(`Connection ${c.toString()} failed to handle comment.created:`, ex);
                }
            })
        });

        this.queue.on<IGitHubWebhookEvent>("issue.opened", async (msg) => {
            const connections = this.getConnectionsForGithubIssue(msg.data.repository!.owner.login, msg.data.repository!.name, msg.data.issue!.number);
            connections.map(async (c) => {
                try {
                    if (c.onIssueCreated)
                        await c.onIssueCreated(msg.data);
                } catch (ex) {
                    log.warn(`Connection ${c.toString()} failed to handle comment.created:`, ex);
                }
            })
        });

        this.queue.on<IGitHubWebhookEvent>("issue.edited", async (msg) => {
            const connections = this.getConnectionsForGithubIssue(msg.data.repository!.owner.login, msg.data.repository!.name, msg.data.issue!.number);
            connections.map(async (c) => {
                try {
                    if (c.onIssueEdited)
                        await c.onIssueEdited(msg.data);
                } catch (ex) {
                    log.warn(`Connection ${c.toString()} failed to handle comment.created:`, ex);
                }
            })
        });

        this.queue.on<IGitHubWebhookEvent>("issue.closed", async (msg) => {
            const connections = this.getConnectionsForGithubIssue(msg.data.repository!.owner.login, msg.data.repository!.name, msg.data.issue!.number);
            connections.map(async (c) => {
                try {
                    if (c.onIssueStateChange)
                        await c.onIssueStateChange(msg.data);
                } catch (ex) {
                    log.warn(`Connection ${c.toString()} failed to handle comment.created:`, ex);
                }
            })
        });

        this.queue.on<IGitHubWebhookEvent>("issue.reopened", async (msg) => {
            const connections = this.getConnectionsForGithubIssue(msg.data.repository!.owner.login, msg.data.repository!.name, msg.data.issue!.number);
            connections.map(async (c) => {
                try {
                    if (c.onIssueStateChange)
                        await c.onIssueStateChange(msg.data);
                } catch (ex) {
                    log.warn(`Connection ${c.toString()} failed to handle comment.created:`, ex);
                }
            })
        });

        this.queue.on<UserNotificationsEvent>("notifications.user.events", async (msg) => {
            const adminRoom = this.adminRooms.get(msg.data.roomId);
            if (!adminRoom) {
                log.warn("No admin room for this notif stream!");
                return;
            }
            await this.notifProcessor.onUserEvents(msg.data, adminRoom);
        });

        this.queue.on<IOAuthRequest>("oauth.response", async (msg) => {
            const adminRoom = [...this.adminRooms.values()].find((r) => r.oauthState === msg.data.state);
            await this.queue.push<boolean>({
                data: !!(adminRoom),
                sender: "GithubBridge",
                messageId: msg.messageId,
                eventName: "response.oauth.response",
            });
        });

        this.queue.on<IOAuthTokens>("oauth.tokens", async (msg) => {
            const adminRoom = [...this.adminRooms.values()].find((r) => r.oauthState === msg.data.state);
            if (!adminRoom) {
                log.warn("Could not find admin room for successful tokens request. This shouldn't happen!");
                return;
            }
            adminRoom.clearOauthState();
            await this.tokenStore.storeUserToken("github", adminRoom.userId, msg.data.access_token);
        });
    
        // Fetch all room state
        let joinedRooms: string[];
        while(true) {
            try {
                log.info("Connecting to homeserver and fetching joined rooms..");
                joinedRooms = await this.as.botIntent.underlyingClient.getJoinedRooms();
                log.info(`Found ${joinedRooms.length} rooms`);
                break;
            } catch (ex) {
                // This is our first interaction with the homeserver, so wait if it's not ready yet.
                log.warn("Failed to connect to homeserver:", ex, "retrying in 5s");
                await new Promise((r) => setTimeout(r, 5000));
            }
        }

        // Set the name and avatar of the bot
        if (this.config.bot) {
            // Ensure we are registered before we set a profile
            await this.as.botIntent.ensureRegistered();
            const profile = await this.as.botClient.getUserProfile(this.as.botUserId);
            if (this.config.bot.avatar && profile.avatar_url !== this.config.bot.avatar) {
                log.info(`Setting avatar to ${this.config.bot.avatar}`);
                await this.as.botClient.setAvatarUrl(this.config.bot.avatar);
            }
            if (this.config.bot.displayname && profile.displayname !== this.config.bot.displayname) {
                log.info(`Setting displayname to ${this.config.bot.displayname}`);
                await this.as.botClient.setDisplayName(this.config.bot.displayname);
            }
        }

        for (const roomId of joinedRooms) {
            log.info("Fetching state for " + roomId);
            const connections = await this.createConnectionsForRoomId(roomId);
            this.connections.push(...connections);
            if (connections.length === 0) {
                // TODO: Refactor this to be a connection
                try {
                    const accountData = await this.as.botIntent.underlyingClient.getRoomAccountData(
                        BRIDGE_ROOM_TYPE, roomId,
                    );
                    if (accountData.type === "admin") {
                        const adminRoom = this.setupAdminRoom(roomId, accountData);
                        // Call this on startup to set the state
                        await this.onAdminRoomSettingsChanged(adminRoom, accountData);
                    }
                } catch (ex) {
                    log.warn(`Room ${roomId} has no connections and is not an admin room`);
                }
            } else {
                log.info(`Room ${roomId} is connected to: ${connections.join(',')}`);
            }
        }

        await this.as.begin();
        log.info("Started bridge");
    }

    private async onRoomInvite(roomId: string, event: MatrixEvent<MatrixMemberContent>) {
        if (this.as.isNamespacedUser(event.sender)) {
            /* Do not handle invites from our users */
            return;
        }
        log.info(`Got invite roomId=${roomId} from=${event.sender} to=${event.state_key}`);
        // Room joins can fail over federation
        if (event.state_key !== this.as.botUserId) {
            return this.as.botIntent.underlyingClient.kickUser(this.as.botUserId, roomId, "Bridge does not support DMing ghosts");
        }
        await retry(() => this.as.botIntent.joinRoom(roomId), 5);
        if (event.content.is_direct) {
            this.setupAdminRoom(roomId, {admin_user: event.sender, notifications: { enabled: false, participating: false}});
        }
        // This is a group room, don't add the admin settings and just sit in the room.
    }

    private async onRoomMessage(roomId: string, event: MatrixEvent<MatrixMessageContent>) {
        if (this.as.isNamespacedUser(event.sender)) {
            /* We ignore messages from our users */
            return;
        }
        log.info(`Got message roomId=${roomId} from=${event.sender}`);
        log.debug(event);

        if (this.adminRooms.has(roomId)) {
            const room = this.adminRooms.get(roomId)!;
            if (room.userId !== event.sender) {
                return;
            }

            const replyProcessor = new RichRepliesPreprocessor(true);
            const processedReply = await replyProcessor.processEvent(event, this.as.botClient);

            if (processedReply) {
                const metadata: IRichReplyMetadata = processedReply.mx_richreply;
                log.info(`Handling reply to ${metadata.parentEventId} for ${room.userId}`);
                // This might be a reply to a notification
                try {
                    const ev = metadata.realEvent;
                    const splitParts: string[] = ev.content["uk.half-shot.matrix-github.repo"]?.name.split("/");
                    const issueNumber = ev.content["uk.half-shot.matrix-github.issue"]?.number;
                    if (splitParts && issueNumber) {
                        log.info(`Handling reply for ${splitParts}${issueNumber}`);
                        const connections = this.getConnectionsForGithubIssue(splitParts[0], splitParts[1], issueNumber);
                        await Promise.all(connections.map(async c => {
                            if (c instanceof GitHubIssueConnection) {
                                return c.onMatrixIssueComment(processedReply);
                            }
                        }));
                    } else {
                        log.info("Missing parts!:", splitParts, issueNumber);
                    }
                } catch (ex) {
                    await room.sendNotice("Failed to handle repy. You may not be authenticated to do that.");
                    log.error("Reply event could not be handled:", ex);
                }
                return;
            }

            const command = event.content.body;
            if (command) {
                await this.adminRooms.get(roomId)!.handleCommand(command);
            }
        }

        for (const connection of this.connections.filter((c) => c.roomId === roomId && c.onMessageEvent)) {
            try {
                await connection.onMessageEvent!(event);
            } catch (ex) {
                log.warn(`Connection ${connection.toString()} failed to handle message:`, ex);
            }
        }
    }

    private async onRoomJoin(roomId: string, matrixEvent: MatrixEvent<MatrixMemberContent>) {
        if (this.as.botUserId !== matrixEvent.sender) {
            // Only act on bot joins
            return;
        }

        const isRoomConnected = !!this.connections.find(c => c.roomId === roomId);

        // Only fetch rooms we have no connections in yet.
        if (!isRoomConnected) {
            const connections = await this.createConnectionsForRoomId(roomId);
            this.connections.push(...connections);
        }
    }

    private async onRoomEvent(roomId: string, event: MatrixEvent<unknown>) {
        if (event.state_key) {
            // A state update, hurrah!
            const existingConnection = this.connections.find((c) => c.roomId === roomId && c.isInterestedInStateEvent(event.type, event.state_key || ""));
            if (existingConnection) {
                existingConnection.onStateUpdate(event);
            } else {
                // Is anyone interested in this state?
                const connection = await this.createConnectionForState(roomId, event);
                if (connection) {
                    log.info(`Found new state for ${roomId}`);
                    this.connections.push(connection);
                }
            }
            return null;
        }

        // Alas, it's just an event.
        return this.connections.filter((c) => c.roomId === roomId).map((c) => c.onEvent(event))
    }

    private async onQueryRoom(roomAlias: string) {
        log.info("Got room query request:", roomAlias);
        // Determine which type of room it is.
        let res: RegExpExecArray | null;
        res = GitHubIssueConnection.QueryRoomRegex.exec(roomAlias);
        if (res) {
            try {
                return await GitHubIssueConnection.onQueryRoom(res, {
                    as: this.as,
                    tokenStore: this.tokenStore,
                    messageClient: this.messageClient,
                    commentProcessor: this.commentProcessor,
                    octokit: this.octokit,
                });
            } catch (ex) {
                log.error(`Could not handle alias with GitHubIssueConnection`, ex);
                throw ex;
            }
        }

        res = GitHubRepoConnection.QueryRoomRegex.exec(roomAlias);
        if (res) {
            try {
                return await GitHubRepoConnection.onQueryRoom(res, {
                    as: this.as,
                    tokenStore: this.tokenStore,
                    messageClient: this.messageClient,
                    commentProcessor: this.commentProcessor,
                    octokit: this.octokit,
                });
            } catch (ex) {
                log.error(`Could not handle alias with GitHubRepoConnection`, ex);
                throw ex;
            }
        }

        throw Error('No regex matching query pattern');
    }

    private async onAdminRoomSettingsChanged(adminRoom: AdminRoom, settings: AdminAccountData) {
        log.info(`Settings changed for ${adminRoom.userId} ${settings}`);
        if (adminRoom.notificationsEnabled) {
            log.info(`Notifications enabled for ${adminRoom.userId}`);
            const token = await this.tokenStore.getUserToken("github", adminRoom.userId);
            if (token) {
                log.info(`Notifications enabled for ${adminRoom.userId} and token was found`);
                await this.queue.push<NotificationsEnableEvent>({
                    eventName: "notifications.user.enable",
                    sender: "GithubBridge",
                    data: {
                        user_id: adminRoom.userId,
                        room_id: adminRoom.roomId,
                        token,
                        since: await adminRoom.getNotifSince(),
                        filter_participating: adminRoom.notificationsParticipating,
                    },
                });
            } else {
                log.warn(`Notifications enabled for ${adminRoom.userId} but no token stored!`);
            }
        } else {
            await this.queue.push<NotificationsDisableEvent>({
                eventName: "notifications.user.disable",
                sender: "GithubBridge",
                data: {
                    user_id: adminRoom.userId,
                },
            });
        }
    }

    private setupAdminRoom(roomId: string, accountData: AdminAccountData) {
        const adminRoom = new AdminRoom(
            roomId, accountData, this.as.botIntent, this.tokenStore, this.config,
        );
        adminRoom.on("settings.changed", this.onAdminRoomSettingsChanged.bind(this));
        adminRoom.on("open.project", async (project: Octokit.ProjectsGetResponse) => {
            const connection = await GitHubProjectConnection.onOpenProject(project, this.as, adminRoom.userId);
            this.connections.push(connection);
        });
        this.adminRooms.set(roomId, adminRoom);
        log.info(`Setup ${roomId} as an admin room for ${adminRoom.userId}`);
        return adminRoom;
    }
}
