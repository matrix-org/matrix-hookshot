import { createMessageQueue } from "../../src/messageQueue";
import { UserTokenStore } from "../../src/tokens/UserTokenStore";
import { AppserviceMock } from "../utils/AppserviceMock";
import { ApiError, ErrCode, ValidatorApiError } from "../../src/api";
import {
  GitLabRepoConnection,
  GitLabRepoConnectionState,
} from "../../src/Connections";
import { expect } from "chai";
import { BridgeConfigGitLab } from "../../src/config/Config";
import { IBridgeStorageProvider } from "../../src/stores/StorageProvider";
import { IntentMock } from "../utils/IntentMock";
import {
  IGitlabMergeRequest,
  IGitlabProject,
  IGitlabUser,
  IGitLabWebhookNoteEvent,
  IGitLabWebhookPipelineEvent,
} from "../../src/gitlab/WebhookTypes";

const ROOM_ID = "!foo:bar";

const GITLAB_ORG_REPO = {
  org: "a-fake-org",
  repo: "a-fake-repo",
};

const GITLAB_MR: IGitlabMergeRequest = {
  author_id: 0,
  labels: [],
  state: "opened",
  iid: 1234,
  url: `https://gitlab.example.com/${GITLAB_ORG_REPO.org}/${GITLAB_ORG_REPO.repo}/issues/1234`,
  title: "My MR",
};

const GITLAB_USER: IGitlabUser = {
  name: "Alice",
  username: "alice",
  avatar_url: "",
  email: "alice@example.org",
};

const GITLAB_PROJECT: IGitlabProject = {
  path_with_namespace: `${GITLAB_ORG_REPO.org}/${GITLAB_ORG_REPO.repo}`,
  web_url: `https://gitlab.example.com/${GITLAB_ORG_REPO.org}/${GITLAB_ORG_REPO.repo}`,
  homepage: "",
};

const GITLAB_ISSUE_CREATED_PAYLOAD = {
  object_kind: "merge_request",
  user: GITLAB_USER,
  object_attributes: GITLAB_MR,
  project: GITLAB_PROJECT,
};

const GITLAB_MR_COMMENT: IGitLabWebhookNoteEvent = {
  object_kind: "note",
  event_type: "note",
  merge_request: GITLAB_MR,
  object_attributes: {
    discussion_id: "6babfc4ad3be2355db286ed50be111a5220d5751",
    note: "I am starting a new thread",
    noteable_type: "MergeRequest",
    url: "https://gitlab.com/tadeuszs/my-awesome-project/-/merge_requests/2#note_1455087141",
    id: 1455087141,
    author_id: 12345,
    noteable_id: 1,
  },
  project: GITLAB_PROJECT,
  user: GITLAB_USER,
  repository: {
    description: "A repo",
    homepage: "https://gitlab.com/tadeuszs/my-awesome-project",
    name: "a-repo",
    url: "https://gitlab.com/tadeuszs/my-awesome-project",
  },
};

const GITLAB_PIPELINE_EVENT: IGitLabWebhookPipelineEvent = {
  object_kind: "pipeline",
  user: {
    name: "Test User",
    username: "testuser",
    avatar_url: "",
  },
  project: {
    name: "Test Project",
    web_url: "https://gitlab.example.com/test/project",
    path_with_namespace: "test/project",
  },
  object_attributes: {
    id: 1,
    status: "success",
    ref: "main",
    duration: 120,
    created_at: "2025-05-20T10:00:00Z",
    finished_at: "2025-05-20T10:02:00Z",
  },
};

const COMMENT_DEBOUNCE_MS = 25;

function createConnection(
  state: Partial<GitLabRepoConnectionState> = {},
  isExistingState = false,
): { connection: GitLabRepoConnection; intent: IntentMock } {
  const mq = createMessageQueue();
  mq.subscribe("*");
  const as = AppserviceMock.create();
  const intent = as.getIntentForUserId("@gitlab:example.test");
  const connection = new GitLabRepoConnection(
    ROOM_ID,
    "state_key",
    as,
    {
      commentDebounceMs: COMMENT_DEBOUNCE_MS,
    } as BridgeConfigGitLab,
    intent,
    GitLabRepoConnection.validateState(
      {
        instance: "bar",
        path: "foo",
        ...state,
      },
      isExistingState,
    ),
    {} as UserTokenStore,
    {
      url: "https://gitlab.example.com",
    },
    {
      setGitlabDiscussionThreads: () => Promise.resolve(),
      getGitlabDiscussionThreads: () => Promise.resolve([]),
    } as unknown as IBridgeStorageProvider,
  );
  return { connection, intent };
}

async function waitForDebouncing(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, COMMENT_DEBOUNCE_MS * 2));
}

describe("GitLabRepoConnection", () => {
  describe("validateState", () => {
    it("can validate a completes state config", () => {
      GitLabRepoConnection.validateState({
        instance: "foo",
        path: "bar/baz",
        enableHooks: [
          "merge_request.open",
          "merge_request.reopen",
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
      const state = GitLabRepoConnection.validateState(
        {
          instance: "foo",
          path: "bar/baz",
          ignoreHooks: ["merge_request"],
          commandPrefix: "!gl",
        } as GitLabRepoConnectionState as unknown as Record<string, unknown>,
        true,
      );
      expect(state.enableHooks).to.not.contain("merge_request");
    });

    it("will disallow invalid state", () => {
      try {
        GitLabRepoConnection.validateState({
          instance: "foo",
          path: 123,
        });
      } catch (ex) {
        if (
          ex instanceof ValidatorApiError === false ||
          ex.errcode !== ErrCode.BadValue
        ) {
          throw ex;
        }
      }
    });

    it("will disallow enabledHooks to contains invalid enums if this is new state", () => {
      try {
        GitLabRepoConnection.validateState(
          {
            instance: "bar",
            path: "foo",
            enabledHooks: ["not-real"],
          },
          false,
        );
      } catch (ex) {
        if (
          ex instanceof ApiError === false ||
          ex.errcode !== ErrCode.BadValue
        ) {
          throw ex;
        }
      }
    });

    it("will allow enabledHooks to contains invalid enums if this is old state", () => {
      GitLabRepoConnection.validateState(
        {
          instance: "bar",
          path: "foo",
          enabledHooks: ["not-real"],
        },
        true,
      );
    });
  });

  describe("onMergeRequestCommentCreated", () => {
    it("will handle an MR comment", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestCommentCreated(GITLAB_MR_COMMENT);
      await waitForDebouncing();
      intent.expectEventMatches(
        (ev: any) => ev.content.body.includes("**Alice** commented on MR"),
        "event body indicates MR comment",
      );
    });

    it("will filter out issues not matching includingLabels.", async () => {
      const { connection, intent } = createConnection({
        includingLabels: ["include-me"],
      });
      // ..or issues with no labels
      await connection.onMergeRequestCommentCreated(GITLAB_MR_COMMENT);
      await waitForDebouncing();
      intent.expectNoEvent();
    });

    it("will filter out issues matching excludingLabels.", async () => {
      const { connection, intent } = createConnection({
        excludingLabels: ["exclude-me"],
      });
      // ..or issues with no labels
      await connection.onMergeRequestCommentCreated({
        ...GITLAB_MR_COMMENT,
        merge_request: {
          ...GITLAB_MR,
          labels: [
            {
              id: 0,
              title: "exclude-me",
            } as any,
          ],
        },
      });
      await waitForDebouncing();
      intent.expectNoEvent();
    });

    it("will debounce MR comments", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestCommentCreated(GITLAB_MR_COMMENT);
      await connection.onMergeRequestCommentCreated({
        ...GITLAB_MR_COMMENT,
        object_attributes: {
          ...GITLAB_MR_COMMENT.object_attributes,
          discussion_id: "fa5d",
          note: "different comment",
        },
      } as never);
      await waitForDebouncing();
      expect(intent.sentEvents.length).to.equal(1);
      intent.expectEventMatches(
        (ev: any) => ev.content.body.includes("with 2 comments"),
        "one event sent for both comments",
        0,
      );
    });

    it("will add new comments in a Matrix thread", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestCommentCreated(GITLAB_MR_COMMENT);
      await waitForDebouncing();
      await connection.onMergeRequestCommentCreated(GITLAB_MR_COMMENT);
      await waitForDebouncing();
      expect(intent.sentEvents.length).to.equal(2);
      intent.expectEventMatches(
        (ev: any) => ev.content["m.relates_to"].event_id === "event_0",
        "one event sent for both comments",
        1,
      );
    });

    it("will correctly map new comments to aggregated discussions", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestCommentCreated({
        ...GITLAB_MR_COMMENT,
        object_attributes: {
          ...GITLAB_MR_COMMENT.object_attributes,
          discussion_id: "disc1",
        },
      } as never);
      await connection.onMergeRequestCommentCreated({
        ...GITLAB_MR_COMMENT,
        object_attributes: {
          ...GITLAB_MR_COMMENT.object_attributes,
          discussion_id: "disc2",
        },
      } as never);
      await waitForDebouncing();
      expect(intent.sentEvents.length).to.equal(1);

      await connection.onMergeRequestCommentCreated({
        ...GITLAB_MR_COMMENT,
        object_attributes: {
          ...GITLAB_MR_COMMENT.object_attributes,
          discussion_id: "disc1",
        },
      } as never);
      await waitForDebouncing();
      expect(intent.sentEvents.length).to.equal(2);
      intent.expectEventMatches(
        (ev: any) => ev.content["m.relates_to"].event_id === "event_0",
        "disc1 reply goes to existing thread",
        1,
      );

      await connection.onMergeRequestCommentCreated({
        ...GITLAB_MR_COMMENT,
        object_attributes: {
          ...GITLAB_MR_COMMENT.object_attributes,
          discussion_id: "disc2",
        },
      } as never);
      await waitForDebouncing();
      expect(intent.sentEvents.length).to.equal(3);
      intent.expectEventMatches(
        (ev: any) => ev.content["m.relates_to"].event_id === "event_0",
        "disc2 reply also goes to existing thread",
        2,
      );
    });
  });

  describe("onIssueCreated", () => {
    it("will handle a simple issue", async () => {
      const { connection, intent } = createConnection();
      await connection.onMergeRequestOpened(
        GITLAB_ISSUE_CREATED_PAYLOAD as never,
      );
      intent.expectEventBodyContains("**alice** opened a new MR", 0);
      intent.expectEventBodyContains(
        GITLAB_ISSUE_CREATED_PAYLOAD.object_attributes.url,
        0,
      );
      intent.expectEventBodyContains(
        GITLAB_ISSUE_CREATED_PAYLOAD.object_attributes.title,
        0,
      );
    });

    it("will filter out issues not matching includingLabels.", async () => {
      const { connection, intent } = createConnection({
        includingLabels: ["include-me"],
      });
      await connection.onMergeRequestOpened({
        ...GITLAB_ISSUE_CREATED_PAYLOAD,
        labels: [
          {
            title: "foo",
          },
        ],
      } as never);
      await connection.onMergeRequestOpened(
        GITLAB_ISSUE_CREATED_PAYLOAD as never,
      );
      intent.expectNoEvent();
    });

    it("will filter out issues matching excludingLabels.", async () => {
      const { connection, intent } = createConnection({
        excludingLabels: ["exclude-me"],
      });
      await connection.onMergeRequestOpened({
        ...GITLAB_ISSUE_CREATED_PAYLOAD,
        labels: [
          {
            title: "exclude-me",
          },
        ],
      } as never);
      intent.expectNoEvent();
    });

    it("will include issues matching includingLabels.", async () => {
      const { connection, intent } = createConnection({
        includingLabels: ["include-me"],
      });
      await connection.onMergeRequestOpened({
        ...GITLAB_ISSUE_CREATED_PAYLOAD,
        labels: [
          {
            title: "include-me",
          },
        ],
      } as never);
      intent.expectEventBodyContains("**alice** opened a new MR", 0);
    });
  });

  describe("onPipelineEvent", () => {
    it("should handle a pipeline event", async () => {
      const { connection, intent } = createConnection({
        enableHooks: ["pipeline"],
      });

      await connection.onPipelineEvent(GITLAB_PIPELINE_EVENT);

      intent.expectEventBodyContains("**SUCCESS** on branch `main`", 0);
      intent.expectEventBodyContains("Test Project", 0);
      intent.expectEventBodyContains("testuser", 0);
      intent.expectEventBodyContains("Duration: 120s", 0);
    });

    it("should skip the pipeline event if hook is not enabled", async () => {
      const { connection, intent } = createConnection({
        enableHooks: ["push"], // pipeline not enabled
      });

      await connection.onPipelineEvent(GITLAB_PIPELINE_EVENT);
      intent.expectNoEvent();
    });

    it("should skip the pipeline event if hook is explicitly excluded", async () => {
      const { connection, intent } = createConnection({
        enableHooks: [],
      });

      await connection.onPipelineEvent(GITLAB_PIPELINE_EVENT);
      intent.expectNoEvent();
    });

    it('01 - should handle status ""success"" with correct hook (expect event)', async () => {
      const { connection, intent } = createConnection({
        enableHooks: ['pipeline'],
      });

      const customEvent = {
        ...GITLAB_PIPELINE_EVENT,
        object_attributes: {
          ...GITLAB_PIPELINE_EVENT.object_attributes,
          status: "success",
        },
      };

      await connection.onPipelineEvent(customEvent);
      intent.expectEventBodyContains("**SUCCESS**", 0);
      intent.expectEventBodyContains("Pipeline", 0);
      intent.expectEventBodyContains("branch `main`", 0);
      intent.expectEventBodyContains("[Test Project](https://gitlab.example.com/test/project)", 0);
      intent.expectEventBodyContains("**testuser**", 0);
      intent.expectEventBodyContains("Duration: 120s", 0);

    });

    it('02 - should handle status "success" with wrong hook (expect no event)', async () => {
      const { connection, intent } = createConnection({ enableHooks: ['push'] });
      const customEvent = {
        ...GITLAB_PIPELINE_EVENT,
        object_attributes: { ...GITLAB_PIPELINE_EVENT.object_attributes, status: "success" },
      };
      await connection.onPipelineEvent(customEvent);
      intent.expectNoEvent();
    });

    it('03 - should handle status "success" with no hooks (expect no event)', async () => {
      const { connection, intent } = createConnection({ enableHooks: [] });
      const customEvent = {
        ...GITLAB_PIPELINE_EVENT,
        object_attributes: { ...GITLAB_PIPELINE_EVENT.object_attributes, status: "success" },
      };
      await connection.onPipelineEvent(customEvent);
      intent.expectNoEvent();
    });

    it('04 - should handle status "failed" with correct hook (expect event)', async () => {
      const { connection, intent } = createConnection({ enableHooks: ['pipeline'] });
      const customEvent = {
        ...GITLAB_PIPELINE_EVENT,
        object_attributes: { ...GITLAB_PIPELINE_EVENT.object_attributes, status: "failed" },
      };
      await connection.onPipelineEvent(customEvent);
      intent.expectEventBodyContains("**FAILED**", 0);
      intent.expectEventBodyContains("branch `main`", 0);
      intent.expectEventBodyContains("[Test Project](https://gitlab.example.com/test/project)", 0);
      intent.expectEventBodyContains("**testuser**", 0);
      intent.expectEventBodyContains("Duration: 120s", 0);
    });

    it('05 - should handle status "failed" with wrong hook (expect no event)', async () => {
      const { connection, intent } = createConnection({ enableHooks: ['push'] });
      const customEvent = {
        ...GITLAB_PIPELINE_EVENT,
        object_attributes: { ...GITLAB_PIPELINE_EVENT.object_attributes, status: "failed" },
      };
      await connection.onPipelineEvent(customEvent);
      intent.expectNoEvent();
    });

    it('06 - should handle status "failed" with no hooks (expect no event)', async () => {
      const { connection, intent } = createConnection({ enableHooks: [] });
      const customEvent = {
        ...GITLAB_PIPELINE_EVENT,
        object_attributes: { ...GITLAB_PIPELINE_EVENT.object_attributes, status: "failed" },
      };
      await connection.onPipelineEvent(customEvent);
      intent.expectNoEvent();
    });

    it('07 - should handle status "canceled" with correct hook (expect event)', async () => {
      const { connection, intent } = createConnection({ enableHooks: ['pipeline'] });
      const customEvent = {
        ...GITLAB_PIPELINE_EVENT,
        object_attributes: { ...GITLAB_PIPELINE_EVENT.object_attributes, status: "canceled" },
      };
      await connection.onPipelineEvent(customEvent);
      intent.expectEventBodyContains("**CANCELED**", 0);
      intent.expectEventBodyContains("branch `main`", 0);
      intent.expectEventBodyContains("[Test Project](https://gitlab.example.com/test/project)", 0);
      intent.expectEventBodyContains("**testuser**", 0);
      intent.expectEventBodyContains("Duration: 120s", 0);
    });

    it('08 - should handle status "canceled" with wrong hook (expect no event)', async () => {
      const { connection, intent } = createConnection({ enableHooks: ['push'] });
      const customEvent = {
        ...GITLAB_PIPELINE_EVENT,
        object_attributes: { ...GITLAB_PIPELINE_EVENT.object_attributes, status: "canceled" },
      };
      await connection.onPipelineEvent(customEvent);
      intent.expectNoEvent();
    });

    it('09 - should handle status "canceled" with no hooks (expect no event)', async () => {
      const { connection, intent } = createConnection({ enableHooks: [] });
      const customEvent = {
        ...GITLAB_PIPELINE_EVENT,
        object_attributes: { ...GITLAB_PIPELINE_EVENT.object_attributes, status: "canceled" },
      };
      await connection.onPipelineEvent(customEvent);
      intent.expectNoEvent();
    });

    it('10 - should handle status "running" with correct hook (expect event)', async () => {
      const { connection, intent } = createConnection({ enableHooks: ['pipeline'] });
      const customEvent = {
        ...GITLAB_PIPELINE_EVENT,
        object_attributes: { ...GITLAB_PIPELINE_EVENT.object_attributes, status: "running" },
      };
      await connection.onPipelineEvent(customEvent);
      intent.expectEventBodyContains("**RUNNING**", 0);
      intent.expectEventBodyContains("branch `main`", 0);
      intent.expectEventBodyContains("[Test Project](https://gitlab.example.com/test/project)", 0);
      intent.expectEventBodyContains("**testuser**", 0);
      intent.expectEventBodyContains("Duration: 120s", 0);
    });

    it('11 - should handle status "running" with wrong hook (expect no event)', async () => {
      const { connection, intent } = createConnection({ enableHooks: ['push'] });
      const customEvent = {
        ...GITLAB_PIPELINE_EVENT,
        object_attributes: { ...GITLAB_PIPELINE_EVENT.object_attributes, status: "running" },
      };
      await connection.onPipelineEvent(customEvent);
      intent.expectNoEvent();
    });

    it('12 - should handle status "running" with no hooks (expect no event)', async () => {
      const { connection, intent } = createConnection({ enableHooks: [] });
      const customEvent = {
        ...GITLAB_PIPELINE_EVENT,
        object_attributes: { ...GITLAB_PIPELINE_EVENT.object_attributes, status: "running" },
      };
      await connection.onPipelineEvent(customEvent);
      intent.expectNoEvent();
    });

    it('13 - should handle status "manual" with correct hook (expect event)', async () => {
      const { connection, intent } = createConnection({ enableHooks: ['pipeline'] });
      const customEvent = {
        ...GITLAB_PIPELINE_EVENT,
        object_attributes: { ...GITLAB_PIPELINE_EVENT.object_attributes, status: "manual" },
      };
      await connection.onPipelineEvent(customEvent);
      intent.expectEventBodyContains("**MANUAL**", 0);
      intent.expectEventBodyContains("branch `main`", 0);
      intent.expectEventBodyContains("[Test Project](https://gitlab.example.com/test/project)", 0);
      intent.expectEventBodyContains("**testuser**", 0);
      intent.expectEventBodyContains("Duration: 120s", 0);
    });

    it('14 - should handle status "manual" with wrong hook (expect no event)', async () => {
      const { connection, intent } = createConnection({ enableHooks: ['push'] });
      const customEvent = {
        ...GITLAB_PIPELINE_EVENT,
        object_attributes: { ...GITLAB_PIPELINE_EVENT.object_attributes, status: "manual" },
      };
      await connection.onPipelineEvent(customEvent);
      intent.expectNoEvent();
    });

    it('15 - should handle status "manual" with no hooks (expect no event)', async () => {
      const { connection, intent } = createConnection({ enableHooks: [] });
      const customEvent = {
        ...GITLAB_PIPELINE_EVENT,
        object_attributes: { ...GITLAB_PIPELINE_EVENT.object_attributes, status: "manual" },
      };
      await connection.onPipelineEvent(customEvent);
      intent.expectNoEvent();
    });

  });
});
