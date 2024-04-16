import { GitHubRepoConnection, GitHubRepoConnectionState } from "../../src/Connections/GithubRepo"
import { GithubInstance } from "../../src/github/GithubInstance";
import { createMessageQueue } from "../../src/MessageQueue";
import { UserTokenStore } from "../../src/UserTokenStore";
import { DefaultConfig } from "../../src/config/Defaults";
import { AppserviceMock } from "../utils/AppserviceMock";
import { ApiError, ErrCode, ValidatorApiError } from "../../src/api";
import { expect } from "chai";
import { IntentMock } from "../utils/IntentMock";

const ROOM_ID = "!foo:bar";

const GITHUB_ORG_REPO = {
	org: "a-fake-org",
	repo: "a-fake-repo",
};

const GITHUB_ISSUE = {
	id: 1234,
	number: 1234,
	user: {
		login: "alice"
	},
	html_url: `https://github.com/${GITHUB_ORG_REPO.org}/${GITHUB_ORG_REPO.repo}/issues/1234`,
	title: "My issue",
	assignees: []
};

const GITHUB_ISSUE_CREATED_PAYLOAD = {
	action: "opened",
	issue: GITHUB_ISSUE,
	repository: {
		full_name: `${GITHUB_ORG_REPO.org}/${GITHUB_ORG_REPO.repo}`,
		id: 1234,
		html_url: `https://github.com/${GITHUB_ORG_REPO.org}/${GITHUB_ORG_REPO.repo}`,
	}
};

function createConnection(state: Record<string, unknown> = {}, isExistingState=false) {
	const mq = createMessageQueue();
	mq.subscribe('*');
	const as = AppserviceMock.create();
	const intent = as.getIntentForUserId('@github:example.test');
	const githubInstance = new GithubInstance("foo", "bar", new URL("https://github.com"));
	const connection = new GitHubRepoConnection(
		ROOM_ID,
		as,
		intent,
		GitHubRepoConnection.validateState({
			org: "a-fake-org",
			repo: "a-fake-repo",
			...state,
		}, isExistingState),
		{} as UserTokenStore,
		"state_key",
		githubInstance,
		// Default config always contains GitHub
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		DefaultConfig.github!
	);
	return {connection, intent: intent as IntentMock};
}

describe("GitHubRepoConnection", () => {
	describe("validateState", () => {
		it("can validate a completes state config", () => {
			GitHubRepoConnection.validateState({
				org: "foo",
				repo: "bar",
				enableHooks: ["issue", "pull_request", "release"],
				commandPrefix: "!foo",
				showIssueRoomLink: true,
				prDiff: {
					enabled: true,
					maxLines: 55
				},
				includingLabels: ["this", "and", "that"],
				excludingLabels: ["not", "those"],
				hotlinkIssues: {
					prefix: "foo"
				},
				newIssue: {
					labels: ["this", "and", "that"]
				}
			} as GitHubRepoConnectionState as unknown as Record<string, unknown>);
		});
		it("will convert ignoredHooks for existing state", () => {
			const state = GitHubRepoConnection.validateState({
				org: "foo",
				repo: "bar",
				ignoreHooks: ["issue"],
				enableHooks: ["issue", "pull_request", "release"],
				commandPrefix: "!foo",
			} as GitHubRepoConnectionState as unknown as Record<string, unknown>, true);
			expect(state.enableHooks).to.not.contain('issue');
		});
		it("will disallow invalid state", () => {
			try {
				GitHubRepoConnection.validateState({
					org: "foo",
					repo: false,
				});
			} catch (ex) {
				if (ex instanceof ValidatorApiError === false || ex.errcode !== ErrCode.BadValue) {
					throw ex;
				}
			}
		});
		it("will disallow enabledHooks to contains invalid enums if this is new state", () => {
			try {
				GitHubRepoConnection.validateState({
					org: "foo",
					repo: "bar",
					enabledHooks: ["not-real"],
				}, false);
			} catch (ex) {
				if (ex instanceof ApiError === false || ex.errcode !== ErrCode.BadValue) {
					throw ex;
				}
			}
		});
		it("will allow enabledHooks to contains invalid enums if this is old state", () => {
			GitHubRepoConnection.validateState({
				org: "foo",
				repo: "bar",
				enabledHooks: ["not-real"],
			}, true);
		});
	});
	describe("onIssueCreated", () => {
		it("will handle a simple issue", async () => {
			const { connection, intent } = createConnection();
			await connection.onIssueCreated(GITHUB_ISSUE_CREATED_PAYLOAD as never);
			// Statement text.
			intent.expectEventBodyContains('**alice** created new issue', 0);
			intent.expectEventBodyContains(GITHUB_ISSUE_CREATED_PAYLOAD.issue.html_url, 0);
			intent.expectEventBodyContains(GITHUB_ISSUE_CREATED_PAYLOAD.issue.title, 0);
		});
		it("will handle assignees on issue creation", async () => {
			const { connection, intent } = createConnection();
			await connection.onIssueCreated({
				...GITHUB_ISSUE_CREATED_PAYLOAD,
				issue: {
					...GITHUB_ISSUE,
					assignees: [{ login: 'alice'}, { login: 'bob'}]
				}
			} as never);
			// Statement text.
			intent.expectEventBodyContains('**alice** created new issue', 0);
			intent.expectEventBodyContains('"My issue" assigned to alice, bob', 0);
			intent.expectEventBodyContains(GITHUB_ISSUE_CREATED_PAYLOAD.issue.html_url, 0);
			intent.expectEventBodyContains(GITHUB_ISSUE_CREATED_PAYLOAD.issue.title, 0);
		});
		it("will filter out issues not matching includingLabels.", async () => {
			const { connection, intent } = createConnection({
				includingLabels: ["include-me"]
			});
			await connection.onIssueCreated({
				...GITHUB_ISSUE_CREATED_PAYLOAD,
				issue: {
					...GITHUB_ISSUE,
					labels: [{
						name: "foo",
					}],
				}
			} as never);
			// ..or issues with no labels
			await connection.onIssueCreated(GITHUB_ISSUE_CREATED_PAYLOAD as never);
			intent.expectNoEvent();
		});
		it("will filter out issues matching excludingLabels.", async () => {
			const { connection, intent } = createConnection({
				excludingLabels: ["exclude-me"]
			});
			await connection.onIssueCreated({
				...GITHUB_ISSUE_CREATED_PAYLOAD,
				issue: {
					...GITHUB_ISSUE,
					labels: [{
						name: "exclude-me",
					}],
				}
			} as never);
			intent.expectNoEvent();
		});
		it("will include issues matching includingLabels.", async () => {
			const { connection, intent } = createConnection({
				includingIssues: ["include-me"]
			});
			await connection.onIssueCreated({
				...GITHUB_ISSUE_CREATED_PAYLOAD,
				issue: {
					...GITHUB_ISSUE,
					labels: [{
						name: "include-me",
					}],
				}
			} as never);
			intent.expectEventBodyContains('**alice** created new issue', 0);
		});
	});
});
