import { Appservice, IAppserviceRegistration } from "matrix-bot-sdk";
import { Octokit } from "@octokit/rest";
import { createTokenAuth } from "@octokit/auth-token";
import { createAppAuth } from "@octokit/auth-app";
import markdown from "markdown-it";
import { IBridgeRoomState, BRIDGE_STATE_TYPE } from "./BridgeState";
import { BridgeConfig } from "./Config";
import { IWebhookEvent, IOAuthRequest, IOAuthTokens, NotificationsEnableEvent, NotificationsDisableEvent } from "./GithubWebhooks";
import { CommentProcessor } from "./CommentProcessor";
import { MessageQueue, createMessageQueue } from "./MessageQueue/MessageQueue";
import { AdminRoom, BRIDGE_ROOM_TYPE, AdminAccountData } from "./AdminRoom";
import { UserTokenStore } from "./UserTokenStore";
import { FormatUtil } from "./FormatUtil";
import { MatrixEvent, MatrixMemberContent, MatrixMessageContent } from "./MatrixEvent";
import { LogWrapper } from "./LogWrapper";
import { MessageSenderClient } from "./MatrixSender";
import { promises as fs } from "fs";
import { UserNotificationsEvent } from "./UserNotificationWatcher";
import { RedisStorageProvider } from "./Stores/RedisStorageProvider";
import { MemoryStorageProvider } from "./Stores/MemoryStorageProvider";
import { NotificationProcessor } from "./NotificationsProcessor";
import { IStorageProvider } from "./Stores/StorageProvider";
import { retry } from "./PromiseUtil";

const md = new markdown();
const log = new LogWrapper("GithubBridge");

export class GithubBridge {
    private octokit!: Octokit;
    private as!: Appservice;
    private adminRooms: Map<string, AdminRoom>;
    private roomIdtoBridgeState: Map<string, IBridgeRoomState[]>;
    private orgRepoIssueToRoomId: Map<string, string>;
    private matrixHandledEvents: Set<string>;
    private commentProcessor!: CommentProcessor;
    private notifProcessor!: NotificationProcessor;
    private queue!: MessageQueue;
    private tokenStore!: UserTokenStore;
    private messageClient!: MessageSenderClient;

    constructor(private config: BridgeConfig, private registration: IAppserviceRegistration) {
        this.roomIdtoBridgeState = new Map();
        this.orgRepoIssueToRoomId = new Map();
        this.matrixHandledEvents = new Set();
        this.adminRooms = new Map();
    }

    public async start() {
        this.adminRooms = new Map();

        this.queue = createMessageQueue(this.config);
        this.messageClient = new MessageSenderClient(this.queue);

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
            storage = new RedisStorageProvider(this.config.queue.host, this.config.queue.port);
        } else {
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

        this.tokenStore = new UserTokenStore(this.config.github.passFile || "./passkey.pem", this.as.botIntent);
        await this.tokenStore.load();

        this.as.on("query.room", async (roomAlias, cb) => {
            try {
                cb(await this.onQueryRoom(roomAlias));
            } catch (ex) {
                log.error("Failed to create room:", ex);
                cb(false);
            }
        });

        this.as.on("room.event", async (roomId, event) => {
            return this.onRoomEvent(roomId, event);
        });

        this.queue.subscribe("comment.*");
        this.queue.subscribe("issue.*");
        this.queue.subscribe("response.matrix.message");
        this.queue.subscribe("notifications.user.events");

        this.queue.on<IWebhookEvent>("comment.created", async (msg) => {
            return this.onCommentCreated(msg.data);
        });

        this.queue.on<IWebhookEvent>("issue.edited", async (msg) => {
            return this.onIssueEdited(msg.data);
        });

        this.queue.on<IWebhookEvent>("issue.closed", async (msg) => {
            return this.onIssueStateChange(msg.data);
        });

        this.queue.on<IWebhookEvent>("issue.reopened", async (msg) => {
            return this.onIssueStateChange(msg.data);
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
            await this.tokenStore.storeUserToken(adminRoom.userId, msg.data.access_token);
        });

        // Fetch all room state
        const joinedRooms = await this.as.botIntent.underlyingClient.getJoinedRooms();
        for (const roomId of joinedRooms) {
            log.info("Fetching state for " + roomId);
            try {
                const accountData = await this.as.botIntent.underlyingClient.getRoomAccountData(
                    BRIDGE_ROOM_TYPE, roomId,
                );
                if (accountData.type === "admin") {
                    const adminRoom = new AdminRoom(
                        roomId, accountData, this.as.botIntent, this.tokenStore, this.config,
                    );
                    adminRoom.on("settings.changed", this.onAdminRoomSettingsChanged.bind(this));
                    this.adminRooms.set(roomId, adminRoom);
                    log.info(`${roomId} is an admin room for ${adminRoom.userId}`);
                    // Call this on startup to set the state
                    await this.onAdminRoomSettingsChanged(adminRoom, adminRoom.data);
                }
            } catch (ex) { /* this is an old style room */ }
            await this.getRoomBridgeState(roomId);
        }

        await this.as.begin();
        log.info("Started bridge");
    }

    public stop() {
        this.as.stop();
        this.queue.stop();
    }

    private async getRoomBridgeState(roomId: string, existingState?: IBridgeRoomState) {
        if (this.roomIdtoBridgeState.has(roomId) && !existingState) {
            return this.roomIdtoBridgeState.get(roomId)!;
        }
        try {
            log.info("Updating state cache for " + roomId);
            const state = existingState ? [existingState] : (
                await this.as.botIntent.underlyingClient.getRoomState(roomId)
            );
            const bridgeEvents: IBridgeRoomState[] = state.filter((e: IBridgeRoomState) =>
                e.type === BRIDGE_STATE_TYPE,
            );
            this.roomIdtoBridgeState.set(roomId, bridgeEvents);
            for (const event of bridgeEvents) {
                this.orgRepoIssueToRoomId.set(
                    `${event.content.org}/${event.content.repo}#${event.content.issues[0]}`,
                    roomId,
                );
            }
            return bridgeEvents;
        } catch (ex) {
            log.error(`Failed to get room state for ${roomId}:` + ex);
        }
        return [];
    }

    private async onRoomEvent(roomId: string, event: MatrixEvent<unknown>) {
        const isOurUser = this.as.isNamespacedUser(event.sender);

        if (event.type === "m.room.member" && !isOurUser) {
            const memberEvent = event as MatrixEvent<MatrixMemberContent>;
            if (memberEvent.content.membership !== "invite") {
                return;
            }
            // Room joins can fail over federation
            await retry(() => this.as.botIntent.joinRoom(roomId), 5);
            const members = await this.as.botIntent.underlyingClient.getJoinedRoomMembers(roomId);
            if (members.filter((userId) => ![this.as.botUserId, event.sender].includes(userId)).length !== 0) {
                await this.messageClient.sendMatrixText(
                    roomId,
                    "This bridge currently only supports invites to 1:1 rooms",
                    "m.notice",
                );
                await this.as.botIntent.underlyingClient.leaveRoom(roomId);
                return;
            }
            const data = {admin_user: event.sender, type: "admin"};
            await this.as.botIntent.underlyingClient.setRoomAccountData(
                BRIDGE_ROOM_TYPE, roomId, data,
            );
            const adminRoom = new AdminRoom(roomId, data, this.as.botIntent, this.tokenStore, this.config);
            adminRoom.on("settings.changed", this.onAdminRoomSettingsChanged.bind(this));
            this.adminRooms.set(
                roomId,
                adminRoom,
            );
        }

        if (event.type === "m.room.message" && this.adminRooms.has(roomId)) {
            const messageEvent = event as MatrixEvent<MatrixMessageContent>;

            const room = this.adminRooms.get(roomId)!;
            if (room.userId !== event.sender) {
                return;
            }

            const replyId = messageEvent["m.relates_to"]?.["m.in_reply_to"]?.event_id;

            if (replyId) {
                log.info(`Handling reply to ${replyId} for ${room.userId}`);
                // This might be a reply to a notification
                try {
                    const ev = await this.as.botIntent.underlyingClient.getEvent(roomId, replyId);
                    const commentId = ev.content["uk.half-shot.matrix-github.comment"]?.id;
                    const splitParts: string[] = ev.content["ukuk.half-shot.matrix-github.repo"]?.full_name.split("/");
                    const issueNumber = ev.content["ukuk.half-shot.matrix-github.issue"]?.number;
                    if (commentId && splitParts && issueNumber) {
                        await this.onMatrixIssueComment(messageEvent, {
                            org: splitParts[0],
                            repo: splitParts[1],
                            issues: [issueNumber.toString()],
                        });
                    } else {
                        log.debug("Missing parts!:", commentId, splitParts, issueNumber);
                    }
                } catch (ex) {
                    log.error("Reply event could not be handled:", ex);
                }
                return;
            }

            const command = messageEvent.content.body;
            if (command) {
                await this.adminRooms.get(roomId)!.handleCommand(command);
            }
            return;
        }

        if (event.type === BRIDGE_STATE_TYPE) {
            const state = event as IBridgeRoomState;
            log.info(`Got new state for ${roomId}`);
            await this.getRoomBridgeState(roomId, state);
            // Get current state of issue.
            await this.syncIssueState(roomId, state);
            return;
        }

        const bridgeState = await this.getRoomBridgeState(roomId);

        if (bridgeState.length === 0) {
            log.info("Room has no state for bridge");
            return;
        }
        if (bridgeState.length > 1) {
            log.error("Can't handle multiple bridges yet");
            return;
        }

        const githubRepo = bridgeState[0].content;
        log.info(`Got new request for ${githubRepo.org}${githubRepo.repo}#${githubRepo.issues.join("|")}`);
        if (!isOurUser && event.type === "m.room.message") {
            const messageEvent = event as MatrixEvent<MatrixMessageContent>;
            if (messageEvent.content.body === "!sync") {
                await this.syncIssueState(roomId, bridgeState[0]);
            }
            await this.onMatrixIssueComment(messageEvent, bridgeState[0].content);
        }
        log.debug(event);
    }

    private async getIntentForUser(user: Octokit.IssuesGetResponseUser) {
        const intent = this.as.getIntentForSuffix(user.login);
        const displayName = `${user.login}`;
        // Verify up-to-date profile
        let profile;
        await intent.ensureRegistered();
        try {
            profile = await intent.underlyingClient.getUserProfile(intent.userId);
            if (profile.displayname !== displayName || (!profile.avatar_url && user.avatar_url)) {
                log.info(`${intent.userId}'s profile is out of date`);
                // Also set avatar
                const buffer = await this.octokit.request(user.avatar_url);
                log.info(`uploading ${user.avatar_url}`);
                // This does exist, but headers is silly and doesn't have content-type.
                // tslint:disable-next-line: no-any
                const contentType = (buffer.headers as any)["content-type"];
                const mxc = await intent.underlyingClient.uploadContent(
                    Buffer.from(buffer.data as ArrayBuffer),
                    contentType,
                );
                await intent.underlyingClient.setAvatarUrl(mxc);
                await intent.underlyingClient.setDisplayName(displayName);
            }
        } catch (ex) {
            profile = {};
        }

        return intent;
    }

    private async syncIssueState(roomId: string, repoState: IBridgeRoomState) {
        log.debug("Syncing issue state for", roomId);
        const issue = await this.octokit.issues.get({
            owner: repoState.content.org,
            repo: repoState.content.repo,
            issue_number: parseInt(repoState.content.issues[0], 10),
        });
        const creatorUserId = this.as.getUserIdForSuffix(issue.data.user.login);

        if (repoState.content.comments_processed === -1) {
            // We've not sent any messages into the room yet, let's do it!
            await this.messageClient.sendMatrixText(
                roomId,
                "This bridge currently only supports invites to 1:1 rooms",
                "m.notice",
                creatorUserId,
            );
            if (issue.data.body) {
                await this.messageClient.sendMatrixMessage(roomId, {
                    msgtype: "m.text",
                    external_url: issue.data.html_url,
                    body: `${issue.data.body} (${issue.data.updated_at})`,
                    format: "org.matrix.custom.html",
                    formatted_body: md.render(issue.data.body),
                }, "m.room.message", creatorUserId);
            }
            if (issue.data.pull_request) {
                // Send a patch in
            }
            repoState.content.comments_processed = 0;
        }

        if (repoState.content.comments_processed !== issue.data.comments) {
            const comments = (await this.octokit.issues.listComments({
                owner: repoState.content.org,
                repo: repoState.content.repo,
                issue_number: parseInt(repoState.content.issues[0], 10),
                // TODO: Use since to get a subset
            })).data.slice(repoState.content.comments_processed);
            for (const comment of comments) {
                await this.onCommentCreated({
                    comment,
                    action: "fake",
                }, roomId, false);
                repoState.content.comments_processed++;
            }
        }

        if (repoState.content.state !== issue.data.state) {
            if (issue.data.state === "closed") {
                const closedUserId = this.as.getUserIdForSuffix(issue.data.closed_by.login);
                await this.messageClient.sendMatrixMessage(roomId, {
                    msgtype: "m.notice",
                    body: `closed the ${issue.data.pull_request ? "pull request" : "issue"} at ${issue.data.closed_at}`,
                    external_url: issue.data.closed_by.html_url,
                }, "m.room.message", closedUserId);
            }

            await this.as.botIntent.underlyingClient.sendStateEvent(roomId, "m.room.topic", "", {
                topic: FormatUtil.formatRoomTopic(issue.data),
            });
            repoState.content.state = issue.data.state;
        }

        await this.as.botIntent.underlyingClient.sendStateEvent(
            roomId,
            BRIDGE_STATE_TYPE,
            repoState.state_key,
            repoState.content,
        );
    }

    private async onQueryRoom(roomAlias: string) {
        log.info("Got room query request:", roomAlias);
        const match = /#github_(.+)_(.+)_(\d+):.*/.exec(roomAlias);
        if (!match || match.length < 4) {
            throw Error("Alias is in an incorrect format");
        }
        const parts = match!.slice(1);

        const owner = parts[0];
        const repo = parts[1];
        const issueNumber = parseInt(parts[2], 10);

        log.info(`Fetching ${owner}/${repo}/${issueNumber}`);
        let issue: Octokit.IssuesGetResponse;
        try {
            issue = (await this.octokit.issues.get({
                owner,
                repo,
                issue_number: issueNumber,
            })).data;
        } catch (ex) {
            log.error("Failed to get issue:", ex);
            throw Error("Could not find issue");
        }

        // URL hack so we don't need to fetch the repo itself.
        const orgRepoName = issue.repository_url.substr("https://api.github.com/repos/".length);

        return {
            visibility: "public",
            name: FormatUtil.formatRoomName(issue),
            topic: FormatUtil.formatRoomTopic(issue),
            preset: "public_chat",
            initial_state: [
                {
                    type: BRIDGE_STATE_TYPE,
                    content: {
                        org: orgRepoName.split("/")[0],
                        repo: orgRepoName.split("/")[1],
                        issues: [String(issue.number)],
                        comments_processed: -1,
                        state: "open",
                    },
                    state_key: issue.url,
                } as IBridgeRoomState,
            ],
        };
    }

    private async onCommentCreated(event: IWebhookEvent, roomId?: string, updateState: boolean = true) {
        if (!roomId) {
            const issueKey = `${event.repository!.owner.login}/${event.repository!.name}#${event.issue!.number}`;
            roomId = this.orgRepoIssueToRoomId.get(issueKey);
            if (!roomId) {
                log.debug("No room id for repo");
                return;
            }
        }
        const comment = event.comment!;
        if (event.repository) {
            // Delay to stop comments racing sends
            await new Promise((resolve) => setTimeout(resolve, 500));
            const dupeKey =
            `${event.repository.owner.login}/${event.repository.name}#${event.issue!.number}~${comment.id}`
            .toLowerCase();
            if (this.matrixHandledEvents.has(dupeKey)) {
                return;
            }
        }
        const commentIntent = await this.getIntentForUser(comment.user);
        const matrixEvent = await this.commentProcessor.getEventBodyForComment(comment, event.repository, event.issue);

        await this.messageClient.sendMatrixMessage(roomId, matrixEvent, "m.room.message", commentIntent.userId);
        if (!updateState) {
            return;
        }
        const state = (await this.getRoomBridgeState(roomId))[0];
        state.content.comments_processed++;
        await this.as.botIntent.underlyingClient.sendStateEvent(
            roomId,
            BRIDGE_STATE_TYPE,
            state.state_key,
            state.content,
        );
    }

    private async onIssueEdited(event: IWebhookEvent) {
        if (!event.changes) {
            log.debug("No changes given");
            return; // No changes made.
        }

        const issueKey = `${event.repository!.owner.login}/${event.repository!.name}#${event.issue!.number}`;
        const roomId = this.orgRepoIssueToRoomId.get(issueKey)!;
        const roomState = await this.getRoomBridgeState(roomId);

        if (!roomId || !roomState) {
            log.debug("No tracked room state");
            return;
        }

        if (event.changes.title) {
            await this.as.botIntent.underlyingClient.sendStateEvent(roomId, "m.room.name", "", {
                name: FormatUtil.formatRoomName(event.issue!),
            });
        }
    }

    private async onIssueStateChange(event: IWebhookEvent) {
        const issueKey = `${event.repository!.owner.login}/${event.repository!.name}#${event.issue!.number}`;
        const roomId = this.orgRepoIssueToRoomId.get(issueKey)!;
        const roomState = await this.getRoomBridgeState(roomId);

        if (!roomId || !roomState || roomState.length === 0) {
            log.debug("No tracked room state");
            return;
        }

        log.debug(roomState);

        await this.syncIssueState(roomId, roomState[0]);
    }

    private async onMatrixIssueComment(event: MatrixEvent<MatrixMessageContent>,
                                       bridgeState: {repo: string, org: string, issues: string[]},
                                       allowEcho: boolean = false) {
        const clientKit = await this.getOctokitForUser(event.sender);
        if (clientKit === null) {
            log.info("Ignoring comment, user is not authenticated");
            return;
        }

        const result = await clientKit.issues.createComment({
            repo: bridgeState.repo,
            owner: bridgeState.org,
            body: await this.commentProcessor.getCommentBodyForEvent(event, false),
            issue_number: parseInt(bridgeState.issues[0], 10),
        });
        if (allowEcho) {
            return;
        }
        const key =
        `${bridgeState.org}/${bridgeState.repo}#${bridgeState.issues[0]}~${result.data.id}`
        .toLowerCase();
        this.matrixHandledEvents.add(key);
    }

    private async onAdminRoomSettingsChanged(adminRoom: AdminRoom, settings: AdminAccountData) {
        log.info(`Settings changed for ${adminRoom.userId} ${settings}`);
        if (adminRoom.notificationsEnabled) {
            log.info(`Notifications enabled for ${adminRoom.userId}`);
            const token = await this.tokenStore.getUserToken(adminRoom.userId);
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

    private async getOctokitForUser(userId: string) {
        const senderToken = await this.tokenStore.getUserToken(userId);
        if (!senderToken) {
            return null;
        }
        return new Octokit({
            authStrategy: createTokenAuth,
            auth: senderToken,
            userAgent: "matrix-github v0.0.1",
        });
    }
}
