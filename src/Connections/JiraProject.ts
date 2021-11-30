import { IConnection } from "./IConnection";
import { Appservice } from "matrix-bot-sdk";
import LogWrapper from "../LogWrapper";
import { CommentProcessor } from "../CommentProcessor";
import { MessageSenderClient } from "../MatrixSender"
import { JiraIssueEvent, JiraIssueUpdatedEvent } from "../Jira/WebhookTypes";
import { FormatUtil } from "../FormatUtil";
import markdownit from "markdown-it";
import { generateJiraWebLinkFromIssue } from "../Jira";
import { JiraProject } from "../Jira/Types";
import { botCommand, BotCommands, compileBotCommands } from "../BotCommands";
import { MatrixMessageContent } from "../MatrixEvent";
import { CommandConnection } from "./CommandConnection";
import { UserTokenStore } from "../UserTokenStore";
import { CommandError, NotLoggedInError } from "../errors";
import JiraApi from "jira-client";

type JiraAllowedEventsNames = "issue.created";
const JiraAllowedEvents: JiraAllowedEventsNames[] = ["issue.created"];
export interface JiraProjectConnectionState {
    // legacy field, prefer url
    id?: string;
    url?: string;
    events?: JiraAllowedEventsNames[],
    commandPrefix?: string;
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

    static getTopicString(authorName: string, state: string) {
        `Author: ${authorName} | State: ${state === "closed" ? "closed" : "open"}`
    }
    
    public get projectId() {
        return this.state.id;
    }

    public get instanceOrigin() {
        return this.projectUrl?.origin;
    }

    public get projectKey() {
        const parts =  this.projectUrl?.pathname.split('/');
        return parts ? parts[parts.length - 1] : undefined;
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
            return this.instanceOrigin === url.origin && this.projectKey === project.key;
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
        private readonly stateKey: string,
        private readonly commentProcessor: CommentProcessor,
        private readonly messageClient: MessageSenderClient,
        private readonly tokenStore: UserTokenStore,) {
            super(
                roomId,
                as.botClient,
                JiraProjectConnection.botCommands,
                JiraProjectConnection.helpMessage,
                state.commandPrefix || "!jira"
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
        const jiraClient = await this.tokenStore.getJiraForUser(userId);
        if (!jiraClient) {
            throw new NotLoggedInError();
        }
        if (!this.projectUrl) {
            throw new CommandError("No-resource-origin", "Room is configured with an ID and not a URL, cannot determine correct JIRA client");
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
                    ...( description ? {"description": {
                        "type": "doc",
                        "version": 1,
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [
                                    {
                                        "text": description,
                                        "type": "text"
                                    }
                                ]
                            }
                        ]
                    }} : undefined),
                    ...( labels ? {"labels": labels.split(",")} : undefined),
                }
            })
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
        log.info(`Creating new issue on behalf of ${userId}`);
        let result: JiraProject;
        try {
            const keyOrId = this.projectKey || this.projectId;
            if (!keyOrId) {
                throw Error('Neither Key or ID are specified');
            }
            result = await api.getProject(keyOrId);
        } catch (ex) {
            log.warn("Failed to get issue types:", ex);
            throw new CommandError(ex.message, "Failed to create JIRA issue");
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
        const searchForUser = await api.searchUsers({query: user, maxResults: 1, includeInactive: false, includeActive: true, username: ""});
        if (searchForUser.length === 0) {
            throw new CommandError("not-found", `Could not find a user matching '${user}'`);
        }
        await api.updateAssigneeWithId(issueKey, searchForUser[0].accountId);
    }

    public toString() {
        return `JiraProjectConnection ${this.projectId || this.projectUrl}`;
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res = compileBotCommands(JiraProjectConnection.prototype as any, CommandConnection.prototype as any);
JiraProjectConnection.helpMessage = res.helpMessage;
JiraProjectConnection.botCommands = res.botCommands;