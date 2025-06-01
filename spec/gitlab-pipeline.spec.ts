import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";
import { describe, test, beforeAll, afterAll, expect } from "vitest";
import { createHmac, randomUUID } from "crypto";
import {
  GitLabRepoConnection,
  GitLabRepoConnectionState,
} from "../src/Connections";
import { MessageEventContent } from "matrix-bot-sdk";
import { getBridgeApi } from "./util/bridge-api";
import { waitFor } from "./util/helpers";
import { Server, createServer } from "http";

describe("GitLab - Pipeline Event", () => {
  let testEnv: E2ETestEnv;
  let gitlabServer: Server;
  const webhooksPort = 9801 + E2ETestEnv.workerId;
  const gitlabPort = 9901 + E2ETestEnv.workerId;

  beforeAll(async () => {
    gitlabServer = createServer((req, res) => {
      if (req.method === "GET" && req.url?.includes("/projects")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: 1234 }));
      } else {
        console.log("Unknown GitLab request", req.method, req.url);
        res.writeHead(404);
        res.end();
      }
    }).listen(gitlabPort);

    testEnv = await E2ETestEnv.createTestEnv({
      matrixLocalparts: ["user"],
      config: {
        gitlab: {
          webhook: {
            secret: "mysecret",
          },
          instances: {
            test: {
              url: `http://localhost:${gitlabPort}`,
            },
          },
        },
        widgets: {
          publicUrl: `http://localhost:${webhooksPort}`,
        },
        listeners: [
          {
            port: webhooksPort,
            bindAddress: "0.0.0.0",
            resources: ["webhooks", "widgets"],
          },
        ],
      },
    });
    await testEnv.setUp();
  }, E2ESetupTestTimeout);

  afterAll(() => {
    gitlabServer?.close();
    return testEnv?.tearDown();
  });

  const waitForMessages = (
    user: any,
    roomId: string,
    botMxid: string,
    expectedCount: number,
    timeoutMs: number = 10000,
  ): Promise<MessageEventContent[]> => {
    return new Promise((resolve, reject) => {
      const receivedMessages: MessageEventContent[] = [];
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Timeout: Expected ${expectedCount} messages, got ${receivedMessages.length}`,
          ),
        );
      }, timeoutMs);

      const messageHandler = (eventRoomId: string, event: any) => {
        if (
          eventRoomId === roomId &&
          event.sender === botMxid &&
          event.content?.msgtype === "m.notice"
        ) {
          receivedMessages.push(event.content);
          if (receivedMessages.length >= expectedCount) {
            cleanup();
            resolve(receivedMessages);
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        user.off("room.message", messageHandler);
      };

      user.on("room.message", messageHandler);
    });
  };

  test(
    "should handle GitLab pipeline success event with both messages",
    async () => {
      const user = testEnv.getUser("user");
      const bridgeApi = await getBridgeApi(
        testEnv.opts.config?.widgets?.publicUrl!,
        user,
      );
      const testRoomId = await user.createRoom({
        name: "Pipeline Test Room",
        invite: [testEnv.botMxid],
      });
      await user.setUserPowerLevel(testEnv.botMxid, testRoomId, 50);
      await user.waitForRoomJoin({
        sender: testEnv.botMxid,
        roomId: testRoomId,
      });

      await testEnv.app.appservice.botClient.sendStateEvent(
        testRoomId,
        GitLabRepoConnection.CanonicalEventType,
        "my-test-pipeline",
        {
          instance: "test",
          path: "org/project",
          enableHooks: ["pipeline"],
        } satisfies GitLabRepoConnectionState,
      );

      await waitFor(
        async () =>
          (await bridgeApi.getConnectionsForRoom(testRoomId)).length === 1,
      );

      const messagesPromise = waitForMessages(
        user,
        testRoomId,
        testEnv.botMxid,
        2,
      );

      const webhookPayload = JSON.stringify({
        object_kind: "pipeline",
        object_attributes: {
          id: 123456,
          status: "success",
          ref: "main",
          url: "https://gitlab.example.com/org/project/-/pipelines/123456",
          duration: 300,
          finished_at: "2025-01-01T12:00:00Z",
        },
        project: {
          id: 1234,
          name: "project",
          path_with_namespace: "org/project",
          web_url: "https://gitlab.example.com/org/project",
        },
        user: {
          id: 1,
          name: "Alice Doe",
          username: "alice",
          email: "alice@example.com",
        },
        commit: {
          id: "abcd1234567890",
          message: "Add new feature",
          author_name: "Alice Doe",
          author_email: "alice@example.com",
        },
      });

      const hmac = createHmac("sha256", "mysecret");
      hmac.write(webhookPayload);
      hmac.end();

      const req = await fetch(`http://localhost:${webhooksPort}/`, {
        method: "POST",
        headers: {
          "X-Gitlab-Event": "Pipeline Hook",
          "X-Gitlab-Token": "mysecret",
          "X-Hub-Signature-256": `sha256=${hmac.read().toString("hex")}`,
          "Content-Type": "application/json",
        },
        body: webhookPayload,
      });

      expect(req.status).toBe(200);
      expect(await req.text()).toBe("OK");

      const receivedMessages = await messagesPromise;

      expect(receivedMessages.length).toBe(2);

      const triggeredMessage = receivedMessages[0];
      expect(triggeredMessage.body.toLowerCase()).toContain("triggered");

      const successMessage = receivedMessages[1];
      expect(successMessage.body.toLowerCase()).toContain("success");
    },
    E2ESetupTestTimeout,
  );

  test("should only send triggered message for running pipeline", async () => {
    const user = testEnv.getUser("user");
    const bridgeApi = await getBridgeApi(
      testEnv.opts.config?.widgets?.publicUrl!,
      user,
    );
    const testRoomId = await user.createRoom({
      name: "Pipeline Running Test Room",
      invite: [testEnv.botMxid],
    });
    await user.setUserPowerLevel(testEnv.botMxid, testRoomId, 50);
    await user.waitForRoomJoin({ sender: testEnv.botMxid, roomId: testRoomId });

    await testEnv.app.appservice.botClient.sendStateEvent(
      testRoomId,
      GitLabRepoConnection.CanonicalEventType,
      "my-test-pipeline-running",
      {
        instance: "test",
        path: "org/project",
        enableHooks: ["pipeline"],
      } satisfies GitLabRepoConnectionState,
    );

    await waitFor(
      async () =>
        (await bridgeApi.getConnectionsForRoom(testRoomId)).length === 1,
    );

    const receivedMessages: MessageEventContent[] = [];
    const messageHandler = (roomId: string, event: any) => {
      if (roomId === testRoomId && event.sender === testEnv.botMxid) {
        receivedMessages.push(event.content);
      }
    };
    user.on("room.message", messageHandler);

    const webhookPayload = JSON.stringify({
      object_kind: "pipeline",
      object_attributes: {
        id: 999888,
        status: "running",
        ref: "main",
        url: "https://gitlab.example.com/org/project/-/pipelines/999888",
        duration: null,
        finished_at: null,
      },
      project: {
        id: 1234,
        name: "project",
        path_with_namespace: "org/project",
        web_url: "https://gitlab.example.com/org/project",
      },
      user: {
        id: 4,
        name: "David Wilson",
        username: "david",
        email: "david@example.com",
      },
      commit: {
        id: "mnop3456789012",
        message: "Start new feature",
        author_name: "David Wilson",
        author_email: "david@example.com",
      },
    });

    const hmac = createHmac("sha256", "mysecret");
    hmac.write(webhookPayload);
    hmac.end();

    const req = await fetch(`http://localhost:${webhooksPort}/`, {
      method: "POST",
      headers: {
        "X-Gitlab-Event": "Pipeline Hook",
        "X-Gitlab-Token": "mysecret",
        "X-Hub-Signature-256": `sha256=${hmac.read().toString("hex")}`,
        "Content-Type": "application/json",
      },
      body: webhookPayload,
    });

    expect(req.status).toBe(200);
    expect(await req.text()).toBe("OK");

    await waitFor(async () => receivedMessages.length >= 1, 3000);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(receivedMessages.length).toBe(1);
    const triggeredMessage = receivedMessages[0];
    expect(triggeredMessage.body.toLowerCase()).toContain("triggered");
  });
});
