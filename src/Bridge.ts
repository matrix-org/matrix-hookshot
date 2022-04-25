import { AdminAccountData } from "./AdminRoomCommandHandler";
import { AdminRoom, BRIDGE_ROOM_TYPE, LEGACY_BRIDGE_ROOM_TYPE } from "./AdminRoom";
import { Appservice, IAppserviceRegistration, RichRepliesPreprocessor, IRichReplyMetadata, StateEvent, PantalaimonClient, MatrixClient, EventKind, PowerLevelsEvent } from "matrix-bot-sdk";
import { BridgeConfig, BridgePermissionLevel, GitLabInstance } from "./Config/Config";
import { BridgeWidgetApi } from "./Widgets/BridgeWidgetApi";
import { CommentProcessor } from "./CommentProcessor";
import { ConnectionManager } from "./ConnectionManager";
import { GenericHookConnection } from "./Connections";
import { GetIssueResponse, GetIssueOpts } from "./Gitlab/Types"
import { GithubInstance } from "./Github/GithubInstance";
import { IBridgeStorageProvider } from "./Stores/StorageProvider";
import { IConnection, GitHubDiscussionSpace, GitHubDiscussionConnection, GitHubUserSpace, JiraProjectConnection, GitLabRepoConnection,
    GitHubIssueConnection, GitHubProjectConnection, GitHubRepoConnection, GitLabIssueConnection, FigmaFileConnection, FeedConnection } from "./Connections";
import { IGitLabWebhookIssueStateEvent, IGitLabWebhookMREvent, IGitLabWebhookNoteEvent, IGitLabWebhookPushEvent, IGitLabWebhookReleaseEvent, IGitLabWebhookTagPushEvent, IGitLabWebhookWikiPageEvent } from "./Gitlab/WebhookTypes";
import { JiraIssueEvent, JiraIssueUpdatedEvent } from "./Jira/WebhookTypes";
import { JiraOAuthResult } from "./Jira/Types";
import { MatrixEvent, MatrixMemberContent, MatrixMessageContent } from "./MatrixEvent";
import { MemoryStorageProvider } from "./Stores/MemoryStorageProvider";
import { MessageQueue, createMessageQueue } from "./MessageQueue";
import { MessageSenderClient } from "./MatrixSender";
import { NotifFilter, NotificationFilterStateContent } from "./NotificationFilters";
import { NotificationProcessor } from "./NotificationsProcessor";
import { NotificationsEnableEvent, NotificationsDisableEvent } from "./Webhooks";
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
import Metrics from "./Metrics";
import { FigmaEvent, ensureFigmaWebhooks } from "./figma";
import { ListenerService } from "./ListenerService";
import { SetupConnection } from "./Connections/SetupConnection";
import { getAppservice } from "./appservice";
import { JiraOAuthRequestCloud, JiraOAuthRequestOnPrem, JiraOAuthRequestResult } from "./Jira/OAuth";
import { CLOUD_INSTANCE } from "./Jira/Client";
import { GenericWebhookEvent, GenericWebhookEventResult } from "./generic/types";
import { SetupWidget } from "./Widgets/SetupWidget";
import { FeedEntry, FeedError, FeedReader } from "./feeds/FeedReader";
const log = new LogWrapper("Bridge");

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
    private widgetApi?: BridgeWidgetApi;
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
        Metrics.registerMatrixSdkMetrics(this.as);
        this.queue = createMessageQueue(this.config);
        this.messageClient = new MessageSenderClient(this.queue);
        this.commentProcessor = new CommentProcessor(this.as, this.config.bridge.mediaUrl || this.config.bridge.url);
        this.notifProcessor = new NotificationProcessor(this.storage, this.messageClient);
        this.tokenStore = new UserTokenStore(this.config.passFile || "./passkey.pem", this.as.botIntent, this.config);
        this.as.expressAppInstance.get("/live", (_, res) => res.send({ok: true}));
        this.as.expressAppInstance.get("/ready", (_, res) => res.status(this.ready ? 200 : 500).send({ready: this.ready}));
    }

    public stop() {
        this.as.stop();
        if (this.queue.stop) this.queue.stop();
    }

    public async start() {
        log.info('Starting up');

        // Fetch all room state
        let joinedRooms: string[]|undefined;
        while(joinedRooms === undefined) {
            try {
                log.info("Connecting to homeserver and fetching joined rooms..");
                joinedRooms = await this.as.botIntent.underlyingClient.getJoinedRooms();
                log.debug(`Bridge bot is joined to ${joinedRooms.length} rooms`);
            } catch (ex) {
                // This is our first interaction with the homeserver, so wait if it's not ready yet.
                log.warn("Failed to connect to homeserver:", ex, "retrying in 5s");
                await new Promise((r) => setTimeout(r, 5000));
            }
        }
        
        await this.config.prefillMembershipCache(this.as.botClient);

        if (this.config.github) {
            this.github = new GithubInstance(this.config.github.auth.id, await fs.readFile(this.config.github.auth.privateKeyFile, 'utf-8'));
            await this.github.start();
        }

        if (this.config.figma) {
            // Ensure webhooks are set up
            await ensureFigmaWebhooks(this.config.figma, this.as.botClient);
        }

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
            this.config, this.tokenStore, this.commentProcessor, this.messageClient, this.storage, this.github);

        if (this.config.feeds?.enabled) {
            new FeedReader(
                this.config.feeds,
                this.connectionManager,
                this.queue,
                this.as.botClient,
            );
        }

    
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

        this.as.on("room.leave", async (roomId, event) => {
            return this.onRoomLeave(roomId, event);
        });

        this.as.on("room.join", async (roomId, event) => {
            return this.onRoomJoin(roomId, event);
        });

        this.queue.subscribe("response.matrix.message");
        this.queue.subscribe("notifications.user.events");
        this.queue.subscribe("github.*");
        this.queue.subscribe("gitlab.*");
        this.queue.subscribe("jira.*");
        this.queue.subscribe("figma.*");
        this.queue.subscribe("feed.*");

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

        this.bindHandlerToQueue<GitHubWebhookTypes.IssuesUnlabeledEvent, GitHubRepoConnection>(
            "github.issues.unlabeled",
            (data) => connManager.getConnectionsForGithubRepo(data.repository.owner.login, data.repository.name), 
            (c, data) => c.onIssueUnlabeled(data),
        );
        this.bindHandlerToQueue<GitHubWebhookTypes.IssuesLabeledEvent, GitHubRepoConnection>(
            "github.issues.labeled",
            (data) => connManager.getConnectionsForGithubRepo(data.repository.owner.login, data.repository.name), 
            (c, data) => c.onIssueLabeled(data),
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
            "github.pull_request.ready_for_review",
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
            "gitlab.merge_request.close",
            (data) => connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace), 
            (c, data) => c.onMergeRequestClosed(data),
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

        this.bindHandlerToQueue<IGitLabWebhookReleaseEvent, GitLabRepoConnection>(
            "gitlab.release.create",
            (data) => connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace), 
            (c, data) => c.onRelease(data),
        );

        this.bindHandlerToQueue<IGitLabWebhookTagPushEvent, GitLabRepoConnection>(
            "gitlab.tag_push",
            (data) => connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace), 
            (c, data) => c.onGitLabTagPush(data),
        );

        this.bindHandlerToQueue<IGitLabWebhookPushEvent, GitLabRepoConnection>(
            "gitlab.push",
            (data) => connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace), 
            (c, data) => c.onGitLabPush(data),
        );

        this.bindHandlerToQueue<IGitLabWebhookWikiPageEvent, GitLabRepoConnection>(
            "gitlab.wiki_page",
            (data) => connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace), 
            (c, data) => c.onWikiPageEvent(data),
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

        this.bindHandlerToQueue<IGitLabWebhookNoteEvent, GitLabIssueConnection|GitLabRepoConnection>(
            "gitlab.note.created",
            (data) => { 
                const iid = data.issue?.iid || data.merge_request?.iid;
                return [
                    ...( iid ? connManager.getConnectionsForGitLabIssueWebhook(data.repository.homepage, iid) : []), 
                    ...connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace),
                ]},
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
            if (!this.github || !this.config.github) {
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
                        this.config.github,
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
    
        this.queue.on<JiraOAuthRequestCloud|JiraOAuthRequestOnPrem>("jira.oauth.response", async (msg) => {
            if (!this.config.jira || !this.tokenStore.jiraOAuth) {
                throw Error('Cannot handle, JIRA oauth support not enabled');
            }
            let result: JiraOAuthRequestResult;
            const userId = this.tokenStore.getUserIdForOAuthState(msg.data.state, false);
            if (!userId) {
                return this.queue.push<JiraOAuthRequestResult>({
                    data: JiraOAuthRequestResult.UserNotFound,
                    sender: "Bridge",
                    messageId: msg.messageId,
                    eventName: "response.jira.oauth.response",
                });
            }
            try {
                let tokenInfo: JiraOAuthResult;
                let instance;
                if ("code" in msg.data) {
                    tokenInfo = await this.tokenStore.jiraOAuth.exchangeRequestForToken(msg.data.code);
                    instance = CLOUD_INSTANCE;
                } else {
                    tokenInfo = await this.tokenStore.jiraOAuth.exchangeRequestForToken(msg.data.oauthToken, msg.data.oauthVerifier);
                    instance = new URL(this.config.jira.url!).host;
                }
                await this.tokenStore.storeJiraToken(userId, {
                    access_token: tokenInfo.access_token,
                    refresh_token: tokenInfo.refresh_token,
                    instance,
                    expires_in: tokenInfo.expires_in,
                });

                // Some users won't have an admin room and would have gone through provisioning.
                const adminRoom = [...this.adminRooms.values()].find(r => r.userId === userId);
                if (adminRoom) {
                    await adminRoom.sendNotice(`Logged into Jira`);
                }
                result = JiraOAuthRequestResult.Success;
            } catch (ex) {
                log.warn(`Failed to handle JIRA oauth token exchange`, ex);
                result = JiraOAuthRequestResult.UnknownFailure;
            }
            await this.queue.push<JiraOAuthRequestResult>({
                data: result,
                sender: "Bridge",
                messageId: msg.messageId,
                eventName: "response.jira.oauth.response",
            });

        });
        
        this.queue.on<GenericWebhookEvent>("generic-webhook.event", async (msg) => {
            const { data, messageId } = msg;
            const connections = connManager.getConnectionsForGenericWebhook(data.hookId);
            log.debug(`generic-webhook.event for ${connections.map(c => c.toString()).join(', ') || '[empty]'}`);

            if (!connections.length) {
                await this.queue.push<GenericWebhookEventResult>({
                    data: {notFound: true},
                    sender: "Bridge",
                    messageId: messageId,
                    eventName: "response.generic-webhook.event",
                });
            }

            let didPush = false;
            await Promise.all(connections.map(async (c, index) => {
                try {
                    // TODO: Support webhook responses to more than one room
                    if (index !== 0) {
                        await c.onGenericHook(data.hookData);
                        return;
                    }
                    let successful: boolean|null = null;
                    if (this.config.generic?.waitForComplete) {
                        successful = await c.onGenericHook(data.hookData);
                    }
                    await this.queue.push<GenericWebhookEventResult>({
                        data: {successful},
                        sender: "Bridge",
                        messageId,
                        eventName: "response.generic-webhook.event",
                    });
                    didPush = true;
                    if (!this.config.generic?.waitForComplete) {
                        await c.onGenericHook(data.hookData);
                    }
                }
                catch (ex) {
                    log.warn(`Failed to handle generic webhook`, ex);
                    Metrics.connectionsEventFailed.inc({
                        event: "generic-webhook.event",
                        connectionId: c.connectionId
                    });
                }
            }));

            // We didn't manage to complete sending the event or even sending a failure.
            if (!didPush) {
                await this.queue.push<GenericWebhookEventResult>({
                    data: {
                        successful: false
                    },
                    sender: "Bridge",
                    messageId,
                    eventName: "response.generic-webhook.event",
                });
            }
        });

        this.bindHandlerToQueue<FigmaEvent, FigmaFileConnection>(
            "figma.payload",
            (data) => connManager.getForFigmaFile(data.payload.file_key, data.instanceName),
            (c, data) => c.handleNewComment(data.payload),
        )

        this.bindHandlerToQueue<FeedEntry, FeedConnection>(
            "feed.entry",
            (data) => connManager.getConnectionsForFeedUrl(data.feed.url),
            (c, data) => c.handleFeedEntry(data),
        );
        this.bindHandlerToQueue<FeedError, FeedConnection>(
            "feed.error",
            (data) => connManager.getConnectionsForFeedUrl(data.url),
            (c, data) => c.handleFeedError(data),
        );

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
            try {
                await connManager.createConnectionsForRoomId(roomId);
            } catch (ex) {
                log.error(`Unable to create connection for ${roomId}`, ex);
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
                const adminRoom = await this.setUpAdminRoom(roomId, accountData, notifContent || NotifFilter.getDefaultContent());
                // Call this on startup to set the state
                await this.onAdminRoomSettingsChanged(adminRoom, accountData, { admin_user: accountData.admin_user });
                log.debug(`Room ${roomId} is connected to: ${adminRoom.toString()}`);
            } catch (ex) {
                log.error(`Failed to set up admin room ${roomId}:`, ex);
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
            const apps = this.listener.getApplicationsForResource('widgets');
            if (apps.length > 1) {
                throw Error('You may only bind `widgets` to one listener.');
            } 
            this.widgetApi = new BridgeWidgetApi(
                this.adminRooms,
                this.config,
                this.storage,
                apps[0],
                this.connectionManager,
                this.as.botIntent,
            );
            
        }
        if (this.provisioningApi) {
            this.listener.bindResource('provisioning', this.provisioningApi.expressRouter);
        }
        if (this.config.metrics?.enabled) {
            this.listener.bindResource('metrics', Metrics.expressRouter);
        }
        await this.as.begin();
        log.info(`Bridge is now ready. Found ${this.connectionManager.size} connections`);
        this.ready = true;
    }

    private async bindHandlerToQueue<EventType, ConnType extends IConnection>(event: string, connectionFetcher: (data: EventType) => ConnType[], handler: (c: ConnType, data: EventType) => Promise<unknown>|unknown) {
        this.queue.on<EventType>(event, (msg) => {
            const connections = connectionFetcher.bind(this)(msg.data);
            log.debug(`${event} for ${connections.map(c => c.toString()).join(', ') || '[empty]'}`);
            connections.forEach(async (connection) => {
                try {
                    await handler(connection, msg.data);
                } catch (ex) {
                    Metrics.connectionsEventFailed.inc({ event, connectionId: connection.connectionId });
                    log.warn(`Connection ${connection.toString()} failed to handle ${event}:`, ex);
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
            const room = await this.setUpAdminRoom(roomId, {admin_user: event.sender}, NotifFilter.getDefaultContent());
            await this.as.botClient.setRoomAccountData(
                BRIDGE_ROOM_TYPE, roomId, room.accountData,
            );
            return;
        }

        if (this.connectionManager?.isRoomConnected(roomId)) {
            // Room has connections, don't setup a wizard.
            return;
        }

        try {
            // Otherwise it's a new room
            if (this.config.widgets?.roomSetupWidget?.addOnInvite) {
                if (await this.as.botClient.userHasPowerLevelFor(this.as.botUserId, roomId, "im.vector.modular.widgets", true) === false) {
                    await this.as.botIntent.sendText(roomId, "Hello! To setup new integrations in this room, please promote me to a Moderator/Admin");
                } else {
                    // Setup the widget
                    await SetupWidget.SetupRoomConfigWidget(roomId, this.as.botIntent, this.config.widgets);
                }
            }
        } catch (ex) {
            log.error(`Failed to setup new widget for room`, ex);
        }
    }


    private async onRoomLeave(roomId: string, event: MatrixEvent<MatrixMemberContent>) {
        if (event.state_key !== this.as.botUserId) {
            // Only interested in bot leaves.
            return;
        }
        // If the bot has left the room, we want to vape all connections for that room.
        try {
            await this.connectionManager?.removeConnectionsForRoom(roomId);
        } catch (ex) {
            log.warn(`Failed to remove connections on leave for ${roomId}`);
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
        let processedReply: any;
        let processedReplyMetadata: IRichReplyMetadata|undefined = undefined;
        try {
            processedReply = await this.replyProcessor.processEvent(event, this.as.botClient, EventKind.RoomEvent);
            processedReplyMetadata = processedReply?.mx_richreply;
        } catch (ex) {
            log.warn(`Event ${event.event_id} could not be processed by the reply processor, possibly a faulty event`);
        }
        const adminRoom = this.adminRooms.get(roomId);
        const checkPermission = (service: string, level: BridgePermissionLevel) => this.config.checkPermission(event.sender, service, level);

        if (!adminRoom) {
            let handled = false;
            for (const connection of this.connectionManager.getAllConnectionsForRoom(roomId)) {
                try {
                    if (connection.onMessageEvent) {
                        handled = await connection.onMessageEvent(event, checkPermission, processedReplyMetadata);
                    }
                } catch (ex) {
                    log.warn(`Connection ${connection.toString()} failed to handle message:`, ex);
                }
                if (handled) {
                    break;
                }
            }
            if (!handled && this.config.checkPermissionAny(event.sender, BridgePermissionLevel.manageConnections)) {
                // Divert to the setup room code if we didn't match any of these
                try {
                    await (
                        new SetupConnection(
                            roomId, this.as, this.tokenStore, this.config, 
                            this.getOrCreateAdminRoom.bind(this),
                            this.github,
                        )
                    ).onMessageEvent(event, checkPermission);
                } catch (ex) {
                    log.warn(`Setup connection failed to handle:`, ex);
                }
            }
            return;
        }

        if (adminRoom.userId !== event.sender) {
            return;
        }

        if (processedReply && processedReplyMetadata) {
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
        this.config.addMemberToCache(roomId, matrixEvent.sender);
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
            await this.connectionManager.createConnectionsForRoomId(roomId);
        }
    }

    private async onRoomEvent(roomId: string, event: MatrixEvent<Record<string, unknown>>) {
        if (!this.connectionManager) {
            // Not ready yet.
            return;
        }
        if (event.state_key !== undefined) {
            if (event.type === "m.room.member" && event.content.membership !== "join") {
                this.config.removeMemberFromCache(roomId, event.state_key);
                return;
            }
            // A state update, hurrah!
            const existingConnections = this.connectionManager.getInterestedForRoomState(roomId, event.type, event.state_key);
            for (const connection of existingConnections) {
                try {
                    // Empty object == redacted
                    if (event.content.disabled === true || Object.keys(event.content).length === 0) {
                        await this.connectionManager.purgeConnection(connection.roomId, connection.connectionId, false);
                    } else {
                        connection.onStateUpdate?.(event);
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

            // If it's a power level event for a new room, we might want to create the setup widget.
            if (this.config.widgets?.roomSetupWidget?.addOnInvite && event.type === "m.room.power_levels" && event.state_key === "" && !this.connectionManager.isRoomConnected(roomId)) {
                log.debug(`${roomId} got a new powerlevel change and isn't connected to any connections, testing to see if we should create a setup widget`)
                const plEvent = new PowerLevelsEvent(event);
                const currentPl = plEvent.content.users?.[this.as.botUserId] || plEvent.defaultUserLevel;
                const previousPl = plEvent.previousContent?.users?.[this.as.botUserId] || plEvent.previousContent?.users_default;
                const requiredPl = plEvent.content.events?.["im.vector.modular.widgets"] || plEvent.defaultStateEventLevel;
                if (currentPl !== previousPl && currentPl >= requiredPl) {
                    // PL changed for bot user, check to see if the widget can be created.
                    try {
                        log.info(`Bot has powerlevel required to create a setup widget, attempting`);
                        await SetupWidget.SetupRoomConfigWidget(roomId, this.as.botIntent, this.config.widgets);
                    } catch (ex) {
                        log.error(`Failed to create setup widget for ${roomId}`, ex);
                    }
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
            const token = await this.tokenStore.getGitHubToken(adminRoom.userId);
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

    private async getOrCreateAdminRoom(userId: string): Promise<AdminRoom> {
        const existingRoom = [...this.adminRooms.values()].find(r => r.userId === userId);
        if (existingRoom) {
            return existingRoom;
        }
        // Otherwise, we need to create a room.
        const roomId = await this.as.botClient.createRoom({
            invite: [userId],
            is_direct: true,
            preset: "trusted_private_chat",
        });
        return this.setUpAdminRoom(roomId, {admin_user: userId}, NotifFilter.getDefaultContent());
    }

    private async setUpAdminRoom(roomId: string, accountData: AdminAccountData, notifContent: NotificationFilterStateContent) {
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
            if (!this.config.gitlab) {
                return;
            }
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
                this.messageClient,
                this.config.gitlab,
            );
            this.connectionManager?.push(newConnection);
            return this.as.botClient.inviteUser(adminRoom.userId, newConnection.roomId);
        });
        this.adminRooms.set(roomId, adminRoom);
        if (this.config.widgets?.addToAdminRooms && this.config.widgets.publicUrl) {
            await SetupWidget.SetupAdminRoomConfigWidget(roomId, this.as.botIntent, this.config.widgets);
        }
        log.debug(`Set up ${roomId} as an admin room for ${adminRoom.userId}`);
        return adminRoom;
    }
}
