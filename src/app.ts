import { Appservice, LogService } from "matrix-bot-sdk";
import Octokit, { IssuesGetResponseUser } from "@octokit/rest";
import winston from "winston";
import markdown from "markdown-it";
import { IBridgeRoomState, BRIDGE_STATE_TYPE } from "./BridgeState";
import { BridgeConfig, parseConfig, parseRegistrationFile } from "./Config";
import { GithubWebhooks, IWebhookEvent } from "./GithubWebhooks";
import { CommentProcessor } from "./CommentProcessor";
import { MessageQueue, createMessageQueue, MessageQueueMessage } from "./MessageQueue/MessageQueue";
import { AdminRoom, BRIDGE_ROOM_TYPE } from "./AdminRoom";
import { UserTokenStore } from "./UserTokenStore";
import { FormatUtil } from "./FormatUtil";

const md = new markdown();
// tslint:disable: no-console

const log = winston.createLogger({
    level: "info",
    format: winston.format.simple(),
    transports: [
        new winston.transports.Console(),
    ],
});

LogService.setLogger(log);

export class GithubBridge {
    private config!: BridgeConfig;
    private octokit!: Octokit;
    private as!: Appservice;
    private adminRooms: Map<string, AdminRoom>;
    private roomIdtoBridgeState: Map<string, IBridgeRoomState[]>;
    private orgRepoIssueToRoomId: Map<string, string>;
    private matrixHandledEvents: Set<string>;
    private commentProcessor!: CommentProcessor;
    private queue!: MessageQueue;
    private tokenStore!: UserTokenStore;

    constructor() {
        this.roomIdtoBridgeState = new Map();
        this.orgRepoIssueToRoomId = new Map();
        this.matrixHandledEvents = new Set();
        this.adminRooms = new Map();
    }

    public async start() {
        const configFile = process.argv[2] || "./config.yml";
        const registrationFile = process.argv[3] || "./registration.yml";
        this.adminRooms = new Map();
        this.config = await parseConfig(configFile);

        this.queue = createMessageQueue(this.config);

        const registration = await parseRegistrationFile(registrationFile);
        this.octokit = new Octokit({
            auth: this.config.github.auth,
            userAgent: "matrix-github v0.0.1",
        });

        this.as = new Appservice({
            homeserverName: this.config.bridge.domain,
            homeserverUrl: this.config.bridge.url,
            port: this.config.bridge.port,
            bindAddress: this.config.bridge.bindAddress,
            registration,
        });
        this.commentProcessor = new CommentProcessor(this.as, this.config.bridge.mediaUrl);

        this.tokenStore = new UserTokenStore(this.config.github.passFile || "./passkey.pem", this.as.botIntent);
        await this.tokenStore.load();

        this.as.on("query.room", (roomAlias, cb) => {
            cb(this.onQueryRoom(roomAlias));
        });

        this.as.on("room.event", async (roomId, event) => {
            return this.onRoomEvent(roomId, event);
        });

        if (this.config.github.webhook && this.config.queue.monolithic) {
            const webhookHandler = new GithubWebhooks(this.config);
            webhookHandler.listen();
        }

        this.queue.subscribe("comment.*");

        this.queue.on("comment.created", async (msg: MessageQueueMessage) => {
            return this.onCommentCreated(msg.data);
        });

        this.queue.on("issue.edited", async (msg: MessageQueueMessage) => {
            return this.onIssueEdited(msg.data);
        });

        this.queue.on("issue.closed", async (msg: MessageQueueMessage) => {
            return this.onIssueStateChange(msg.data);
        });

        this.queue.on("issue.reopened", async (msg: MessageQueueMessage) => {
            return this.onIssueStateChange(msg.data);
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
                    this.adminRooms.set(roomId, new AdminRoom(
                        roomId, accountData.admin_user, this.as.botIntent, this.tokenStore,
                    ));
                }
                continue;
            } catch (ex) { /* this is an old style room */ }
            await this.getRoomBridgeState(roomId);
        }

        await this.as.begin();
        log.info("Started bridge");
    }

    private async getRoomBridgeState(roomId: string, existingState?: any) {
        if (this.roomIdtoBridgeState.has(roomId) && !existingState) {
            return this.roomIdtoBridgeState.get(roomId)!;
        }
        try {
            log.info("Updating state cache for " + roomId);
            const state = existingState ? [existingState] : (
                await this.as.botIntent.underlyingClient.getRoomState(roomId)
            );
            const bridgeEvents: IBridgeRoomState[] = state.filter((e: any) =>
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

    private async onRoomEvent(roomId: string, event: any) {
        const isOurUser = this.as.isNamespacedUser(event.sender);
        // if (isOurUser) {
        //     log.debug("Not handling our own events.");
        //     // We don't handle any IRC side stuff yet.
        //     return;
        // }

        if (event.type === "m.room.member" && !isOurUser && event.content.membership === "invite") {
            await this.as.botIntent.joinRoom(roomId);
            const members = await this.as.botIntent.underlyingClient.getJoinedRoomMembers(roomId);
            if (members.filter((userId) => ![this.as.botUserId, event.sender].includes(userId)).length !== 0) {
                await this.as.botIntent.sendText(
                    roomId,
                    "This bridge currently only supports invites to 1:1 rooms",
                    "m.notice",
                );
                await this.as.botIntent.underlyingClient.leaveRoom(roomId);
                return;
            }
            await this.as.botIntent.underlyingClient.setRoomAccountData(
                BRIDGE_ROOM_TYPE, roomId, {admin_user: event.sender, type: "admin"},
            );
            this.adminRooms.set(roomId, new AdminRoom(roomId, event.sender, this.as.botIntent, this.tokenStore));
        }

        if (event.type === "m.room.message" && this.adminRooms.has(roomId)) {
            const room = this.adminRooms.get(roomId)!;
            if (room.userId !== event.sender) {
                return;
            }
            const command = event.content.body;
            if (!command) {
                return;
            }
            await this.adminRooms.get(roomId)!.handleCommand(command);
            return;
        }

        if (event.type === BRIDGE_STATE_TYPE) {
            log.info(`Got new state for ${roomId}`);
            await this.getRoomBridgeState(roomId, event);
            // Get current state of issue.
            await this.syncIssueState(roomId, event);
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
        // Get a client for the IRC user.
        const githubRepo = bridgeState[0].content;
        log.info(`Got new request for ${githubRepo.org}${githubRepo.repo}#${githubRepo.issues.join("|")}`);
        if (!isOurUser) {
            if (event.content.body === "!sync") {
                await this.syncIssueState(roomId, bridgeState[0]);
            }
            if (event.type === "m.room.message") {
                await this.onMatrixIssueComment(event, bridgeState[0]);
            }
        }
        console.log(event);
    }

    private async getIntentForUser(user: IssuesGetResponseUser) {
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
        console.log("Syncing issue state for", roomId);
        const issue = await this.octokit.issues.get({
            owner: repoState.content.org,
            repo: repoState.content.repo,
            issue_number: parseInt(repoState.content.issues[0], 10),
        });
        const creatorIntent = await this.getIntentForUser(issue.data.user);

        if (repoState.content.comments_processed === -1) {
            // We've not sent any messages into the room yet, let's do it!
            await creatorIntent.sendEvent(roomId, {
                msgtype: "m.notice",
                body: `created ${issue.data.pull_request ? "a pull request" : "an issue"} at ${issue.data.created_at}`,
            });
            if (issue.data.body) {
                await creatorIntent.sendEvent(roomId, {
                    msgtype: "m.text",
                    external_url: issue.data.html_url,
                    body: `${issue.data.body} (${issue.data.updated_at})`,
                    format: "org.matrix.custom.html",
                    formatted_body: md.render(issue.data.body),
                });
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
                const closedIntent = await this.getIntentForUser(issue.data.closed_by);
                await closedIntent.sendEvent(roomId, {
                    msgtype: "m.notice",
                    body: `closed the ${issue.data.pull_request ? "pull request" : "issue"} at ${issue.data.closed_at}`,
                    external_url: issue.data.closed_by.html_url,
                });
            }

            await this.as.botIntent.underlyingClient.sendStateEvent(roomId, "m.room.topic", "", {
                topic: FormatUtil.formatTopic(issue.data),
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
        const issueNumber = parseInt(parts[2], 10);

        const issue = await this.octokit.issues.get({
            owner: parts[0],
            repo: parts[1],
            issue_number: issueNumber,
        });

        if (issue.status !== 200) {
            throw Error("Could not find issue");
        }

        const orgRepoName = issue.data.repository_url.substr("https://api.github.com/repos/".length);

        return {
            visibility: "public",
            name: FormatUtil.formatName(issue.data),
            topic: FormatUtil.formatTopic(issue.data),
            preset: "public_chat",
            initial_state: [
                {
                    type: BRIDGE_STATE_TYPE,
                    content: {
                        org: orgRepoName.split("/")[0],
                        repo: orgRepoName.split("/")[1],
                        issues: [String(issue.data.number)],
                        comments_processed: -1,
                        state: "open",
                    },
                    state_key: issue.data.url,
                } as IBridgeRoomState,
            ],
        };
    }

    private async onCommentCreated(event: IWebhookEvent, roomId?: string, updateState: boolean = true) {
        if (!roomId) {
            const issueKey = `${event.repository!.owner.login}/${event.repository!.name}#${event.issue!.number}`;
            roomId = this.orgRepoIssueToRoomId.get(issueKey);
            if (!roomId) {
                console.log("No room id for repo");
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
        const matrixEvent = await this.commentProcessor.getEventBodyForComment(comment);
        await commentIntent.sendEvent(roomId, matrixEvent);
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
            console.log("No changes given");
            return; // No changes made.
        }

        const issueKey = `${event.repository!.owner.login}/${event.repository!.name}#${event.issue!.number}`;
        const roomId = this.orgRepoIssueToRoomId.get(issueKey)!;
        const roomState = await this.getRoomBridgeState(roomId, event);

        if (!roomId || !roomState) {
            console.log("No tracked room state");
            return;
        }

        if (event.changes.title) {
            await this.as.botIntent.underlyingClient.sendStateEvent(roomId, "m.room.name", "", {
                name: FormatUtil.formatName(event.issue!),
            });
        }
    }

    private async onIssueStateChange(event: IWebhookEvent) {
        const issueKey = `${event.repository!.owner.login}/${event.repository!.name}#${event.issue!.number}`;
        const roomId = this.orgRepoIssueToRoomId.get(issueKey)!;
        const roomState = await this.getRoomBridgeState(roomId);

        if (!roomId || !roomState || roomState.length === 0) {
            console.log("No tracked room state");
            return;
        }

        console.log(roomState);

        await this.syncIssueState(roomId, roomState[0]);
    }

    private async onMatrixIssueComment(event: any, bridgeState: IBridgeRoomState) {
        // TODO: Someone who is not lazy should make this work with oauth.
        const senderToken = await this.tokenStore.getUserToken(event.sender);
        if (senderToken === null) {
            // TODO: Bridge via bot.
            log.warn(`Cannot handle event from ${event.sender}. No user token configured`);
            return;
        }
        const clientKit = new Octokit({
            auth: senderToken,
            userAgent: "matrix-github v0.0.1",
        });

        const result = await clientKit.issues.createComment({
            repo: bridgeState.content.repo,
            owner: bridgeState.content.org,
            body: await this.commentProcessor.getCommentBodyForEvent(event.content),
            issue_number: parseInt(bridgeState.content.issues[0], 10),
        });
        const key =
        `${bridgeState.content.org}/${bridgeState.content.repo}#${bridgeState.content.issues[0]}~${result.data.id}`
        .toLowerCase();
        this.matrixHandledEvents.add(key);
    }
}

new GithubBridge().start().catch((ex) => {
    console.error("GithubBridge encountered an error and has stopped:", ex);
});
