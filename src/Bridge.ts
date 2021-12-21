import { AdminAccountData } from "./AdminRoomCommandHandler";
import { AdminRoom, BRIDGE_ROOM_TYPE, LEGACY_BRIDGE_ROOM_TYPE } from "./AdminRoom";
import { Appservice, IAppserviceRegistration, RichRepliesPreprocessor, IRichReplyMetadata, StateEvent, PantalaimonClient, MatrixClient, IAppserviceStorageProvider, EventKind } from "matrix-bot-sdk";
import { BridgeConfig, GitLabInstance } from "./Config/Config";
import { BridgeWidgetApi } from "./Widgets/BridgeWidgetApi";
import { CommentProcessor } from "./CommentProcessor";
import { ConnectionManager } from "./ConnectionManager";
import { GenericHookConnection } from "./Connections";
import { GetIssueResponse, GetIssueOpts } from "./Gitlab/Types"
import { GithubInstance } from "./Github/GithubInstance";
import { IBridgeStorageProvider } from "./Stores/StorageProvider";
import { IConnection, GitHubDiscussionSpace, GitHubDiscussionConnection, GitHubUserSpace, JiraProjectConnection, GitLabRepoConnection,
    GitHubIssueConnection, GitHubProjectConnection, GitHubRepoConnection, GitLabIssueConnection } from "./Connections";
import { IGitLabWebhookIssueStateEvent, IGitLabWebhookMREvent, IGitLabWebhookNoteEvent, IGitLabWebhookTagPushEvent } from "./Gitlab/WebhookTypes";
import { JiraIssueEvent, JiraIssueUpdatedEvent } from "./Jira/WebhookTypes";
import { JiraOAuthResult } from "./Jira/Types";
import { MatrixEvent, MatrixMemberContent, MatrixMessageContent } from "./MatrixEvent";
import { MemoryStorageProvider } from "./Stores/MemoryStorageProvider";
import { MessageQueue, createMessageQueue } from "./MessageQueue";
import { MessageSenderClient } from "./MatrixSender";
import { NotifFilter, NotificationFilterStateContent } from "./NotificationFilters";
import { NotificationProcessor } from "./NotificationsProcessor";
import { NotificationsEnableEvent, NotificationsDisableEvent, GenericWebhookEvent } from "./Webhooks";
import { GitHubOAuthToken, GitHubOAuthTokenResponse, ProjectsGetResponseData } from "./Github/Types";
import { RedisStorageProvider } from "./Stores/RedisStorageProvider";
import { retry } from "./PromiseUtil";
import { UserNotificationsEvent } from "./Notifications/UserNotificationWatcher";
import { UserTokenStore } from "./UserTokenStore";
import * as GitHubWebhookTypes from "@octokit/webhooks-types";
import LogWrapper from "./LogWrapper";
import { Provisioner } from "./provisioning/provisioner";
import { JiraProvisionerRouter } from "./Jira/Router";
import { GitHubProvisionerRouter } from "./Github/Router";
import { OAuthRequest } from "./WebhookTypes";
import { promises as fs } from "fs";
import { SetupConnection } from "./Connections/SetupConnection";
import Metrics from "./Metrics";
import { ListenerService } from "./ListenerService";
const log = new LogWrapper("Bridge");

export function getAppservice(config: BridgeConfig, registration: IAppserviceRegistration, storage: IAppserviceStorageProvider) {
    return new Appservice({
        homeserverName: config.bridge.domain,
        homeserverUrl: config.bridge.url,
        port: config.bridge.port,
        bindAddress: config.bridge.bindAddress,
        registration: {
            ...registration,
            namespaces: {
                // Support multiple users
                users: [{
                    regex: '(' + registration.namespaces.users.map((r) => r.regex).join(')|(') + ')',
                    exclusive: true,
                }],
                aliases: registration.namespaces.aliases,
                rooms: registration.namespaces.rooms,
            }
        },
        storage: storage,
    });
}

export class Bridge {
    private readonly as: Appservice;
    private readonly storage: IBridgeStorageProvider;
    private readonly messageClient: MessageSenderClient;
    private readonly queue: MessageQueue;
    private readonly commentProcessor: CommentProcessor;
    private readonly notifProcessor: NotificationProcessor;
    private readonly tokenStore: UserTokenStore;
    private connectionManager?: ConnectionManager;
    private github?: GithubInstance;
    private encryptedMatrixClient?: MatrixClient;
    private adminRooms: Map<string, AdminRoom> = new Map();
    private widgetApi: BridgeWidgetApi = new BridgeWidgetApi(this.adminRooms);
    private provisioningApi?: Provisioner;
    private replyProcessor = new RichRepliesPreprocessor(true);

    private ready = false;

    constructor(private config: BridgeConfig, private registration: IAppserviceRegistration, private readonly listener: ListenerService) {
        if (this.config.queue.host && this.config.queue.port) {
            log.info(`Initialising Redis storage (on ${this.config.queue.host}:${this.config.queue.port})`);
            this.storage = new RedisStorageProvider(this.config.queue.host, this.config.queue.port);
        } else {
            log.info('Initialising memory storage');
            this.storage = new MemoryStorageProvider();
        }
        this.as = getAppservice(this.config, this.registration, this.storage);
        this.queue = createMessageQueue(this.config);
        this.messageClient = new MessageSenderClient(this.queue);
        this.commentProcessor = new CommentProcessor(this.as, this.config.bridge.mediaUrl || this.config.bridge.url);
        this.notifProcessor = new NotificationProcessor(this.storage, this.messageClient);
        this.tokenStore = new UserTokenStore(this.config.passFile || "./passkey.pem", this.as.botIntent, this.config);
    }

    public stop() {
        this.as.stop();
        if (this.queue.stop) this.queue.stop();
    }

    public async start() {
        log.info('Starting up');

        if (!this.config.github && !this.config.gitlab && !this.config.jira) {
            log.error("You haven't configured support for GitHub or GitLab!");
            throw Error('Bridge cannot start -- no connectors are configured');
        }

        if (this.config.github) {
            this.github = new GithubInstance(this.config.github.auth.id, await fs.readFile(this.config.github.auth.privateKeyFile, 'utf-8'));
            await this.github.start();
        }

        this.as.expressAppInstance.get("/live", (_, res) => res.send({ok: true}));
        this.as.expressAppInstance.get("/ready", (_, res) => res.status(this.ready ? 200 : 500).send({ready: this.ready}));

        if (this.config.bridge.pantalaimon) {
            log.info(`Loading pantalaimon client`);
            const pan = new PantalaimonClient(
                this.config.bridge.pantalaimon.url,
                this.storage,
            );
            this.encryptedMatrixClient = await pan.createClientWithCredentials(
                this.config.bridge.pantalaimon.username,
                this.config.bridge.pantalaimon.password
            );
            this.encryptedMatrixClient.on("room.message", async (roomId, event) => {
                return this.onRoomMessage(roomId, event);
            });
            // TODO: Filter
            await this.encryptedMatrixClient.start();
            log.info(`Pan client is syncing`);
        }


        await this.tokenStore.load();
        const connManager = this.connectionManager = new ConnectionManager(this.as,
            this.config, this.tokenStore, this.commentProcessor, this.messageClient, this.github);
    
        if (this.config.provisioning) {
            const routers = [];
            if (this.config.jira) {
                routers.push({
                    route: "/v1/jira",
                    router: new JiraProvisionerRouter(this.config.jira, this.tokenStore).getRouter(),
                });
                this.connectionManager.registerProvisioningConnection(JiraProjectConnection);
            }
            if (this.config.github && this.github) {
                routers.push({
                    route: "/v1/github",
                    router: new GitHubProvisionerRouter(this.config.github, this.tokenStore, this.github).getRouter(),
                });
                this.connectionManager.registerProvisioningConnection(GitHubRepoConnection);
            }
            if (this.config.generic) {
                this.connectionManager.registerProvisioningConnection(GenericHookConnection);
            }
            this.provisioningApi = new Provisioner(this.config.provisioning, this.connectionManager, this.as.botIntent, routers);
        }

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
            Metrics.matrixAppserviceEvents.inc();
            return this.onRoomEvent(roomId, event);
        });

        this.as.on("room.join", async (roomId, event) => {
            return this.onRoomJoin(roomId, event);
        });

        this.queue.subscribe("response.matrix.message");
        this.queue.subscribe("notifications.user.events");
        this.queue.subscribe("github.*");
        this.queue.subscribe("gitlab.*");
        this.queue.subscribe("jira.*");

        const validateRepoIssue = (data: GitHubWebhookTypes.IssuesEvent|GitHubWebhookTypes.IssueCommentEvent) => {
            if (!data.repository || !data.issue) {
                throw Error("Malformed webhook event, missing repository or issue");
            }
            if (!data.repository.owner?.login) {
                throw Error('Cannot get connection for ownerless issue');
            }
            return {
                owner: data.repository.owner?.login,
                repository: data.repository,
                issue: data.issue,
            };
        }


        this.queue.on<GitHubWebhookTypes.InstallationCreatedEvent>("github.installation.created", async (data) => {
            this.github?.onInstallationCreated(data.data);
        });
        this.queue.on<GitHubWebhookTypes.InstallationUnsuspendEvent>("github.installation.unsuspend", async (data) => {
            this.github?.onInstallationCreated(data.data);
        });
        this.queue.on<GitHubWebhookTypes.InstallationDeletedEvent>("github.installation.deleted", async (data) => {
            this.github?.onInstallationRemoved(data.data);
        });
        this.queue.on<GitHubWebhookTypes.InstallationSuspendEvent>("github.installation.suspend", async (data) => {
            this.github?.onInstallationRemoved(data.data);
        });

        this.bindHandlerToQueue<GitHubWebhookTypes.IssueCommentCreatedEvent, GitHubIssueConnection>(
            "github.issue_comment.created",
            (data) => {
                const { repository, issue, owner } = validateRepoIssue(data);
                return connManager.getConnectionsForGithubIssue(owner, repository.name, issue.number).filter(c => c instanceof GitHubIssueConnection) as GitHubIssueConnection[];
            },
            (c, data) => c.onIssueCommentCreated(data),
        );

        this.bindHandlerToQueue<GitHubWebhookTypes.IssuesOpenedEvent, GitHubRepoConnection>(
            "github.issues.opened",
            (data) => {
                const { repository, owner } = validateRepoIssue(data);
                return connManager.getConnectionsForGithubRepo(owner, repository.name);
            },
            (c, data) => c.onIssueCreated(data),
        );

        this.bindHandlerToQueue<GitHubWebhookTypes.IssuesEditedEvent, GitHubIssueConnection|GitHubRepoConnection>(
            "github.issues.edited",
            (data) => {
                const { repository, issue, owner } = validateRepoIssue(data);
                return connManager.getConnectionsForGithubIssue(owner, repository.name, issue.number);
            },
            (c, data) => c.onIssueEdited(data),
        );

        this.bindHandlerToQueue<GitHubWebhookTypes.IssuesClosedEvent, GitHubIssueConnection|GitHubRepoConnection>(
            "github.issues.closed",
            (data) => {
                const { repository, issue, owner } = validateRepoIssue(data);
                return connManager.getConnectionsForGithubIssue(owner, repository.name, issue.number);
            },
            (c, data) => c.onIssueStateChange(data),
        );

        this.bindHandlerToQueue<GitHubWebhookTypes.IssuesReopenedEvent, GitHubIssueConnection|GitHubRepoConnection>(
            "github.issues.reopened",
            (data) => {
                const { repository, issue, owner } = validateRepoIssue(data);
                return connManager.getConnectionsForGithubIssue(owner, repository.name, issue.number);
            },
            (c, data) => c.onIssueStateChange(data),
        );

        this.bindHandlerToQueue<GitHubWebhookTypes.IssuesEditedEvent, GitHubRepoConnection>(
            "github.issues.edited",
            (data) => connManager.getConnectionsForGithubRepo(data.repository.owner.login, data.repository.name), 
            (c, data) => c.onIssueEdited(data),
        );

        this.bindHandlerToQueue<GitHubWebhookTypes.PullRequestOpenedEvent, GitHubRepoConnection>(
            "github.pull_request.opened",
            (data) => connManager.getConnectionsForGithubRepo(data.repository.owner.login, data.repository.name), 
            (c, data) => c.onPROpened(data),
        );

        this.bindHandlerToQueue<GitHubWebhookTypes.PullRequestClosedEvent, GitHubRepoConnection>(
            "github.pull_request.closed",
            (data) => connManager.getConnectionsForGithubRepo(data.repository.owner.login, data.repository.name), 
            (c, data) => c.onPRClosed(data),
        );

        this.bindHandlerToQueue<GitHubWebhookTypes.PullRequestReadyForReviewEvent, GitHubRepoConnection>(
            "github.pull_request_review.ready_for_review",
            (data) => connManager.getConnectionsForGithubRepo(data.repository.owner.login, data.repository.name), 
            (c, data) => c.onPRReadyForReview(data),
        );

        this.bindHandlerToQueue<GitHubWebhookTypes.PullRequestReviewSubmittedEvent, GitHubRepoConnection>(
            "github.pull_request_review.submitted",
            (data) => connManager.getConnectionsForGithubRepo(data.repository.owner.login, data.repository.name), 
            (c, data) => c.onPRReviewed(data),
        );

        this.bindHandlerToQueue<GitHubWebhookTypes.ReleaseCreatedEvent, GitHubRepoConnection>(
            "github.release.created",
            (data) => connManager.getConnectionsForGithubRepo(data.repository.owner.login, data.repository.name), 
            (c, data) => c.onReleaseCreated(data),
        );

        this.bindHandlerToQueue<IGitLabWebhookMREvent, GitLabRepoConnection>(
            "gitlab.merge_request.open",
            (data) => connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace), 
            (c, data) => c.onMergeRequestOpened(data),
        );

        this.bindHandlerToQueue<IGitLabWebhookMREvent, GitLabRepoConnection>(
            "gitlab.merge_request.merge",
            (data) => connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace), 
            (c, data) => c.onMergeRequestMerged(data),
        );

        this.bindHandlerToQueue<IGitLabWebhookMREvent, GitLabRepoConnection>(
            "gitlab.merge_request.approved",
            (data) => connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace), 
            (c, data) => c.onMergeRequestReviewed(data),
        );

        this.bindHandlerToQueue<IGitLabWebhookMREvent, GitLabRepoConnection>(
            "gitlab.merge_request.unapproved",
            (data) => connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace), 
            (c, data) => c.onMergeRequestReviewed(data),
        );

        this.bindHandlerToQueue<IGitLabWebhookTagPushEvent, GitLabRepoConnection>(
            "gitlab.tag_push",
            (data) => connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace), 
            (c, data) => c.onGitLabTagPush(data),
        );

        this.queue.on<UserNotificationsEvent>("notifications.user.events", async (msg) => {
            const adminRoom = this.adminRooms.get(msg.data.roomId);
            if (!adminRoom) {
                log.warn("No admin room for this notif stream!");
                return;
            }
            await this.notifProcessor.onUserEvents(msg.data, adminRoom);
        });

        this.queue.on<OAuthRequest>("github.oauth.response", async (msg) => {
            const userId = this.tokenStore.getUserIdForOAuthState(msg.data.state, false);
            await this.queue.push<boolean>({
                data: !!userId,
                sender: "Bridge",
                messageId: msg.messageId,
                eventName: "response.github.oauth.response",
            });
        });

        this.queue.on<GitHubOAuthTokenResponse>("github.oauth.tokens", async (msg) => {
            const userId = this.tokenStore.getUserIdForOAuthState(msg.data.state);
            if (!userId) {
                log.warn("Could not find internal state for successful tokens request. This shouldn't happen!");
                return;
            }
            await this.tokenStore.storeUserToken("github", userId, JSON.stringify({
                access_token: msg.data.access_token,
                expires_in: msg.data.expires_in && ((parseInt(msg.data.expires_in) * 1000) + Date.now()),
                token_type: msg.data.token_type,
                refresh_token: msg.data.refresh_token,
                refresh_token_expires_in: msg.data.refresh_token_expires_in && ((parseInt(msg.data.refresh_token_expires_in) * 1000)  + Date.now()),
            } as GitHubOAuthToken));
        });

        this.bindHandlerToQueue<IGitLabWebhookNoteEvent, GitLabIssueConnection>(
            "gitlab.note.created",
            (data) => connManager.getConnectionsForGitLabIssueWebhook(data.repository.homepage, data.issue.iid), 
            (c, data) => c.onCommentCreated(data),
        );

        this.bindHandlerToQueue<IGitLabWebhookIssueStateEvent, GitLabIssueConnection>(
            "gitlab.issue.reopen",
            (data) => connManager.getConnectionsForGitLabIssueWebhook(data.repository.homepage, data.object_attributes.iid), 
            (c) => c.onIssueReopened(),
        );

        this.bindHandlerToQueue<IGitLabWebhookIssueStateEvent, GitLabIssueConnection>(
            "gitlab.issue.close",
            (data) => connManager.getConnectionsForGitLabIssueWebhook(data.repository.homepage, data.object_attributes.iid), 
            (c) => c.onIssueClosed(),
        );

        this.bindHandlerToQueue<GitHubWebhookTypes.DiscussionCommentCreatedEvent, GitHubDiscussionConnection>(
            "github.discussion_comment.created",
            (data) => connManager.getConnectionsForGithubDiscussion(data.repository.owner.login, data.repository.name, data.discussion.number), 
            (c, data) => c.onDiscussionCommentCreated(data),
        );

        this.queue.on<GitHubWebhookTypes.DiscussionCreatedEvent>("github.discussion.created", async ({data}) => {
            if (!this.github) {
                return;
            }
            const spaces = connManager.getConnectionsForGithubRepoDiscussion(data.repository.owner.login, data.repository.name);
            if (spaces.length === 0) {
                log.info(`Not creating discussion ${data.discussion.id} ${data.repository.owner.login}/${data.repository.name}, no target spaces`);
                // We don't want to create any discussions if we have no target spaces.
                return;
            }
            let [discussionConnection] = connManager.getConnectionsForGithubDiscussion(data.repository.owner.login, data.repository.name, data.discussion.id);
            if (!discussionConnection) {
                try {
                    // If we don't have an existing connection for this discussion (likely), then create one.
                    discussionConnection = await GitHubDiscussionConnection.createDiscussionRoom(
                        this.as,
                        null,
                        data.repository.owner.login,
                        data.repository.name,
                        data.discussion,
                        this.tokenStore,
                        this.commentProcessor,
                        this.messageClient,
                    );
                    connManager.push(discussionConnection);
                } catch (ex) {
                    log.error(ex);
                    throw Error('Failed to create discussion room');
                }
            }

            spaces.map(async (c) => {
                try {
                    await c.onDiscussionCreated(discussionConnection);
                } catch (ex) {
                    log.warn(`Failed to add discussion ${c.toString()} failed to handle comment.created:`, ex);
                }
            })
        });
    
        this.bindHandlerToQueue<JiraIssueEvent, JiraProjectConnection>(
            "jira.issue_created",
            (data) => connManager.getConnectionsForJiraProject(data.issue.fields.project, "jira.issue_created"), 
            (c, data) => c.onJiraIssueCreated(data),
        );

        this.bindHandlerToQueue<JiraIssueUpdatedEvent, JiraProjectConnection>(
            "jira.issue_updated",
            (data) => connManager.getConnectionsForJiraProject(data.issue.fields.project, "jira.issue_updated"), 
            (c, data) => c.onJiraIssueUpdated(data),
        );
    
        this.queue.on<OAuthRequest>("jira.oauth.response", async (msg) => {
            const userId = this.tokenStore.getUserIdForOAuthState(msg.data.state, false);
            await this.queue.push<boolean>({
                data: !!(userId),
                sender: "Bridge",
                messageId: msg.messageId,
                eventName: "response.jira.oauth.response",
            });
        });

        this.queue.on<JiraOAuthResult>("jira.oauth.tokens", async ({data}) => {
            if (!data.state) {
                log.warn("Missing `state` on `jira.oauth.tokens` event. This shouldn't happen!");
                return;
            }
            const userId = this.tokenStore.getUserIdForOAuthState(data.state);
            if (!userId) {
                log.warn("Could not find internal state for successful tokens request. This shouldn't happen!");
                return;
            }
            await this.tokenStore.storeUserToken("jira", userId, JSON.stringify(data));

            // Some users won't have an admin room and would have gone through provisioning.
            const adminRoom = this.adminRooms.get(userId);
            if (adminRoom) {
                await adminRoom.sendNotice(`Logged into Jira`);
            }
        });

        this.bindHandlerToQueue<GenericWebhookEvent, GenericHookConnection>(
            "generic-webhook.event",
            (data) => connManager.getConnectionsForGenericWebhook(data.hookId), 
            (c, data) => c.onGenericHook(data.hookData),
        );

        // Fetch all room state
        let joinedRooms: string[]|undefined;
        while(joinedRooms === undefined) {
            try {
                log.info("Connecting to homeserver and fetching joined rooms..");
                joinedRooms = await this.as.botIntent.underlyingClient.getJoinedRooms();
                log.info(`Found ${joinedRooms.length} rooms`);
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
            let profile;
            try {
                profile = await this.as.botClient.getUserProfile(this.as.botUserId);
            } catch {
                profile = {}
            }
            if (this.config.bot.avatar && profile.avatar_url !== this.config.bot.avatar) {
                log.info(`Setting avatar to ${this.config.bot.avatar}`);
                await this.as.botClient.setAvatarUrl(this.config.bot.avatar);
            }
            if (this.config.bot.displayname && profile.displayname !== this.config.bot.displayname) {
                log.info(`Setting displayname to ${this.config.bot.displayname}`);
                await this.as.botClient.setDisplayName(this.config.bot.displayname);
            }
        }

        await Promise.all(joinedRooms.map(async (roomId) => {
            log.debug("Fetching state for " + roomId);
            let connections: IConnection[];
            try {
                connections = await connManager.createConnectionsForRoomId(roomId);
            } catch (ex) {
                log.error(`Unable to create connection for ${roomId}`, ex);
                return;
            }
            if (connections.length) {
                log.info(`Room ${roomId} is connected to: ${connections.join(',')}`);
                connManager.push(...connections);
                return;
            }

            // TODO: Refactor this to be a connection
            try {
                let accountData = await this.as.botIntent.underlyingClient.getSafeRoomAccountData<AdminAccountData>(
                    BRIDGE_ROOM_TYPE, roomId,
                );
                if (!accountData) {
                    accountData = await this.as.botIntent.underlyingClient.getSafeRoomAccountData<AdminAccountData>(
                        LEGACY_BRIDGE_ROOM_TYPE, roomId,
                    );
                    if (!accountData) {
                        log.debug(`Room ${roomId} has no connections and is not an admin room`);
                        return;
                    } else {
                        // Upgrade the room
                        await this.as.botClient.setRoomAccountData(BRIDGE_ROOM_TYPE, roomId, accountData);
                    }
                }

                let notifContent;
                try {
                    notifContent = await this.as.botIntent.underlyingClient.getRoomStateEvent(
                        roomId, NotifFilter.StateType, "",
                    );
                } catch (ex) {
                    try {
                        notifContent = await this.as.botIntent.underlyingClient.getRoomStateEvent(
                            roomId, NotifFilter.LegacyStateType, "",
                        );
                    }
                    catch (ex) {
                        // No state yet
                    }
                }
                const adminRoom = await this.setupAdminRoom(roomId, accountData, notifContent || NotifFilter.getDefaultContent());
                // Call this on startup to set the state
                await this.onAdminRoomSettingsChanged(adminRoom, accountData, { admin_user: accountData.admin_user });
                log.info(`Room ${roomId} is connected to: ${adminRoom.toString()}`);
            } catch (ex) {
                log.error(`Failed to setup admin room ${roomId}:`, ex);
            }
        }));

        // Handle spaces
        for (const discussion of connManager.getAllConnectionsOfType(GitHubDiscussionSpace)) {
            const user = connManager.getConnectionForGithubUser(discussion.owner);
            if (user) {
                await user.ensureDiscussionInSpace(discussion);
            }
        }

        if (this.config.widgets) {
            this.listener.bindResource('widgets', this.widgetApi.expressRouter);
        }
        if (this.provisioningApi) {
            this.listener.bindResource('provisioning', this.provisioningApi.expressRouter);
        }
        if (this.config.metrics?.enabled) {
            this.listener.bindResource('metrics', Metrics.expressRouter);
        }
        await this.as.begin();
        log.info("Started bridge");
        this.ready = true;
    }

    private async bindHandlerToQueue<EventType, ConnType extends IConnection>(event: string, connectionFetcher: (data: EventType) => ConnType[], handler: (c: ConnType, data: EventType) => Promise<unknown>) {
        this.queue.on<EventType>(event, (msg) => {
            const connections = connectionFetcher.bind(this)(msg.data);
            log.debug(`${event} for ${connections.map(c => c.toString()).join(', ') || '[empty]'}`);
            connections.forEach(async (c) => {
                try {
                    await handler(c, msg.data);
                } catch (ex) {
                    log.warn(`Connection ${c.toString()} failed to handle ${event}:`, ex);
                }
            })
        });
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
            const room = await this.setupAdminRoom(roomId, {admin_user: event.sender}, NotifFilter.getDefaultContent());
            await this.as.botIntent.underlyingClient.setRoomAccountData(
                BRIDGE_ROOM_TYPE, roomId, room.accountData,
            );
        }
    }

    private async onRoomMessage(roomId: string, event: MatrixEvent<MatrixMessageContent>) {
        if (!this.connectionManager) {
            // Not ready yet.
            return;
        }
        if (this.as.isNamespacedUser(event.sender)) {
            /* We ignore messages from our users */
            return;
        }
        if (Date.now() - event.origin_server_ts > 30000) {
            /* We ignore old messages too */
            return;
        }
        log.info(`Got message roomId=${roomId} type=${event.type} from=${event.sender}`);
        log.debug("Content:", JSON.stringify(event));
        const processedReply = await this.replyProcessor.processEvent(event, this.as.botClient, EventKind.RoomEvent);
        const processedReplyMetadata: IRichReplyMetadata = processedReply?.mx_richreply;
        const adminRoom = this.adminRooms.get(roomId);

        if (!adminRoom) {
            let handled = false;
            for (const connection of this.connectionManager.getAllConnectionsForRoom(roomId)) {
                try {
                    if (connection.onMessageEvent) {
                        handled = await connection.onMessageEvent(event, processedReplyMetadata);
                    }
                } catch (ex) {
                    log.warn(`Connection ${connection.toString()} failed to handle message:`, ex);
                }
            }
            if (!handled) {
                // Divert to the setup room code if we didn't match any of these
                try {
                    await (
                        new SetupConnection(roomId, this.as, this.tokenStore, this.github, !!this.config.jira, this.config.generic)
                    ).onMessageEvent(event);
                } catch (ex) {
                    log.warn(`Setup connection failed to handle:`, ex);
                }
            }
            return;
        }

        if (adminRoom.userId !== event.sender) {
            return;
        }

        if (processedReply) {
            log.info(`Handling reply to ${processedReplyMetadata.parentEventId} for ${adminRoom.userId}`);
            // This might be a reply to a notification
            try {
                const ev = processedReplyMetadata.realEvent;
                const splitParts: string[] = ev.content["uk.half-shot.matrix-hookshot.github.repo"]?.name.split("/");
                const issueNumber = ev.content["uk.half-shot.matrix-hookshot.github.issue"]?.number;
                if (splitParts && issueNumber) {
                    log.info(`Handling reply for ${splitParts}${issueNumber}`);
                    const connections = this.connectionManager.getConnectionsForGithubIssue(splitParts[0], splitParts[1], issueNumber);
                    await Promise.all(connections.map(async c => {
                        if (c instanceof GitHubIssueConnection) {
                            return c.onMatrixIssueComment(processedReply);
                        }
                    }));
                } else {
                    log.info("Missing parts!:", splitParts, issueNumber);
                }
            } catch (ex) {
                await adminRoom.sendNotice("Failed to handle repy. You may not be authenticated to do that.");
                log.error("Reply event could not be handled:", ex);
            }
            return;
        }

        const command = event.content.body;
        if (command) {
            await adminRoom.handleCommand(event.event_id, command);
        }

    }

    private async onRoomJoin(roomId: string, matrixEvent: MatrixEvent<MatrixMemberContent>) {
        if (this.as.botUserId !== matrixEvent.sender) {
            // Only act on bot joins
            return;
        }
        if (!this.connectionManager) {
            // Not ready yet.
            return;
        }

        // Only fetch rooms we have no connections in yet.
        if (!this.connectionManager.isRoomConnected(roomId)) {
            const connections = await this.connectionManager.createConnectionsForRoomId(roomId);
            this.connectionManager.push(...connections);
        }
    }

    private async onRoomEvent(roomId: string, event: MatrixEvent<Record<string, unknown>>) {
        if (!this.connectionManager) {
            // Not ready yet.
            return;
        }
        if (event.state_key !== undefined) {
            // A state update, hurrah!
            const existingConnections = this.connectionManager.getInterestedForRoomState(roomId, event.type, event.state_key);
            for (const connection of existingConnections) {
                try {
                    if (event.content.disabled === true) {
                        await this.connectionManager.removeConnection(connection.roomId, connection.connectionId);
                    } else if (connection?.onStateUpdate) {
                        connection.onStateUpdate(event);
                    }
                } catch (ex) {
                    log.warn(`Connection ${connection.toString()} failed to handle onStateUpdate:`, ex);
                }
            }
            if (!existingConnections.length) {
                // Is anyone interested in this state?
                const connection = await this.connectionManager.createConnectionForState(roomId, new StateEvent(event));
                if (connection) {
                    log.info(`New connected added to ${roomId}: ${connection.toString()}`);
                    this.connectionManager.push(connection);
                }
            }
            return;
        }

        // We still want to react to our own state events.
        if (event.sender === this.as.botUserId) {
            // It's us
            return;
        }

        for (const connection of this.connectionManager.getAllConnectionsForRoom(roomId)) {
            try {
                if (connection.onEvent) {
                    await connection.onEvent(event);
                }
            } catch (ex) {
                log.warn(`Connection ${connection.toString()} failed to handle onEvent:`, ex);
            }
        }
    }

    private async onQueryRoom(roomAlias: string) {
        log.info("Got room query request:", roomAlias);
        // Determine which type of room it is.
        let res: RegExpExecArray | null;
        res = GitHubIssueConnection.QueryRoomRegex.exec(roomAlias);
        if (res) {
            if (!this.github) {
                throw Error("GitHub is not configured on this bridge");
            }
            try {
                return await GitHubIssueConnection.onQueryRoom(res, {
                    as: this.as,
                    tokenStore: this.tokenStore,
                    messageClient: this.messageClient,
                    commentProcessor: this.commentProcessor,
                    githubInstance: this.github,
                });
            } catch (ex) {
                log.error(`Could not handle alias with GitHubIssueConnection`, ex);
                throw ex;
            }
        }

        res = GitHubDiscussionSpace.QueryRoomRegex.exec(roomAlias);
        if (res) {
            if (!this.github) {
                throw Error("GitHub is not configured on this bridge");
            }
            try {
                return await GitHubDiscussionSpace.onQueryRoom(res, {
                    githubInstance: this.github,
                    as: this.as,
                });
            } catch (ex) {
                log.error(`Could not handle alias with GitHubRepoConnection`, ex);
                throw ex;
            }
        }

        res = GitHubRepoConnection.QueryRoomRegex.exec(roomAlias);
        if (res) {
            if (!this.github) {
                throw Error("GitHub is not configured on this bridge");
            }
            try {
                return await GitHubRepoConnection.onQueryRoom(res, {
                    as: this.as,
                    tokenStore: this.tokenStore,
                    messageClient: this.messageClient,
                    commentProcessor: this.commentProcessor,
                    githubInstance: this.github,
                });
            } catch (ex) {
                log.error(`Could not handle alias with GitHubRepoConnection`, ex);
                throw ex;
            }
        }

        res = GitHubUserSpace.QueryRoomRegex.exec(roomAlias);
        if (res) {
            if (!this.github) {
                throw Error("GitHub is not configured on this bridge");
            }
            try {
                return await GitHubUserSpace.onQueryRoom(res, {
                    githubInstance: this.github,
                    as: this.as,
                });
            } catch (ex) {
                log.error(`Could not handle alias with GitHubRepoConnection`, ex);
                throw ex;
            }
        }

        throw Error('No regex matching query pattern');
    }

    private async onAdminRoomSettingsChanged(adminRoom: AdminRoom, settings: AdminAccountData, oldSettings: AdminAccountData) {
        log.debug(`Settings changed for ${adminRoom.userId}`, settings);
        // Make this more efficent.
        if (!oldSettings.github?.notifications?.enabled && settings.github?.notifications?.enabled) {
            log.info(`Notifications enabled for ${adminRoom.userId}`);
            const token = await this.tokenStore.getUserToken("github", adminRoom.userId);
            if (token) {
                log.info(`Notifications enabled for ${adminRoom.userId} and token was found`);
                await this.queue.push<NotificationsEnableEvent>({
                    eventName: "notifications.user.enable",
                    sender: "Bridge",
                    data: {
                        userId: adminRoom.userId,
                        roomId: adminRoom.roomId,
                        token,
                        since: await adminRoom.getNotifSince("github"),
                        filterParticipating: adminRoom.notificationsParticipating("github"),
                        type: "github",
                        instanceUrl: undefined,
                    },
                });
            } else {
                log.warn(`Notifications enabled for ${adminRoom.userId} but no token stored!`);
            }
        } else if (oldSettings.github?.notifications?.enabled && !settings.github?.notifications?.enabled) {
            await this.queue.push<NotificationsDisableEvent>({
                eventName: "notifications.user.disable",
                sender: "Bridge",
                data: {
                    userId: adminRoom.userId,
                    type: "github",
                    instanceUrl: undefined,
                },
            });
        }

        for (const [instanceName, instanceSettings] of Object.entries(settings.gitlab || {})) {
            const instanceUrl = this.config.gitlab?.instances[instanceName].url;
            const token = await this.tokenStore.getUserToken("gitlab", adminRoom.userId, instanceUrl);
            if (token && instanceSettings.notifications.enabled) {
                log.info(`GitLab ${instanceName} notifications enabled for ${adminRoom.userId}`);
                await this.queue.push<NotificationsEnableEvent>({
                    eventName: "notifications.user.enable",
                    sender: "Bridge",
                    data: {
                        userId: adminRoom.userId,
                        roomId: adminRoom.roomId,
                        token,
                        since: await adminRoom.getNotifSince("gitlab", instanceName),
                        filterParticipating: adminRoom.notificationsParticipating("gitlab"),
                        type: "gitlab",
                        instanceUrl,
                    },
                });
            } else if (!instanceSettings.notifications.enabled) {
                log.info(`GitLab ${instanceName} notifications disabled for ${adminRoom.userId}`);
                await this.queue.push<NotificationsDisableEvent>({
                    eventName: "notifications.user.disable",
                    sender: "Bridge",
                    data: {
                        userId: adminRoom.userId,
                        type: "gitlab",
                        instanceUrl,
                    },
                });
            }
        }
        
    }

    private async setupAdminRoom(roomId: string, accountData: AdminAccountData, notifContent: NotificationFilterStateContent) {
        const adminRoom = new AdminRoom(
            roomId, accountData, notifContent, this.as.botIntent, this.tokenStore, this.config,
        );
        adminRoom.on("settings.changed", this.onAdminRoomSettingsChanged.bind(this));
        adminRoom.on("open.project", async (project: ProjectsGetResponseData) => {
            const [connection] = this.connectionManager?.getForGitHubProject(project.id) || [];
            if (!connection) {
                const connection = await GitHubProjectConnection.onOpenProject(project, this.as, adminRoom.userId);
                this.connectionManager?.push(connection);
            } else {
                await this.as.botClient.inviteUser(adminRoom.userId, connection.roomId);
            }
        });
        adminRoom.on("open.gitlab-issue", async (issueInfo: GetIssueOpts, res: GetIssueResponse, instanceName: string, instance: GitLabInstance) => {
            const [ connection ] = this.connectionManager?.getConnectionsForGitLabIssue(instance, issueInfo.projects, issueInfo.issue) || [];
            if (connection) {
                return this.as.botClient.inviteUser(adminRoom.userId, connection.roomId);
            } 
            const newConnection = await GitLabIssueConnection.createRoomForIssue(
                instanceName,
                instance,
                res,
                issueInfo.projects,
                this.as,
                this.tokenStore, 
                this.commentProcessor,
                this.messageClient
            );
            this.connectionManager?.push(newConnection);
            return this.as.botClient.inviteUser(adminRoom.userId, newConnection.roomId);
        });
        this.adminRooms.set(roomId, adminRoom);
        if (this.config.widgets?.addToAdminRooms && this.config.widgets.publicUrl) {
            await adminRoom.setupWidget();
        }
        log.info(`Setup ${roomId} as an admin room for ${adminRoom.userId}`);
        return adminRoom;
    }
}
