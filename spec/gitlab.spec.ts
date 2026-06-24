import { test as baseTest } from "./util/fixtures";
import { E2ETestEnv } from "./util/e2e-test";
import { describe, expect } from "vitest";
import { randomUUID } from "crypto";
import {
  GitLabRepoConnection,
  GitLabRepoConnectionState,
} from "../src/Connections";
import { MessageEventContent } from "matrix-bot-sdk";
import { waitFor } from "./util/helpers";
import { IGitLabWebhookMREvent } from "../src/gitlab/WebhookTypes";

const webhooksPort = 9500 + E2ETestEnv.workerId;

const test = baseTest.override("testEnvOpts", {
  config: {
    gitlab: {
      webhook: {
        secret: randomUUID(),
      },
      instances: {
        "example.org": {
          url: "http://gitlab.example.org",
        },
      },
    },
  },
});

describe("GitLab", () => {
  for (const path of ["/", "/gitlab/webhook"]) {
    test(`should be able to handle a GitLab event (on path ${path})`, async ({
      testEnv,
      user,
      bridgeApi,
    }) => {
      const testRoomId = await user.createRoom({
        name: "Test room",
        invite: [testEnv.botMxid],
      });
      await user.setUserPowerLevel(testEnv.botMxid, testRoomId, 50);
      await user.waitForRoomJoin({
        sender: testEnv.botMxid,
        roomId: testRoomId,
      });
      // Now hack in a GitLab connection.
      await testEnv.app.appservice.botClient.sendStateEvent(
        testRoomId,
        GitLabRepoConnection.CanonicalEventType,
        "my-test",
        {
          instance: "example.org",
          path: "my-project",
        } satisfies GitLabRepoConnectionState,
      );

      // Wait for connection to be accepted.
      await waitFor(
        async () =>
          (await bridgeApi.getConnectionsForRoom(testRoomId)).length === 1,
      );

      const webhookNotice = user.waitForRoomEvent<MessageEventContent>({
        eventType: "m.room.message",
        sender: testEnv.botMxid,
        roomId: testRoomId,
      });

      const webhookPayload = JSON.stringify({
        object_kind: "merge_request",
        event_type: "any",
        user: {
          username: "alice",
          name: "Alice",
          email: "alice@example.org",
          avatar_url: "foobar",
        },
        project: {
          path_with_namespace: "my-project",
          web_url: "https://gilab.example.org/my-project",
          homepage: "foo",
        },
        repository: {
          name: "example",
          homepage: "foo",
          url: "https://gilab.example.org",
          description: "https://gilab.example.org/my-project",
        },
        object_attributes: {
          action: "open",
          title: "My test MR",
          url: "https://gilab.example.org/my-project/-/merge_requests/1",
          iid: 0,
          author_id: 0,
          state: "opened",
          labels: [],
        },
        labels: [],
        changes: {},
      } satisfies IGitLabWebhookMREvent);

      // Send a webhook
      const req = await fetch(`http://localhost:${webhooksPort}${path}`, {
        method: "POST",
        headers: {
          "x-gitlab-token": testEnv.opts.config?.gitlab?.webhook.secret!,
          "Content-Type": "application/json",
        },
        body: webhookPayload,
      });
      expect(req.status).toBe(200);
      expect(await req.text()).toBe("OK");

      // And await the notice.
      const { body } = (await webhookNotice).data.content;
      expect(body).toContain("**alice** opened a new MR");
      expect(body).toContain(
        "https://gilab.example.org/my-project/-/merge_requests/1",
      );
      expect(body).toContain("My test MR");
    });
  }
});
