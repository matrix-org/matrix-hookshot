import { createMessageQueue } from "../../src/MessageQueue";
import { UserTokenStore } from "../../src/UserTokenStore";
import { AppserviceMock } from "../utils/AppserviceMock";
import { ApiError, ErrCode, ValidatorApiError } from "../../src/api";
import { GitLabRepoConnection, GitLabRepoConnectionState } from "../../src/Connections";
import { expect } from "chai";
import { BridgeConfigGitLab } from "../../src/config/Config";
import { IBridgeStorageProvider } from "../../src/Stores/StorageProvider";
import { IntentMock } from "../utils/IntentMock";

const ROOM_ID = "!foo:bar";

const GITLAB_ORG_REPO = {
	org: "a-fake-org",
	repo: "a-fake-repo",
};

const GITLAB_MR = {
	state: "opened",
	iid: 1234,
	url: `https://gitlab.example.com/${GITLAB_ORG_REPO.org}/${GITLAB_ORG_REPO.repo}/issues/1234`,
	title: "My MR",
};

const GITLAB_USER = {
	name: "Alice",
	username: "alice",
};

const GITLAB_PROJECT = {
	path_with_namespace: `${GITLAB_ORG_REPO.org}/${GITLAB_ORG_REPO.repo}`,
	web_url: `https://gitlab.example.com/${GITLAB_ORG_REPO.org}/${GITLAB_ORG_REPO.repo}`,
};

const GITLAB_ISSUE_CREATED_PAYLOAD = {
    object_kind: "merge_request",
	user: GITLAB_USER,
	object_attributes: GITLAB_MR,
	project: GITLAB_PROJECT,
};

const GITLAB_MR_COMMENT = {
	'object_kind': 'note',
	'event_type': 'note',
	'merge_request': GITLAB_MR,
	'object_attributes': {
        'discussion_id': '6babfc4ad3be2355db286ed50be111a5220d5751',
        'note': 'I am starting a new thread',
        'noteable_type': 'MergeRequest',
        'url': 'https://gitlab.com/tadeuszs/my-awesome-project/-/merge_requests/2#note_1455087141'
	},
	'project': GITLAB_PROJECT,
	'user': GITLAB_USER,
};

const COMMENT_DEBOUNCE_MS = 25;

function createConnection(state: Record<string, unknown> = {}, isExistingState=false): { connection: GitLabRepoConnection, intent: IntentMock } {
	const mq = createMessageQueue();
	mq.subscribe('*');
	const as = AppserviceMock.create();
	const intent = as.getIntentForUserId('@gitlab:example.test');
	const connection = new GitLabRepoConnection(
		ROOM_ID,
		"state_key",
		as,
		{
			commentDebounceMs: COMMENT_DEBOUNCE_MS,
		} as BridgeConfigGitLab,
		intent,
		GitLabRepoConnection.validateState({
			instance: "bar",
			path: "foo",
			...state,
		}, isExistingState),
		{} as UserTokenStore,
		{
			url: "https://gitlab.example.com"
		},
		{
			setGitlabDiscussionThreads: () => Promise.resolve(),
			getGitlabDiscussionThreads: () => Promise.resolve([]),
		} as unknown as IBridgeStorageProvider,
	);
	return {connection, intent};
}

async function waitForDebouncing(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, COMMENT_DEBOUNCE_MS * 2));
}

describe("GitLabRepoConnection", () => {
	describe("validateState", () => {
		it("can validate a completes state config", () => {
			GitLabRepoConnection.validateState({
				instance: "foo",
				path: "bar/baz",
				enableHooks: [
					"merge_request.open",
					"merge_request.close",
					"merge_request.merge",
					"merge_request.review",
					"merge_request.review.comments",
					"merge_request",
					"tag_push",
					"push",
					"wiki",
					"release",
					"release.created",
				],
				commandPrefix: "!gl",
				pushTagsRegex: ".*",
				includingLabels: ["me"],
				excludingLabels: ["but-not-me"],
			} as GitLabRepoConnectionState as unknown as Record<string, unknown>);
		});
		it("will convert ignoredHooks for existing state", () => {
			const state = GitLabRepoConnection.validateState({
				instance: "foo",
				path: "bar/baz",
				ignoreHooks: [
					"merge_request",
				],
				commandPrefix: "!gl",
			} as GitLabRepoConnectionState as unknown as Record<string, unknown>, true);
			expect(state.enableHooks).to.not.contain('merge_request');
		});
		it("will disallow invalid state", () => {
			try {
				GitLabRepoConnection.validateState({
					instance: "foo",
					path: 123,
				});
			} catch (ex) {
				if (ex instanceof ValidatorApiError === false || ex.errcode !== ErrCode.BadValue) {
					throw ex;
				}
			}
		});
		it("will disallow enabledHooks to contains invalid enums if this is new state", () => {
			try {
				GitLabRepoConnection.validateState({
					instance: "bar",
					path: "foo",
					enabledHooks: ["not-real"],
				}, false);
			} catch (ex) {
				if (ex instanceof ApiError === false || ex.errcode !== ErrCode.BadValue) {
					throw ex;
				}
			}
		});
		it("will allow enabledHooks to contains invalid enums if this is old state", () => {
			GitLabRepoConnection.validateState({
				instance: "bar",
				path: "foo",
				enabledHooks: ["not-real"],
			}, true);
		});
	});
	describe("onCommentCreated", () => {
		it("will handle an MR comment", async () => {
			const { connection, intent } = createConnection();
			await connection.onCommentCreated(GITLAB_MR_COMMENT as never);
			await waitForDebouncing();
			intent.expectEventMatches(
				(ev: any) => ev.content.body.includes('**Alice** commented on MR'),
				'event body indicates MR comment'
			);
		});
		it("will debounce MR comments", async () => {
			const { connection, intent } = createConnection();
			await connection.onCommentCreated(GITLAB_MR_COMMENT as never);
			await connection.onCommentCreated({
				...GITLAB_MR_COMMENT,
				'object_attributes': {
					...GITLAB_MR_COMMENT.object_attributes,
					'discussion_id': 'fa5d',
					'note': 'different comment',
				},
			} as never);
			await waitForDebouncing();
			expect(intent.sentEvents.length).to.equal(1);
			intent.expectEventMatches(
				(ev: any) => ev.content.body.includes('with 2 comments'),
				'one event sent for both comments',
				0,
			);
		});
		it("will add new comments in a Matrix thread", async () => {
			const { connection, intent } = createConnection();
			await connection.onCommentCreated(GITLAB_MR_COMMENT as never);
			await waitForDebouncing();
			await connection.onCommentCreated(GITLAB_MR_COMMENT as never);
			await waitForDebouncing();
			expect(intent.sentEvents.length).to.equal(2);
			intent.expectEventMatches(
				(ev: any) => ev.content['m.relates_to'].event_id === 'event_0',
				'one event sent for both comments',
				1,
			);
		});
		it("will correctly map new comments to aggregated discussions", async () => {
			const { connection, intent } = createConnection();
			await connection.onCommentCreated({
				...GITLAB_MR_COMMENT,
				'object_attributes': {
					...GITLAB_MR_COMMENT.object_attributes,
					'discussion_id': 'disc1',
				},
			} as never);
			await connection.onCommentCreated({
				...GITLAB_MR_COMMENT,
				'object_attributes': {
					...GITLAB_MR_COMMENT.object_attributes,
					'discussion_id': 'disc2',
				},
			} as never);
			await waitForDebouncing();
			expect(intent.sentEvents.length).to.equal(1);

			await connection.onCommentCreated({
				...GITLAB_MR_COMMENT,
				'object_attributes': {
					...GITLAB_MR_COMMENT.object_attributes,
					'discussion_id': 'disc1',
				},
			} as never);
			await waitForDebouncing();
			expect(intent.sentEvents.length).to.equal(2);
			intent.expectEventMatches(
				(ev: any) => ev.content['m.relates_to'].event_id === 'event_0',
				'disc1 reply goes to existing thread',
				1
			);

			await connection.onCommentCreated({
				...GITLAB_MR_COMMENT,
				'object_attributes': {
					...GITLAB_MR_COMMENT.object_attributes,
					'discussion_id': 'disc2',
				},
			} as never);
			await waitForDebouncing();
			expect(intent.sentEvents.length).to.equal(3);
			intent.expectEventMatches(
				(ev: any) => ev.content['m.relates_to'].event_id === 'event_0',
				'disc2 reply also goes to existing thread',
				2
			);
		});
	});
	describe("onIssueCreated", () => {
		it("will handle a simple issue", async () => {
			const { connection, intent } = createConnection();
			await connection.onMergeRequestOpened(GITLAB_ISSUE_CREATED_PAYLOAD as never);
			// Statement text.
			intent.expectEventBodyContains('**alice** opened a new MR', 0);
			intent.expectEventBodyContains(GITLAB_ISSUE_CREATED_PAYLOAD.object_attributes.url, 0);
			intent.expectEventBodyContains(GITLAB_ISSUE_CREATED_PAYLOAD.object_attributes.title, 0);
		});
		it("will filter out issues not matching includingLabels.", async () => {
			const { connection, intent } = createConnection({
				includingLabels: ["include-me"]
			});
			await connection.onMergeRequestOpened({
				...GITLAB_ISSUE_CREATED_PAYLOAD,
				labels: [{
					title: "foo",
				}],
			} as never);
			// ..or issues with no labels
			await connection.onMergeRequestOpened(GITLAB_ISSUE_CREATED_PAYLOAD as never);
			intent.expectNoEvent();
		});
		it("will filter out issues matching excludingLabels.", async () => {
			const { connection, intent } = createConnection({
				excludingLabels: ["exclude-me"]
			});
			await connection.onMergeRequestOpened({
				...GITLAB_ISSUE_CREATED_PAYLOAD,
				labels: [{
					title: "exclude-me",
				}],
			} as never);
			intent.expectNoEvent();
		});
		it("will include issues matching includingLabels.", async () => {
			const { connection, intent } = createConnection({
				includingIssues: ["include-me"]
			});
			await connection.onMergeRequestOpened({
				...GITLAB_ISSUE_CREATED_PAYLOAD,
				labels: [{
					title: "include-me",
				}],
			} as never);
			intent.expectEventBodyContains('**alice** opened a new MR', 0);
		});
	});
});
