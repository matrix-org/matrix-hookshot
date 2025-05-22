import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";
import { describe, test, beforeAll, afterAll, expect } from "vitest";
import { createHmac, randomUUID } from "crypto";
import { GitLabRepoConnection, GitLabRepoConnectionState } from "../src/Connections";
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

    test("should be able to handle a GitLab pipeline event", async () => {
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
        await user.waitForRoomJoin({ sender: testEnv.botMxid, roomId: testRoomId });

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

        const webhookNotice = user.waitForRoomEvent<MessageEventContent>({
            eventType: "m.room.message",
            sender: testEnv.botMxid,
            roomId: testRoomId,
        });

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

        const { body } = (await webhookNotice).data.content;
        expect(body.toLowerCase()).toContain("alice");
        expect(body.toLowerCase()).toContain("pipeline");
        expect(body.toLowerCase()).toContain("success");
        expect(body.toLowerCase()).toContain("main");
    });
});