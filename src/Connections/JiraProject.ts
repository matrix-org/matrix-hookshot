import { Connection, IConnection, IConnectionState, InstantiateConnectionOpts, ProvisionConnectionOpts } from "./IConnection";
import { Appservice, Intent, StateEvent } from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";
import { JiraIssueEvent, JiraIssueUpdatedEvent, JiraVersionEvent } from "../jira/WebhookTypes";
import { FormatUtil } from "../FormatUtil";
import markdownit from "markdown-it";
import { generateJiraWebLinkFromIssue, generateJiraWebLinkFromVersion } from "../jira";
import { JiraProject, JiraVersion } from "../jira/Types";
import { botCommand, BotCommands, compileBotCommands } from "../BotCommands";
import { MatrixMessageContent } from "../MatrixEvent";
import { CommandConnection } from "./CommandConnection";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { CommandError, NotLoggedInError } from "../errors";
import { ApiError, ErrCode } from "../api";
import JiraApi from "jira-client";
import { GetConnectionsResponseItem } from "../provisioning/api";
import { BridgeConfigJira } from "../config/Config";
import { HookshotJiraApi } from "../jira/Client";
import { GrantChecker } from "../grants/GrantCheck";
import { JiraGrantChecker } from "../jira/GrantChecker";

type JiraAllowedEventsNames =
    "issue_created" |
    "issue_updated" |
    "version_created" |
    "version_updated" |
    "version_released";

const JiraAllowedEvents: JiraAllowedEventsNames[] = [
    "issue_created" ,
    "issue_updated" ,
    "version_created" ,
    "version_updated" ,
    "version_released",
];

export interface JiraProjectConnectionState extends IConnectionState {
    // prefer url, but some events identify projects by id
    id?: string;
    url: string;
    events?: JiraAllowedEventsNames[],
}


export interface JiraProjectConnectionInstanceTarget {
    url: string;
    name: string;
}
export interface JiraProjectConnectionProjectTarget {
    state: JiraProjectConnectionState;
    key: string;
    name: string;
}

export type JiraProjectConnectionTarget = JiraProjectConnectionInstanceTarget|JiraProjectConnectionProjectTarget;

export interface JiraTargetFilter {
    instanceName?: string;
    search?: string;
}


export type JiraProjectResponseItem = GetConnectionsResponseItem<JiraProjectConnectionState>;


function validateJiraConnectionState(state: unknown): JiraProjectConnectionState {
    const {id, url, commandPrefix, priority} = state as Partial<JiraProjectConnectionState>;
    if (id !== undefined && typeof id !== "string") {
        throw new ApiError("Expected 'id' to be a string", ErrCode.BadValue);
    }
    if (url === undefined) {
        throw new ApiError("Expected a 'url' property", ErrCode.BadValue);
    }
    if (commandPrefix) {
        if (typeof commandPrefix !== "string") {
            throw new ApiError("Expected 'commandPrefix' to be a string", ErrCode.BadValue);
        }
        if (commandPrefix.length < 2 || commandPrefix.length > 24) {
            throw new ApiError("Expected 'commandPrefix' to be between 2-24 characters", ErrCode.BadValue);
        }
    }
    let {events} = state as Partial<JiraProjectConnectionState>;
    if (!events || events[0] as string == 'issue.created') { // migration
        events = ['issue_created'];
    } else if (events.find((ev) => !JiraAllowedEvents.includes(ev))?.length) {
        throw new ApiError(`'events' can only contain ${JiraAllowedEvents.join(", ")}`, ErrCode.BadValue);
    }
    return {id, url, commandPrefix, events, priority};
}

const log = new Logger("JiraProjectConnection");
const md = new markdownit();

/**
 * Handles rooms connected to a Jira project.
 */
@Connection
export class JiraProjectConnection extends CommandConnection<JiraProjectConnectionState> implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.jira.project";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.jira.project";

    static readonly EventTypes = [
        JiraProjectConnection.CanonicalEventType,
        JiraProjectConnection.LegacyCanonicalEventType,
    ];
    static readonly ServiceCategory = "jira";
    static botCommands: BotCommands;
    static helpMessage: (cmdPrefix?: string) => MatrixMessageContent;

    static async assertUserHasAccessToProject(tokenStore: UserTokenStore, userId: string, urlStr: string) {
        const url = new URL(urlStr);
        const jiraClient = await tokenStore.getJiraForUser(userId, url.toString());
        if (!jiraClient) {
            throw new ApiError("User is not authenticated with JIRA", ErrCode.ForbiddenUser);
        }
        const jiraResourceClient = await jiraClient.getClientForUrl(url);
        if (!jiraResourceClient) {
            throw new ApiError("User is not authenticated with this JIRA instance", ErrCode.ForbiddenUser);
        }
        const projectKey = JiraProjectConnection.getProjectKeyForUrl(url);
        if (!projectKey) {
            throw new ApiError("URL did not contain a valid project key", ErrCode.BadValue);
        }
        try {
            // Need to check that the user can access this.
            const project = await jiraResourceClient.getProject(projectKey);
            return project;
        } catch (ex) {
            throw new ApiError("Requested project was not found", ErrCode.ForbiddenUser);
        }
    }

    static async provisionConnection(roomId: string, userId: string, data: Record<string, unknown>, {as, intent, tokenStore, config}: ProvisionConnectionOpts) {
        if (!config.jira) {
            throw new ApiError('JIRA integration is not configured', ErrCode.DisabledFeature);
        }
        const validData = validateJiraConnectionState(data);
        log.info(`Attempting to provisionConnection for ${roomId} ${validData.url} on behalf of ${userId}`);
        const project = await this.assertUserHasAccessToProject(tokenStore,  userId, validData.url);
        const connection = new JiraProjectConnection(roomId, as, intent, validData, validData.url, tokenStore);
        // Fetch the project's id now, to support events that identify projects by id instead of url
        if (connection.state.id !== undefined && connection.state.id !== project.id) {
            log.warn(`Updating ID of project ${connection.projectKey} from ${connection.state.id} to ${project.id}`);
            connection.state.id = project.id;
        }
        await intent.underlyingClient.sendStateEvent(roomId, JiraProjectConnection.CanonicalEventType, connection.stateKey, validData);
        log.info(`Created connection via provisionConnection ${connection.toString()}`);
        return {connection};
    }

    static createConnectionForState(roomId: string, state: StateEvent<Record<string, unknown>>, {config, as, intent, tokenStore}: InstantiateConnectionOpts) {
        if (!config.jira) {
            throw Error('JIRA is not configured');
        }
        const connectionConfig = validateJiraConnectionState(state.content);
        return new JiraProjectConnection(roomId, as, intent, connectionConfig, state.stateKey, tokenStore);
    }

    public get projectId() {
        return this.state.id;
    }

    public get instanceOrigin() {
        return this.projectUrl?.host;
    }

    public get projectKey() {
        return this.projectUrl ? JiraProjectConnection.getProjectKeyForUrl(this.projectUrl) : undefined;
    }

    public static getProjectKeyForUrl(projectUrl: URL) {
        const parts = projectUrl?.pathname.split('/');
        return parts ? parts[parts.length - 1]?.toUpperCase() : undefined;
    }

    public get priority(): number {
        return this.state.priority || super.priority;
    }

    public toString() {
        return `JiraProjectConnection ${this.projectUrl || this.projectId}`;
    }

    public isInterestedInHookEvent(eventName: JiraAllowedEventsNames, interestedByDefault = false) {
        return !this.state.events ? interestedByDefault : this.state.events.includes(eventName);
    }

    public interestedInProject(project: JiraProject) {
        if (this.projectId === project.id) {
            return true;
        }
        if (this.instanceOrigin) {
            const url = new URL(project.self);
            return this.instanceOrigin === url.host && this.projectKey === project.key.toUpperCase();
        }
        return false;
    }

    public interestedInVersion(version: JiraVersion) {
        return this.projectId === version.projectId.toString();
    }

    /**
     * The URL of the project
     * @example https://test.atlassian.net/jira/software/c/projects/PLAY
     */
    private projectUrl?: URL;

    private readonly grantChecker: GrantChecker<{url: string}>;

    constructor(
        roomId: string,
        private readonly as: Appservice,
        private readonly intent: Intent,
        state: JiraProjectConnectionState,
        stateKey: string,
        private readonly tokenStore: UserTokenStore
    ) {
        super(
            roomId,
            stateKey,
            JiraProjectConnection.CanonicalEventType,
            state,
            intent.underlyingClient,
            JiraProjectConnection.botCommands,
            JiraProjectConnection.helpMessage,
            ["jira"],
            "!jira",
            "jira"
        );
        if (state.url) {
            this.projectUrl = new URL(state.url);
        } else if (state.id) {
            log.warn(`Legacy ID option in use, needs to be switched to 'url'`);
        } else {
            throw Error('State is missing both id and url, cannot create connection');
        }
        this.grantChecker = new JiraGrantChecker(as, tokenStore);
    }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return JiraProjectConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    protected validateConnectionState(content: unknown) {
        return validateJiraConnectionState(content);
    }

    public ensureGrant(sender?: string) {
        return this.grantChecker.assertConnectionGranted(this.roomId, {
            url: this.state.url,
        }, sender);
    }

    public async onJiraIssueCreated(data: JiraIssueEvent) {
        // NOTE This is the only event type that shouldn't be skipped if the state object is missing,
        //      for backwards compatibility with issue creation having been the only supported Jira event type,
        //      and a missing state object having been treated as wanting all events.
        if (!this.isInterestedInHookEvent('issue_created', true)) {
            return;
        }
        log.info(`onIssueCreated ${this.roomId} ${this.projectUrl || this.projectId} ${data.issue.id}`);

        const creator = data.issue.fields.creator;
        if (!creator) {
            throw Error('No creator field');
        }
        const url = generateJiraWebLinkFromIssue(data.issue);
        const content = `${creator.displayName} created a new JIRA issue [${data.issue.key}](${url}): "${data.issue.fields.summary}"`;
        await this.intent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            ...FormatUtil.getPartialBodyForJiraIssue(data.issue)
        });
    }

    public static getProvisionerDetails(botUserId: string) {
        return {
            service: "jira",
            eventType: JiraProjectConnection.CanonicalEventType,
            type: "JiraProject",
            botUserId: botUserId,
        }
    }

    public getProvisionerDetails(): JiraProjectResponseItem {
        return {
            ...JiraProjectConnection.getProvisionerDetails(this.intent.userId),
            id: this.connectionId,
            config: {
                ...this.state,
            },
        }
    }

    public static async getConnectionTargets(userId: string, tokenStore: UserTokenStore, config: BridgeConfigJira, filters: JiraTargetFilter = {}): Promise<JiraProjectConnectionTarget[]> {
        // Search for all projects under the user's control.
        const jiraUser = await tokenStore.getJiraForUser(userId, config.url);
        if (!jiraUser) {
            throw new ApiError("User is not authenticated with JIRA", ErrCode.ForbiddenUser);
        }

        if (!filters.instanceName) {
            const results: JiraProjectConnectionInstanceTarget[] = [];
            try {
                for (const resource of await jiraUser.getAccessibleResources()) {
                    results.push({
                        url: resource.url,
                        name: resource.name,
                    });
                }
            } catch (ex) {
                log.warn(`Failed to fetch accessible resources for ${userId}`, ex);
                throw new ApiError("Could not fetch accessible resources for JIRA user.", ErrCode.Unknown);
            }
            return results;
        }
        // If we have an instance, search under it.
        let resClient: HookshotJiraApi|null;
        try {
            resClient = await jiraUser.getClientForName(filters.instanceName);
        } catch (ex) {
            log.warn(`Failed to fetch client for ${filters.instanceName} for ${userId}`, ex);
            throw new ApiError("Could not fetch accessible resources for JIRA user.", ErrCode.Unknown);
        }
        if (!resClient) {
            throw new ApiError("Instance not known or not accessible to this user.", ErrCode.ForbiddenUser);
        }

        const allProjects: JiraProjectConnectionProjectTarget[] = [];
        try {
            for await (const project of resClient.getAllProjects(filters.search)) {
                allProjects.push({
                    state: {
                        id: project.id,
                        // Technically not the real URL, but good enough for hookshot!
                        url: `${resClient.resource.url}/projects/${project.key}`,
                    },
                    key: project.key,
                    name: project.name,
                });
            }
        } catch (ex) {
            log.warn(`Failed to fetch accessible projects for ${config.instanceName} / ${userId}`, ex);
            throw new ApiError("Could not fetch accessible projects for JIRA user.", ErrCode.Unknown);
        }
        return allProjects;
    }

    public async onJiraIssueUpdated(data: JiraIssueUpdatedEvent) {
        if (!this.isInterestedInHookEvent('issue_updated')) {
            return;
        }
        log.info(`onJiraIssueUpdated ${this.roomId} ${this.projectUrl || this.projectId} ${data.issue.id}`);
        const url = generateJiraWebLinkFromIssue(data.issue);
        let content = `${data.user.displayName} updated JIRA [${data.issue.key}](${url}): `;

        const changes = data.changelog.items.map((change) => `**${change.field}** changed from '${change.fromString || "not set"}' to '${change.toString || "not set"}'`);

        if (changes.length < 0) {
            // Empty changeset?
            log.warn(`Empty changeset, not sending message`);
            return;
        } else if (changes.length === 1) {
            content += changes[0];
        } else {
            content += `\n - ` + changes.join(`\n  - `);
        }

        await this.intent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            ...FormatUtil.getPartialBodyForJiraIssue(data.issue)
        });
    }

    public async onJiraVersionEvent(data: JiraVersionEvent) {
        if (!this.isInterestedInHookEvent(data.webhookEvent)) {
            return;
        }
        log.info(`onJiraVersionEvent ${this.roomId} ${this.projectUrl || this.projectId} ${data.webhookEvent}`);
        const url = generateJiraWebLinkFromVersion({
            ...data.version,
            projectId: data.version.projectId.toString(),
        });
        const action = data.webhookEvent.substring("version_".length);
        const content =
            `Version **${action}**` +
            (this.projectKey && this.projectUrl ? ` for project [${this.projectKey}](${this.projectUrl})` : "") +
            `: [${data.version.name}](${url}) (_${data.version.description}_)`;

        await this.intent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
        });
    }

    private async getUserClientForProject(userId: string) {
        if (!this.projectUrl) {
            throw new CommandError("No-resource-origin", "Room is configured with an ID and not a URL, cannot determine correct JIRA client");
        }
        const jiraClient = await this.tokenStore.getJiraForUser(userId, this.projectUrl.toString());
        if (!jiraClient) {
            throw new NotLoggedInError();
        }
        const jiraProjectClient = await jiraClient.getClientForUrl(this.projectUrl);
        if (!jiraProjectClient) {
            throw new CommandError("No-resource", "You do not have permission to manage issues for this JIRA org");
        }
        return jiraProjectClient;
    }

    @botCommand("create", "Create an issue for this project", ["type", "title"], ["description", "labels"], true)
    public async onCreateIssue(userId: string, type: string, title: string, description?: string, labels?: string) {
        const api = await this.getUserClientForProject(userId);
        const keyOrId = this.projectKey || this.projectId;
        if (!keyOrId) {
            throw Error('Neither Key or ID are specified');
        }
        const project = await api.getProject(keyOrId);
        if (!project.issueTypes || project.issueTypes.length === 0) {
            throw new CommandError("project has no issue types", "Cannot create issue, project has no issue types");
        }
        const issueTypeId = project.issueTypes.find((issueType) => issueType.name.toLowerCase() === type.toLowerCase())?.id;
        if (!issueTypeId) {
            const content = project.issueTypes.map((t) => t.name).join(', ');
            throw new CommandError("invalid-issuetype", `You must specify a valid issue type (one of ${content}). E.g. ${this.commandPrefix} create ${project.issueTypes[0].name}`);
        }
        log.info(`Creating new issue on behalf of ${userId}`);
        let result: JiraApi.JsonResponse;
        try {
            result = await api.addNewIssue({
                //update: {},
                fields: {
                    "summary": title,
                    "project": {
                        "key": this.projectKey,
                    },
                    "issuetype": {
                        id: issueTypeId,
                    },
                    ...( description ? {description} : undefined),
                    ...( labels ? {"labels": labels.split(",")} : undefined),
                }
            });
            if (!result) {
                throw Error('Invalid result');
            }
        } catch (ex) {
            log.warn("Failed to create JIRA issue:", ex);
            throw new CommandError(ex.message, "Failed to create JIRA issue");
        }

        const link = generateJiraWebLinkFromIssue({self: this.projectUrl?.toString() || result.self, key: result.key as string});
        const content = `Created JIRA issue ${result.key}: [${link}](${link})`;
        return this.intent.sendEvent(this.roomId,{
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html"
        });
    }

    @botCommand("issue-types", "Get issue types for this project", [], [], true)
    public async getIssueTypes(userId: string) {
        const api = await this.getUserClientForProject(userId);
        let result: JiraProject;
        try {
            const keyOrId = this.projectKey || this.projectId;
            if (!keyOrId) {
                throw Error('Neither Key or ID are specified');
            }
            result = await api.getProject(keyOrId);
        } catch (ex) {
            log.warn("Failed to get issue types:", ex);
            throw new CommandError(ex.message, "Failed to get issue types");
        }

        const content = `Issue types: ${(result.issueTypes || []).map((t) => t.name).join(', ')}`;
        return this.intent.sendEvent(this.roomId,{
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html"
        });
    }

    @botCommand("assign", "Assign an issue to a user", ["issueKey", "user"], [], true)
    public async onAssignIssue(userId: string, issueKey: string, user: string) {
        const api = await this.getUserClientForProject(userId);
        try {
            await api.getIssue(issueKey);
        } catch (ex) {
            log.warn(`Failed to find issue`, ex);
            throw new CommandError(ex.message, "Failed to find issue");
        }

        log.info(`Assinging issue on behalf of ${userId}`);
        let searchForUser = await api.searchUsers({query: user, maxResults: 1});
        if (searchForUser.length === 0) {
            searchForUser = await api.searchUsers({username: user, maxResults: 1});
            if (searchForUser.length === 0) {
                throw new CommandError("not-found", `Could not find a user matching '${user}'`);
            }
        }
        await api.updateAssigneeWithId(issueKey, searchForUser[0].accountId);
    }

    public async onRemove() {
        log.info(`Removing ${this.toString()} for ${this.roomId}`);
        await this.grantChecker.ungrantConnection(this.roomId, {
            url: this.state.url,
        });
        // Do a sanity check that the event exists.
        try {
            await this.intent.underlyingClient.getRoomStateEvent(this.roomId, JiraProjectConnection.CanonicalEventType, this.stateKey);
            await this.intent.underlyingClient.sendStateEvent(this.roomId, JiraProjectConnection.CanonicalEventType, this.stateKey, { disabled: true });
        } catch (ex) {
            await this.intent.underlyingClient.getRoomStateEvent(this.roomId, JiraProjectConnection.LegacyCanonicalEventType, this.stateKey);
            await this.intent.underlyingClient.sendStateEvent(this.roomId, JiraProjectConnection.LegacyCanonicalEventType, this.stateKey, { disabled: true });
        }
    }

    public async provisionerUpdateConfig(userId: string, config: Record<string, unknown>) {
        // Apply previous state to the current config, as provisioners might not return "unknown" keys.
        config = { ...config, ...this.state };
        const validatedConfig = validateJiraConnectionState(config);
        if (!validatedConfig.id) {
            await this.updateProjectId(validatedConfig, userId);
        }
        await this.intent.underlyingClient.sendStateEvent(this.roomId, JiraProjectConnection.CanonicalEventType, this.stateKey, validatedConfig);
        this.state = validatedConfig;
    }

    private async updateProjectId(validatedConfig: JiraProjectConnectionState, userIdForAuth: string) {
        const jiraClient = await this.tokenStore.getJiraForUser(userIdForAuth);
        if (!jiraClient) {
            log.warn(`Cannot update JIRA project ID via user ${userIdForAuth} who is not authenticted with JIRA`);
            return;
        }
        const url = new URL(validatedConfig.url);
        const jiraResourceClient = await jiraClient.getClientForUrl(url);
        if (!jiraResourceClient) {
            log.warn(`Cannot update JIRA project ID via user ${userIdForAuth} who is not authenticated with this JIRA instance`);
            return;
        }
        const projectKey = JiraProjectConnection.getProjectKeyForUrl(url);
        if (projectKey) {
            const project = await jiraResourceClient.getProject(projectKey);
            validatedConfig.id = project.id;
        }
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(JiraProjectConnection.prototype as any, CommandConnection.prototype as any);
JiraProjectConnection.helpMessage = res.helpMessage;
JiraProjectConnection.botCommands = res.botCommands;
