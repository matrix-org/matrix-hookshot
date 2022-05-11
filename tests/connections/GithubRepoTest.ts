import { GitHubRepoConnection, GitHubRepoConnectionState } from "../../src/Connections/GithubRepo"
import { GithubInstance } from "../../src/Github/GithubInstance";
import { createMessageQueue } from "../../src/MessageQueue";
import { UserTokenStore } from "../../src/UserTokenStore";
import { DefaultConfig } from "../../src/Config/Defaults";
import { AppserviceMock } from "../utils/AppserviceMock";
import { ApiError, ErrCode, ValidatorApiError } from "../../src/api";

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
	const mq = createMessageQueue({
		monolithic: true
	});
	mq.subscribe('*');
	const as = AppserviceMock.create();
	const githubInstance = new GithubInstance("foo", "bar");
	const connection = new GitHubRepoConnection(
		ROOM_ID,
		as,
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
	return {connection, as};
}

describe("GitHubRepoConnection", () => {
	describe("validateState", () => {
		it("can validate a completes state config", () => {
			GitHubRepoConnection.validateState({
				org: "foo",
				repo: "bar",
				ignoreHooks: ["issue", "pull_request", "release"],
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
		it("will disallow ignoreHooks to contains invalid enums if this is new state", () => {
			try {
				GitHubRepoConnection.validateState({
					org: "foo",
					repo: "bar",
					ignoreHooks: ["issue", "pull_request", "release", "not-real"],
				}, false);
			} catch (ex) {
				if (ex instanceof ApiError === false || ex.errcode !== ErrCode.BadValue) {
					throw ex;
				}
			}
		});
		it("will allow ignoreHooks to contains invalid enums if this is old state", () => {
			GitHubRepoConnection.validateState({
				org: "foo",
				repo: "bar",
				ignoreHooks: ["issue", "pull_request", "release", "not-real"],
			}, true);
		});
	});
	describe("onIssueCreated", () => {
		it("will handle a simple issue", async () => {
			const { connection, as } = createConnection();
			await connection.onIssueCreated(GITHUB_ISSUE_CREATED_PAYLOAD as never);
			// Statement text.
			as.botIntent.expectEventBodyContains('**alice** created new issue', 0);
			as.botIntent.expectEventBodyContains(GITHUB_ISSUE_CREATED_PAYLOAD.issue.html_url, 0);
			as.botIntent.expectEventBodyContains(GITHUB_ISSUE_CREATED_PAYLOAD.issue.title, 0);
		});
		it("will filter out issues not matching includingLabels.", async () => {
			const { connection, as } = createConnection({
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
			as.botIntent.expectNoEvent();
		});
		it("will filter out issues matching excludingLabels.", async () => {
			const { connection, as } = createConnection({
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
			as.botIntent.expectNoEvent();
		});
		it("will include issues matching includingLabels.", async () => {
			const { connection, as } = createConnection({
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
			as.botIntent.expectEventBodyContains('**alice** created new issue', 0);
		});
	});
});