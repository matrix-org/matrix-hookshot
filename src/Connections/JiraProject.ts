import { IConnection, IConnectionState } from "./IConnection";
import { Appservice } from "matrix-bot-sdk";
import LogWrapper from "../LogWrapper";
import { JiraIssueEvent, JiraIssueUpdatedEvent } from "../Jira/WebhookTypes";
import { FormatUtil } from "../FormatUtil";
import markdownit from "markdown-it";
import { generateJiraWebLinkFromIssue } from "../Jira";
import { JiraProject } from "../Jira/Types";
import { botCommand, BotCommands, compileBotCommands } from "../BotCommands";
import { MatrixEvent, MatrixMessageContent } from "../MatrixEvent";
import { CommandConnection } from "./CommandConnection";
import { UserTokenStore } from "../UserTokenStore";
import { CommandError, NotLoggedInError } from "../errors";
import { ApiError, ErrCode } from "../api";
import JiraApi from "jira-client";

type JiraAllowedEventsNames = "issue.created";
const JiraAllowedEvents: JiraAllowedEventsNames[] = ["issue.created"];
export interface JiraProjectConnectionState extends IConnectionState {
    // legacy field, prefer url
    id?: string;
    url?: string;
    events?: JiraAllowedEventsNames[],
    commandPrefix?: string;
}

function validateJiraConnectionState(state: JiraProjectConnectionState) {
    const {url, commandPrefix, events, priority} = state as JiraProjectConnectionState;
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
    if (events?.find((ev) => !JiraAllowedEvents.includes(ev))?.length) {
        throw new ApiError(`'events' can only contain ${JiraAllowedEvents.join(", ")}`, ErrCode.BadValue);
    }
    return {url, commandPrefix, events, priority};
}

const log = new LogWrapper("JiraProjectConnection");
const md = new markdownit();

/**
 * Handles rooms connected to a github repo.
 */
export class JiraProjectConnection extends CommandConnection implements IConnection {


    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.jira.project";
    static readonly LegacyCanonicalEventType = "uk.half-shot.matrix-github.jira.project";

    static readonly EventTypes = [
        JiraProjectConnection.CanonicalEventType,
        JiraProjectConnection.LegacyCanonicalEventType,
    ];
    static botCommands: BotCommands;
    static helpMessage: (cmdPrefix?: string) => MatrixMessageContent;

    static async provisionConnection(roomId: string, userId: string, data: Record<string, unknown>, as: Appservice, tokenStore: UserTokenStore) {
        const validData = validateJiraConnectionState(data);
        log.info(`Attempting to provisionConnection for ${roomId} ${validData.url} on behalf of ${userId}`);
        const jiraClient = await tokenStore.getJiraForUser(userId, validData.url);
        if (!jiraClient) {
            throw new ApiError("User is not authenticated with JIRA", ErrCode.ForbiddenUser);
        }
        const jiraResourceClient = await jiraClient.getClientForUrl(new URL(validData.url));
        if (!jiraResourceClient) {
            throw new ApiError("User is not authenticated with this JIRA instance", ErrCode.ForbiddenUser);
        }
        const connection = new JiraProjectConnection(roomId, as, data, validData.url, tokenStore);
        log.debug(`projectKey for ${validData.url} is ${connection.projectKey}`);
        if (!connection.projectKey) {
            throw Error('Expected projectKey to be defined');
        }
        try {
            // Just need to check that the user can access this.
            await jiraResourceClient.getProject(connection.projectKey);
        } catch (ex) {
            throw new ApiError("Requested project was not found", ErrCode.ForbiddenUser);
        }
        log.info(`Created connection via provisionConnection ${connection.toString()}`);
        return {stateEventContent: validData, connection};
    }
    
    public get projectId() {
        return this.state.id;
    }

    public get instanceOrigin() {
        return this.projectUrl?.host;
    }

    public get projectKey() {
        const parts = this.projectUrl?.pathname.split('/');
        return parts ? parts[parts.length - 1]?.toUpperCase() : undefined;
    }

    public get priority(): number {
        return this.state.priority || super.priority;
    }

    public toString() {
        return `JiraProjectConnection ${this.projectId || this.projectUrl}`;
    }

    public isInterestedInHookEvent(eventName: string) {
        return !this.state.events || this.state.events?.includes(eventName as JiraAllowedEventsNames);
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

    /**
     * The URL of the project 
     * @example https://test.atlassian.net/jira/software/c/projects/PLAY
     */
    private projectUrl?: URL;

    constructor(roomId: string,
        private readonly as: Appservice,
        private state: JiraProjectConnectionState,
        stateKey: string,
        private readonly tokenStore: UserTokenStore,) {
            super(
                roomId,
                stateKey,
                JiraProjectConnection.CanonicalEventType,
                as.botClient,
                JiraProjectConnection.botCommands,
                JiraProjectConnection.helpMessage,
                state.commandPrefix || "!jira",
                "jira"
            );
            if (state.url) {
                this.projectUrl = new URL(state.url);
            } else if (state.id) {
                log.warn(`Legacy ID option in use, needs to be switched to 'url'`);
            } else {
                throw Error('State is missing both id and url, cannot create connection');
            }
            
        }

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return JiraProjectConnection.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public async onStateUpdate(event: MatrixEvent<unknown>) {
        const validatedConfig = validateJiraConnectionState(event.content as JiraProjectConnectionState);
        this.state = validatedConfig;
    }

    public async onJiraIssueCreated(data: JiraIssueEvent) {
        log.info(`onIssueCreated ${this.roomId} ${this.projectId} ${data.issue.id}`);

        const creator = data.issue.fields.creator;
        if (!creator) {
            throw Error('No creator field');
        }
        const url = generateJiraWebLinkFromIssue(data.issue);
        const content = `${creator.displayName} created a new JIRA issue [${data.issue.key}](${url}): "${data.issue.fields.summary}"`;
        await this.as.botIntent.sendEvent(this.roomId, {
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
            // TODO: Add ability to configure the bot per connnection type.
            botUserId: botUserId,
        }
    }

    public getProvisionerDetails() {
        return {
            ...JiraProjectConnection.getProvisionerDetails(this.as.botUserId),
            id: this.connectionId,
            config: {
                ...this.state,
            },
        }
    }
    
    public async onJiraIssueUpdated(data: JiraIssueUpdatedEvent) {
        log.info(`onJiraIssueUpdated ${this.roomId} ${this.projectId} ${data.issue.id}`);
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
        
        await this.as.botIntent.sendEvent(this.roomId, {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.renderInline(content),
            format: "org.matrix.custom.html",
            ...FormatUtil.getPartialBodyForJiraIssue(data.issue)
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
        return this.as.botIntent.sendEvent(this.roomId,{
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
        return this.as.botIntent.sendEvent(this.roomId,{
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
        // Do a sanity check that the event exists.
        try {
            await this.as.botClient.getRoomStateEvent(this.roomId, JiraProjectConnection.CanonicalEventType, this.stateKey);
            await this.as.botClient.sendStateEvent(this.roomId, JiraProjectConnection.CanonicalEventType, this.stateKey, { disabled: true });
        } catch (ex) {
            await this.as.botClient.getRoomStateEvent(this.roomId, JiraProjectConnection.LegacyCanonicalEventType, this.stateKey);
            await this.as.botClient.sendStateEvent(this.roomId, JiraProjectConnection.LegacyCanonicalEventType, this.stateKey, { disabled: true });
        }
    }

    public async provisionerUpdateConfig(userId: string, config: Record<string, unknown>) {
        const validatedConfig = validateJiraConnectionState(config);
        await this.as.botClient.sendStateEvent(this.roomId, JiraProjectConnection.CanonicalEventType, this.stateKey, validatedConfig);
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(JiraProjectConnection.prototype as any, CommandConnection.prototype as any);
JiraProjectConnection.helpMessage = res.helpMessage;
JiraProjectConnection.botCommands = res.botCommands;