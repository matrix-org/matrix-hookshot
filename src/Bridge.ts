import { AdminAccountData } from "./AdminRoomCommandHandler";
import { AdminRoom, BRIDGE_ROOM_TYPE, LEGACY_BRIDGE_ROOM_TYPE } from "./AdminRoom";
import { Appservice, RichRepliesPreprocessor, IRichReplyMetadata, StateEvent, EventKind, PowerLevelsEvent, Intent } from "matrix-bot-sdk";
import BotUsersManager from "./Managers/BotUsersManager";
import { BridgeConfig, BridgePermissionLevel, GitLabInstance } from "./config/Config";
import { BridgeWidgetApi } from "./Widgets/BridgeWidgetApi";
import { CommentProcessor } from "./CommentProcessor";
import { ConnectionManager } from "./ConnectionManager";
import { GetIssueResponse, GetIssueOpts } from "./Gitlab/Types"
import { GithubInstance } from "./github/GithubInstance";
import { IBridgeStorageProvider } from "./Stores/StorageProvider";
import { IConnection, GitHubDiscussionSpace, GitHubDiscussionConnection, GitHubUserSpace, JiraProjectConnection, GitLabRepoConnection,
    GitHubIssueConnection, GitHubProjectConnection, GitHubRepoConnection, GitLabIssueConnection, FigmaFileConnection, FeedConnection, GenericHookConnection } from "./Connections";
import { IGitLabWebhookIssueStateEvent, IGitLabWebhookMREvent, IGitLabWebhookNoteEvent, IGitLabWebhookPushEvent, IGitLabWebhookReleaseEvent, IGitLabWebhookTagPushEvent, IGitLabWebhookWikiPageEvent } from "./Gitlab/WebhookTypes";
import { JiraIssueEvent, JiraIssueUpdatedEvent, JiraVersionEvent } from "./jira/WebhookTypes";
import { JiraOAuthResult } from "./jira/Types";
import { MatrixEvent, MatrixMemberContent, MatrixMessageContent } from "./MatrixEvent";
import { MessageQueue, MessageQueueMessageOut, createMessageQueue } from "./MessageQueue";
import { MessageSenderClient } from "./MatrixSender";
import { NotifFilter, NotificationFilterStateContent } from "./NotificationFilters";
import { NotificationProcessor } from "./NotificationsProcessor";
import { NotificationsEnableEvent, NotificationsDisableEvent, Webhooks } from "./Webhooks";
import { GitHubOAuthToken, GitHubOAuthTokenResponse, ProjectsGetResponseData } from "./github/Types";
import { retry } from "./PromiseUtil";
import { UserNotificationsEvent } from "./Notifications/UserNotificationWatcher";
import { UserTokenStore } from "./tokens/UserTokenStore";
import * as GitHubWebhookTypes from "@octokit/webhooks-types";
import { Logger } from "matrix-appservice-bridge";
import { Provisioner } from "./provisioning/provisioner";
import { JiraProvisionerRouter } from "./jira/Router";
import { GitHubProvisionerRouter } from "./github/Router";
import { OAuthRequest } from "./WebhookTypes";
import { promises as fs } from "fs";
import Metrics from "./Metrics";
import { FigmaEvent, ensureFigmaWebhooks } from "./figma";
import { ListenerService } from "./ListenerService";
import { SetupConnection } from "./Connections/SetupConnection";
import { JiraOAuthRequestCloud, JiraOAuthRequestOnPrem, JiraOAuthRequestResult } from "./jira/OAuth";
import { GenericWebhookEvent, GenericWebhookEventResult } from "./generic/types";
import { SetupWidget } from "./Widgets/SetupWidget";
import { FeedEntry, FeedError, FeedReader, FeedSuccess } from "./feeds/FeedReader";
import * as Sentry from '@sentry/node';
import { HoundConnection, HoundPayload } from "./Connections/HoundConnection";
import { HoundReader } from "./hound/reader";

const log = new Logger("Bridge");

export class Bridge {
    private readonly messageClient: MessageSenderClient;
    private readonly queue: MessageQueue;
    private readonly commentProcessor: CommentProcessor;
    private readonly notifProcessor: NotificationProcessor;
    private connectionManager?: ConnectionManager;
    private github?: GithubInstance;
    private adminRooms: Map<string, AdminRoom> = new Map();
    private feedReader?: FeedReader;
    private houndReader?: HoundReader;
    private provisioningApi?: Provisioner;
    private replyProcessor = new RichRepliesPreprocessor(true);

    private ready = false;

    constructor(
        private config: BridgeConfig,
        private readonly tokenStore: UserTokenStore,
        private readonly listener: ListenerService,
        private readonly as: Appservice,
        private readonly storage: IBridgeStorageProvider,
        private readonly botUsersManager: BotUsersManager,
    ) {
        this.queue = createMessageQueue(this.config.queue);
        this.messageClient = new MessageSenderClient(this.queue);
        this.commentProcessor = new CommentProcessor(this.as, this.config.bridge.mediaUrl || this.config.bridge.url);
        this.notifProcessor = new NotificationProcessor(this.storage, this.messageClient);

        // Legacy routes, to be removed.
        this.as.expressAppInstance.get("/live", (_, res) => res.send({ok: true}));
        this.as.expressAppInstance.get("/ready", (_, res) => res.status(this.ready ? 200 : 500).send({ready: this.ready}));
    }

    public stop() {
        this.feedReader?.stop();
        this.houndReader?.stop();
        this.tokenStore.stop();
        this.as.stop();
        if (this.queue.stop) this.queue.stop();
    }

    public async start() {
        this.tokenStore.on("onNewToken", this.onTokenUpdated.bind(this));
        log.info('Starting up');
        await this.storage.connect?.();
        await this.queue.connect?.();

        log.info("Ensuring homeserver can be reached...");
        let reached = false;
        while (!reached) {
            try {
                // Make a request to determine if we can reach the homeserver
                await this.as.botIntent.underlyingClient.getWhoAmI();
                reached = true;
            } catch (e) {
                log.warn("Failed to connect to homeserver, retrying in 5s", e);
                await new Promise((r) => setTimeout(r, 5000));
            }
        }

        await this.botUsersManager.start();

        await this.config.prefillMembershipCache(this.as.botClient);

        if (this.config.github) {
            this.github = new GithubInstance(
                this.config.github.auth.id,
                await fs.readFile(this.config.github.auth.privateKeyFile, 'utf-8'),
                this.config.github.baseUrl,
            );
            await this.github.start();
        }

        if (this.config.figma) {
            // Ensure webhooks are set up
            await ensureFigmaWebhooks(this.config.figma, this.as.botClient);
        }

        const connManager = this.connectionManager = new ConnectionManager(
            this.as,
            this.config,
            this.tokenStore,
            this.commentProcessor,
            this.messageClient,
            this.storage,
            this.botUsersManager,
            this.github,
        );

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
            this.provisioningApi = new Provisioner(
                this.config.provisioning,
                this.connectionManager,
                this.botUsersManager,
                this.as,
                routers,
            );
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

        this.as.on("room.failed_decryption", (roomId, event, err) => {
            log.warn(`Failed to decrypt event ${event.event_id} from ${roomId}: ${err.message}`);
            Metrics.matrixAppserviceDecryptionFailed.inc();
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

        this.bindHandlerToQueue<GitHubWebhookTypes.IssueCommentCreatedEvent, GitHubIssueConnection|GitHubRepoConnection>(
            "github.issue_comment.created",
            (data) => {
                const { repository, issue, owner } = validateRepoIssue(data);
                return connManager.getConnectionsForGithubIssue(owner, repository.name, issue.number);
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

        this.bindHandlerToQueue<GitHubWebhookTypes.PushEvent, GitHubRepoConnection>(
            "github.push",
            (data) => connManager.getConnectionsForGithubRepo(data.repository.owner.login, data.repository.name),
            (c, data) => c.onPush(data),
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

        this.bindHandlerToQueue<GitHubWebhookTypes.WorkflowRunCompletedEvent, GitHubRepoConnection>(
            "github.workflow_run.completed",
            (data) => connManager.getConnectionsForGithubRepo(data.repository.owner.login, data.repository.name),
            (c, data) => c.onWorkflowCompleted(data),
        );

        this.bindHandlerToQueue<GitHubWebhookTypes.ReleasePublishedEvent, GitHubRepoConnection>(
            "github.release.published",
            (data) => connManager.getConnectionsForGithubRepo(data.repository.owner.login, data.repository.name),
            (c, data) => c.onReleaseCreated(data),
        );

        this.bindHandlerToQueue<GitHubWebhookTypes.ReleaseCreatedEvent, GitHubRepoConnection>(
            "github.release.created",
            (data) => connManager.getConnectionsForGithubRepo(data.repository.owner.login, data.repository.name),
            (c, data) => c.onReleaseDrafted(data),
        );

        this.bindHandlerToQueue<IGitLabWebhookMREvent, GitLabRepoConnection>(
            "gitlab.merge_request.open",
            (data) => connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace),
            (c, data) => c.onMergeRequestOpened(data),
        );

        this.bindHandlerToQueue<IGitLabWebhookMREvent, GitLabRepoConnection>(
            "gitlab.merge_request.reopen",
            (data) => connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace),
            (c, data) => c.onMergeRequestReopened(data),
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

        this.bindHandlerToQueue<IGitLabWebhookMREvent, GitLabRepoConnection>(
            "gitlab.merge_request.approval",
            (data) => connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace),
            (c, data) => c.onMergeRequestIndividualReview(data),
        );

        this.bindHandlerToQueue<IGitLabWebhookMREvent, GitLabRepoConnection>(
            "gitlab.merge_request.unapproval",
            (data) => connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace),
            (c, data) => c.onMergeRequestIndividualReview(data),
        );

        this.bindHandlerToQueue<IGitLabWebhookMREvent, GitLabRepoConnection>(
            "gitlab.merge_request.update",
            (data) => connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace),
            (c, data) => c.onMergeRequestUpdate(data),
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

            // Some users won't have an admin room and would have gone through provisioning.
            const adminRoom = this.getAdminRoomForUser(userId);
            if (adminRoom) {
                await adminRoom.sendNotice("Logged into GitHub");
            }
        });

        this.bindHandlerToQueue<IGitLabWebhookNoteEvent, GitLabIssueConnection|GitLabRepoConnection>(
            "gitlab.note.created",
            (data) => {
                const iid = data.issue?.iid || data.merge_request?.iid;
                return [
                    ...( iid ? connManager.getConnectionsForGitLabIssueWebhook(data.repository.homepage, iid) : []),
                    ...connManager.getConnectionsForGitLabRepo(data.project.path_with_namespace),
                ]},
            (c, data) => c instanceof GitLabRepoConnection ? c.onMergeRequestCommentCreated(data) : c.onCommentCreated(data),
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
                const botUser = this.botUsersManager.getBotUserForService(GitHubDiscussionConnection.ServiceCategory);
                if (!botUser) {
                    throw Error('Could not find a bot to handle this connection');
                }

                try {
                    // If we don't have an existing connection for this discussion (likely), then create one.
                    discussionConnection = await GitHubDiscussionConnection.createDiscussionRoom(
                        this.as,
                        botUser.intent,
                        null,
                        data.repository.owner.login,
                        data.repository.name,
                        data.discussion,
                        this.tokenStore,
                        this.commentProcessor,
                        this.messageClient,
                        this.config,
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
            (data) => connManager.getConnectionsForJiraProject(data.issue.fields.project),
            (c, data) => c.onJiraIssueCreated(data),
        );

        this.bindHandlerToQueue<JiraIssueUpdatedEvent, JiraProjectConnection>(
            "jira.issue_updated",
            (data) => connManager.getConnectionsForJiraProject(data.issue.fields.project),
            (c, data) => c.onJiraIssueUpdated(data),
        );

        for (const event of ["created", "updated", "released"]) {
            this.bindHandlerToQueue<JiraVersionEvent, JiraProjectConnection>(
                `jira.version_${event}`,
                (data) => connManager.getConnectionsForJiraVersion(data.version),
                (c, data) => c.onJiraVersionEvent(data),
            );
        }

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
                if ("code" in msg.data) {
                    tokenInfo = await this.tokenStore.jiraOAuth.exchangeRequestForToken(msg.data.code);
                } else {
                    tokenInfo = await this.tokenStore.jiraOAuth.exchangeRequestForToken(msg.data.oauthToken, msg.data.oauthVerifier);
                }
                await this.tokenStore.storeJiraToken(userId, {
                    access_token: tokenInfo.access_token,
                    refresh_token: tokenInfo.refresh_token,
                    instance: this.config.jira.instanceName,
                    expires_in: tokenInfo.expires_in,
                });

                // Some users won't have an admin room and would have gone through provisioning.
                const adminRoom = this.getAdminRoomForUser(userId);
                if (adminRoom) {
                    await adminRoom.sendNotice("Logged into Jira");
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
                    data: {successful: true, notFound: true},
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
                    if (this.config.generic?.waitForComplete || c.waitForComplete) {
                        const result = await c.onGenericHook(data.hookData);
                        await this.queue.push<GenericWebhookEventResult>({
                            data: result,
                            sender: "Bridge",
                            messageId,
                            eventName: "response.generic-webhook.event",
                        });
                    } else {
                        await this.queue.push<GenericWebhookEventResult>({
                            data: {
                                successful: null,
                            },
                            sender: "Bridge",
                            messageId,
                            eventName: "response.generic-webhook.event",
                        });
                        await c.onGenericHook(data.hookData);
                    }
                    didPush = true;
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
        this.bindHandlerToQueue<FeedSuccess, FeedConnection>(
            "feed.success",
            (data) => connManager.getConnectionsForFeedUrl(data.url),
            c => c.handleFeedSuccess(),
        );
        this.bindHandlerToQueue<FeedError, FeedConnection>(
            "feed.error",
            (data) => connManager.getConnectionsForFeedUrl(data.url),
            (c, data) => c.handleFeedError(data),
        );

        this.bindHandlerToQueue<HoundPayload, HoundConnection>(
            "hound.activity",
            (data) => connManager.getConnectionsForHoundChallengeId(data.challengeId),
            (c, data) => c.handleNewActivity(data.activity)
        );

        const allRooms = this.botUsersManager.joinedRooms;

        const processRooms = async () => {
            for (let roomId = allRooms.pop(); roomId !== undefined; roomId = allRooms.pop()) {
                log.debug("Fetching state for " + roomId);

                try {
                    await connManager.createConnectionsForRoomId(roomId, false);
                } catch (ex) {
                    log.error(`Unable to create connection for ${roomId}`, ex);
                    continue;
                }
    
                const botUser = this.botUsersManager.getBotUserInRoom(roomId);
                if (!botUser) {
                    log.error(`Failed to find a bot in room '${roomId}' when setting up admin room`);
                    continue;
                }
    
                // TODO: Refactor this to be a connection
                try {
                    let accountData = await botUser.intent.underlyingClient.getSafeRoomAccountData<AdminAccountData>(
                        BRIDGE_ROOM_TYPE, roomId,
                    );
                    if (!accountData) {
                        accountData = await botUser.intent.underlyingClient.getSafeRoomAccountData<AdminAccountData>(
                            LEGACY_BRIDGE_ROOM_TYPE, roomId,
                        );
                        if (!accountData) {
                            log.debug(`Room ${roomId} has no connections and is not an admin room`);
                            continue;
                        } else {
                            // Upgrade the room
                            await botUser.intent.underlyingClient.setRoomAccountData(BRIDGE_ROOM_TYPE, roomId, accountData);
                        }
                    }
    
                    let notifContent;
                    try {
                        notifContent = await botUser.intent.underlyingClient.getRoomStateEvent(
                            roomId, NotifFilter.StateType, "",
                        );
                    } catch {
                        try {
                            notifContent = await botUser.intent.underlyingClient.getRoomStateEvent(
                                roomId, NotifFilter.LegacyStateType, "",
                            );
                        }
                        catch {
                            // No state yet
                        }
                    }
                    const adminRoom = await this.setUpAdminRoom(botUser.intent, roomId, accountData, notifContent || NotifFilter.getDefaultContent());
                    // Call this on startup to set the state
                    await this.onAdminRoomSettingsChanged(adminRoom, accountData, { admin_user: accountData.admin_user });
                    log.debug(`Room ${roomId} is connected to: ${adminRoom.toString()}`);
                } catch (ex) {
                    log.error(`Failed to set up admin room ${roomId}:`, ex);
                }    
            }
        }

        // Concurrency of two.
        const roomQueue = await Promise.all([processRooms(), processRooms()])

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
            new BridgeWidgetApi(
                this.adminRooms,
                this.config,
                this.storage,
                apps[0],
                this.connectionManager,
                this.botUsersManager,
                this.as,
                this.tokenStore,
                this.github,
            );

        }
        if (this.provisioningApi) {
            this.listener.bindResource('provisioning', this.provisioningApi.expressRouter);
        }
        if (this.config.metrics?.enabled) {
            this.listener.bindResource('metrics', Metrics.expressRouter);
        }
        await roomQueue;
        log.info(`All connections loaded`);

        // Load feeds after connections, to limit the chances of us double
        // posting to rooms if a previous hookshot instance is being replaced.
        if (this.config.feeds?.enabled) {
            this.feedReader = new FeedReader(
                this.config.feeds,
                this.connectionManager,
                this.queue,
                this.storage,
            );
        }

        if (this.config.challengeHound?.token) {
            this.houndReader = new HoundReader(
                this.config.challengeHound,
                this.connectionManager,
                this.queue,
                this.storage,
            );
        }

        const webhookHandler = new Webhooks(this.config);
        this.listener.bindResource('webhooks', webhookHandler.expressRouter);

        await this.as.begin();
        log.info(`Bridge is now ready. Found ${this.connectionManager.size} connections`);
        this.ready = true;
    }

    private async handleHookshotEvent<EventType, ConnType extends IConnection>(msg: MessageQueueMessageOut<EventType>, connection: ConnType, handler: (c: ConnType, data: EventType) => Promise<unknown>|unknown) {
        try {
            await handler(connection, msg.data);
        } catch (e) {
            Sentry.withScope((scope) => {
                scope.setTransactionName('handleHookshotEvent');
                scope.setTags({
                    eventType: msg.eventName,
                    roomId: connection.roomId,
                });
                scope.setContext("connection", {
                    id: connection.connectionId,
                });
                log.warn(`Connection ${connection.toString()} failed to handle ${msg.eventName}:`, e);
                Metrics.connectionsEventFailed.inc({ event: msg.eventName, connectionId: connection.connectionId });
                Sentry.captureException(e, scope);
            });
        }
    }

    private async bindHandlerToQueue<EventType, ConnType extends IConnection>(event: string, connectionFetcher: (data: EventType) => ConnType[], handler: (c: ConnType, data: EventType) => Promise<unknown>|unknown) {
        const connectionFetcherBound = connectionFetcher.bind(this);
        this.queue.on<EventType>(event, (msg) => {
            const connections = connectionFetcherBound(msg.data);
            log.debug(`${event} for ${connections.map(c => c.toString()).join(', ') || '[empty]'}`);
            connections.forEach((connection) => {
                void this.handleHookshotEvent(msg, connection, handler);
            });
        });
    }

    private async onRoomInvite(roomId: string, event: MatrixEvent<MatrixMemberContent>) {
        if (this.as.isNamespacedUser(event.sender)) {
            /* Do not handle invites from our users */
            return;
        }
        const invitedUserId = event.state_key;
        if (!invitedUserId) {
            return;
        }
        log.info(`Got invite roomId=${roomId} from=${event.sender} to=${invitedUserId}`);

        const botUser = this.botUsersManager.getBotUser(invitedUserId);
        if (!botUser) {
            // We got an invite but it's not a configured bot user, must be for a ghost user
            log.debug(`Rejecting invite to room ${roomId} for ghost user ${invitedUserId}`);
            const client = this.as.getIntentForUserId(invitedUserId).underlyingClient;
            return client.doRequest("POST", "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/leave", null, {
                reason: "Bridge does not support DMing ghosts"
            });
        }

        // Don't accept invites from people who can't do anything
        if (!this.config.checkPermissionAny(event.sender, BridgePermissionLevel.login)) {
            return botUser.intent.underlyingClient.doRequest("POST", "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/leave", null, {
                reason: "You do not have permission to invite this bot."
            });
        }

        if (event.content.is_direct && botUser.userId !== this.as.botUserId) {
            // Service bots do not support direct messages (admin rooms)
            log.debug(`Rejecting direct message (admin room) invite to room ${roomId} for service bot ${botUser.userId}`);
            return botUser.intent.underlyingClient.doRequest("POST", "/_matrix/client/v3/rooms/" + encodeURIComponent(roomId) + "/leave", null, {
                reason: "This bot does not support admin rooms."
            });
        }

        // Accept the invite
        await retry(async () => {
            try {
                await botUser.intent.joinRoom(roomId);
            } catch (ex) {
                log.warn(`Failed to join ${roomId}`, ex);
                throw ex;
            }
        }, 5);
        if (event.content.is_direct) {
            await botUser.intent.underlyingClient.setRoomAccountData(
                BRIDGE_ROOM_TYPE, roomId, {admin_user: event.sender},
            );
        }
    }


    private async onRoomLeave(roomId: string, matrixEvent: MatrixEvent<MatrixMemberContent>) {
        const userId = matrixEvent.state_key;
        if (!userId) {
            return;
        }

        const botUser = this.botUsersManager.getBotUser(userId);
        if (!botUser) {
            // Not for one of our bots
            return;
        }
        this.botUsersManager.onRoomLeave(botUser, roomId);

        if (!this.connectionManager) {
            return;
        }

        // Remove all the connections for this room
        await this.connectionManager.removeConnectionsForRoom(roomId);
        if (this.botUsersManager.getBotUsersInRoom(roomId).length > 0) {
            // If there are still bots in the room, recreate connections
            await this.connectionManager.createConnectionsForRoomId(roomId, true);
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
        let processedReply;
        let processedReplyMetadata: IRichReplyMetadata|undefined = undefined;
        try {
            processedReply = await this.replyProcessor.processEvent(event, this.as.botClient, EventKind.RoomEvent);
            processedReplyMetadata = processedReply?.mx_richreply;
        } catch (ex) {
            log.warn(`Event ${event.event_id} could not be processed by the reply processor, possibly a faulty event`, ex);
        }
        const adminRoom = this.adminRooms.get(roomId);
        const checkPermission = (service: string, level: BridgePermissionLevel) => this.config.checkPermission(event.sender, service, level);

        if (!adminRoom) {
            let handled = false;
            for (const connection of this.connectionManager.getAllConnectionsForRoom(roomId)) {
                const scope = new Sentry.Scope();
                scope.setTransactionName('onRoomMessage');
                scope.setTags({
                    eventId: event.event_id,
                    sender: event.sender,
                    eventType: event.type,
                    roomId: connection.roomId,
                });
                scope.setContext("connection", {
                    id: connection.connectionId,
                });
                try {
                    if (connection.onMessageEvent) {
                        handled = await connection.onMessageEvent(event, checkPermission, processedReplyMetadata);
                    }
                } catch (ex) {
                    log.warn(`Connection ${connection.toString()} failed to handle message:`, ex);
                    Sentry.captureException(ex, scope);
                }
                if (handled) {
                    break;
                }
            }
            if (!handled && this.config.checkPermissionAny(event.sender, BridgePermissionLevel.manageConnections)) {
                // Divert to the setup room code if we didn't match any of these

                const botUsersInRoom = this.botUsersManager.getBotUsersInRoom(roomId);
                // Try each bot in the room until one handles the command
                for (const botUser of botUsersInRoom) {
                    try {
                        const setupConnection = new SetupConnection(
                            roomId,
                            botUser.prefix,
                            botUser.services,
                            [
                                ...botUser.services,
                                this.config.widgets?.roomSetupWidget ? "widget" : "",
                            ],
                            {
                                config: this.config,
                                as: this.as,
                                intent: botUser.intent,
                                tokenStore: this.tokenStore,
                                commentProcessor: this.commentProcessor,
                                messageClient: this.messageClient,
                                storage: this.storage,
                                github: this.github,
                                getAllConnectionsOfType: this.connectionManager.getAllConnectionsOfType.bind(this.connectionManager),
                            },
                            this.getOrCreateAdminRoom.bind(this),
                            this.connectionManager.push.bind(this.connectionManager),
                        );
                        const handled = await setupConnection.onMessageEvent(event, checkPermission);
                        if (handled) {
                            break;
                        }
                    } catch (ex) {
                        log.warn(`Setup connection failed to handle:`, ex);
                    }
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
                await adminRoom.sendNotice("Failed to handle reply. You may not be authenticated to do that.");
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
        const userId = matrixEvent.state_key;
        if (!userId) {
            return;
        }

        const botUser = this.botUsersManager.getBotUser(userId);
        if (!botUser) {
            // Not for one of our bots
            return;
        }
        this.botUsersManager.onRoomJoin(botUser, roomId);

        if (this.config.encryption) {
            // Ensure crypto is aware of all members of this room before posting any messages,
            // so that the bot can share room keys to all recipients first.
            await botUser.intent.underlyingClient.crypto.onRoomJoin(roomId);
        }

        const adminAccountData = await botUser.intent.underlyingClient.getSafeRoomAccountData<AdminAccountData>(
            BRIDGE_ROOM_TYPE, roomId,
        );
        if (adminAccountData) {
            const room = await this.setUpAdminRoom(botUser.intent, roomId, adminAccountData, NotifFilter.getDefaultContent());
            await botUser.intent.underlyingClient.setRoomAccountData(
                BRIDGE_ROOM_TYPE, roomId, room.accountData,
            );
        }

        if (!this.connectionManager) {
            // Not ready yet.
            return;
        }

        // Recreate connections for the room
        await this.connectionManager.removeConnectionsForRoom(roomId);
        await this.connectionManager.createConnectionsForRoomId(roomId, true);

        // Only fetch rooms we have no connections in yet.
        const roomHasConnection = this.connectionManager.isRoomConnected(roomId);

        // If room has connections or is an admin room, don't set up a wizard.
        // Otherwise it's a new room
        if (!roomHasConnection && !adminAccountData && this.config.widgets?.roomSetupWidget?.addOnInvite) {
            try {
                const hasPowerlevel = await botUser.intent.underlyingClient.userHasPowerLevelFor(
                    botUser.intent.userId,
                    roomId,
                    "im.vector.modular.widgets",
                    true,
                );
                if (!hasPowerlevel) {
                    await botUser.intent.sendText(roomId, "Hello! To set up new integrations in this room, please promote me to a Moderator/Admin.");
                } else {
                    // Set up the widget
                    await SetupWidget.SetupRoomConfigWidget(roomId, botUser.intent, this.config.widgets, botUser.services);
                }
            } catch (ex) {
                log.error(`Failed to setup new widget for room`, ex);
            }
        }
    }

    private async onRoomEvent(roomId: string, event: MatrixEvent<Record<string, unknown>>) {
        if (!this.connectionManager) {
            // Not ready yet.
            return;
        }
        if (event.state_key !== undefined) {
            if (event.type === "m.room.member") {
                if (event.content.membership === "join") {
                    this.config.addMemberToCache(roomId, event.state_key);
                } else {
                    this.config.removeMemberFromCache(roomId, event.state_key);
                }
                return;
            }
            // A state update, hurrah!
            const existingConnections = this.connectionManager.getInterestedForRoomState(roomId, event.type, event.state_key);
            const state = new StateEvent(event);
            for (const connection of existingConnections) {
                if (!this.connectionManager.verifyStateEventForConnection(connection, state, true)) {
                    continue;
                }
                const scope = new Sentry.Scope();
                scope.setTransactionName('onStateUpdate');
                scope.setTags({
                    eventId: event.event_id,
                    sender: event.sender,
                    eventType: event.type,
                    roomId: connection.roomId,
                });
                scope.setContext("connection", {
                    id: connection.connectionId,
                });
                try {
                    // Empty object == redacted
                    if (event.content.disabled === true || Object.keys(event.content).length === 0) {
                        await this.connectionManager.purgeConnection(connection.roomId, connection.connectionId, false);
                    } else {
                        await connection.onStateUpdate?.(event);
                    }
                } catch (ex) {
                    log.warn(`Connection ${connection.toString()} for ${roomId} failed to handle state update:`, ex);
                }
            }
            if (!existingConnections.length) {
                // Is anyone interested in this state?
                try {
                    const connection = await this.connectionManager.createConnectionForState(roomId, new StateEvent(event), true);
                    if (connection) {
                        log.info(`New connected added to ${roomId}: ${connection.toString()}`);
                        this.connectionManager.push(connection);
                    }
                } catch (ex) {
                    log.error(`Failed to handle connection for state ${event.type} in ${roomId}`, ex);
                }
            }

            const botUsersInRoom = this.botUsersManager.getBotUsersInRoom(roomId);
            for (const botUser of botUsersInRoom) {
                // If it's a power level event for a new room, we might want to create the setup widget.
                if (this.config.widgets?.roomSetupWidget?.addOnInvite && event.type === "m.room.power_levels" && event.state_key === "" && !this.connectionManager.isRoomConnected(roomId)) {
                    log.debug(`${roomId} got a new powerlevel change and isn't connected to any connections, testing to see if we should create a setup widget`)
                    const plEvent = new PowerLevelsEvent(event);
                    const currentPl = plEvent.content.users?.[botUser.userId] ?? plEvent.defaultUserLevel;
                    const previousPl = plEvent.previousContent?.users?.[botUser.userId] ?? plEvent.previousContent?.users_default;
                    const requiredPl = plEvent.content.events?.["im.vector.modular.widgets"] ?? plEvent.defaultStateEventLevel;
                    if (currentPl !== previousPl && currentPl >= requiredPl) {
                        // PL changed for bot user, check to see if the widget can be created.
                        try {
                            log.info(`Bot has powerlevel required to create a setup widget, attempting`);
                            await SetupWidget.SetupRoomConfigWidget(roomId, botUser.intent, this.config.widgets, botUser.services);
                        } catch (ex) {
                            log.error(`Failed to create setup widget for ${roomId}`, ex);
                        }
                    }
                }
            }
            return;
        }

        // We still want to react to our own state events.
        if (this.botUsersManager.isBotUser(event.sender)) {
            // It's us
            return;
        }

        for (const connection of this.connectionManager.getAllConnectionsForRoom(roomId)) {
            if (!connection.onEvent) {
                continue;
            }
            const scope = new Sentry.Scope();
            scope.setTransactionName('onRoomEvent');
            scope.setTags({
                eventId: event.event_id,
                sender: event.sender,
                eventType: event.type,
                roomId: connection.roomId,
            });
            scope.setContext("connection", {
                id: connection.connectionId,
            });
            try {
                await connection.onEvent(event);
            } catch (ex) {
                Sentry.captureException(ex, scope);
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

    private async getOrCreateAdminRoom(intent: Intent, userId: string): Promise<AdminRoom> {
        const existingRoom = this.getAdminRoomForUser(userId);
        if (existingRoom) {
            return existingRoom;
        }
        const roomId = await intent.underlyingClient.dms.getOrCreateDm(userId);
        const room = await this.setUpAdminRoom(intent, roomId, {admin_user: userId}, NotifFilter.getDefaultContent());
        await this.as.botClient.setRoomAccountData(
            BRIDGE_ROOM_TYPE, roomId, room.accountData,
        );
        return room;
    }

    private getAdminRoomForUser(userId: string): AdminRoom|null {
        for (const adminRoom of this.adminRooms.values()) {
            if (adminRoom.userId === userId) {
                return adminRoom;
            }
        }
        return null;
    }

    private async setUpAdminRoom(
        intent: Intent,
        roomId: string,
        accountData: AdminAccountData,
        notifContent: NotificationFilterStateContent,
    ) {
        if (!this.connectionManager) {
            throw Error('setUpAdminRoom() called before connectionManager was ready');
        }

        const adminRoom = new AdminRoom(
            roomId, accountData, notifContent, intent, this.tokenStore, this.config, this.connectionManager,
        );

        adminRoom.on("settings.changed", this.onAdminRoomSettingsChanged.bind(this));
        adminRoom.on("open.project", async (project: ProjectsGetResponseData) => {
            const [connection] = this.connectionManager?.getForGitHubProject(project.id) || [];
            if (!connection) {
                const connection = await GitHubProjectConnection.onOpenProject(project, this.as, intent, this.config, adminRoom.userId);
                this.connectionManager?.push(connection);
            } else {
                await intent.underlyingClient.inviteUser(adminRoom.userId, connection.roomId);
            }
        });
        adminRoom.on("open.gitlab-issue", async (issueInfo: GetIssueOpts, res: GetIssueResponse, instanceName: string, instance: GitLabInstance) => {
            if (!this.config.gitlab) {
                return;
            }
            const [ connection ] = this.connectionManager?.getConnectionsForGitLabIssue(instance, issueInfo.projects, issueInfo.issue) || [];
            if (connection) {
                return intent.underlyingClient.inviteUser(adminRoom.userId, connection.roomId);
            }
            const newConnection = await GitLabIssueConnection.createRoomForIssue(
                instanceName,
                instance,
                res,
                issueInfo.projects,
                this.as,
                intent,
                this.tokenStore,
                this.commentProcessor,
                this.messageClient,
                this.config,
            );
            this.connectionManager?.push(newConnection);
            return intent.underlyingClient.inviteUser(adminRoom.userId, newConnection.roomId);
        });
        this.adminRooms.set(roomId, adminRoom);
        if (this.config.widgets?.addToAdminRooms) {
            await SetupWidget.SetupAdminRoomConfigWidget(roomId, intent, this.config.widgets);
        }
        log.debug(`Set up ${roomId} as an admin room for ${adminRoom.userId}`);
        return adminRoom;
    }

    private onTokenUpdated(type: string, userId: string, token: string, instanceUrl?: string) {
        let instanceName: string|undefined;
        if (type === "gitlab") {
            // TODO: Refactor our API to depend on either instanceUrl or instanceName.
            instanceName =  Object.entries(this.config.gitlab?.instances || {}).find(i => i[1].url === instanceUrl)?.[0];
        } else if (type === "github") {
            // GitHub tokens are special
            token = UserTokenStore.parseGitHubToken(token).access_token;
        } else {
            return;
        }
        for (const adminRoom of this.adminRooms.values()) {
            if (adminRoom.userId !== userId) continue;
            if (adminRoom?.notificationsEnabled(type, instanceName)) {
                log.debug(`Token was updated for ${userId} (${type}), notifying notification watcher`);
                this.queue.push<NotificationsEnableEvent>({
                    eventName: "notifications.user.enable",
                    sender: "Bridge",
                    data: {
                        userId: adminRoom.userId,
                        roomId: adminRoom.roomId,
                        token,
                        filterParticipating: adminRoom.notificationsParticipating("github"),
                        type,
                        instanceUrl,
                    },
                }).catch(ex => log.error(`Failed to push notifications.user.enable:`, ex));
            }
        }
    }
}
