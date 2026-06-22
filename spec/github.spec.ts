import { test as baseTest } from "./util/fixtures";
import { E2ETestEnv } from "./util/e2e-test";
import { describe, expect } from "vitest";

import { createHmac, randomUUID } from "crypto";
import {
  GitHubRepoConnection,
  GitHubRepoConnectionState,
} from "../src/Connections";
import { MessageEventContent } from "matrix-bot-sdk";
import { createServer } from "http";
import { waitFor } from "./util/helpers";

const test = baseTest
  .override("testHttpServer", ({ webhooksPort }, { onCleanup }) => {
    const githubPort = webhooksPort + 200;
    // Fake out enough of a GitHub API to get past startup.
    const githubServer = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/api/v3/app") {
        res.writeHead(200, undefined, { "content-type": "application/json" });
        res.write(JSON.stringify({}));
      } else if (
        req.method === "GET" &&
        req.url === "/api/v3/app/installations?per_page=100&page=1"
      ) {
        res.writeHead(200, undefined, { "content-type": "application/json" });
        res.write(JSON.stringify([]));
      } else {
        console.log("Unknown request", req.method, req.url);
        res.writeHead(404);
      }
      res.end();
    }).listen(githubPort);
    onCleanup(async () => {
      githubServer.close();
    });
    return githubPort;
  })
  .override("testEnvOpts", async ({ testHttpServer }, { onCleanup }) => ({
    config: {
      github: {
        webhook: {
          secret: randomUUID(),
        },
        oauth: {
          client_id: "GITHUB_ID",
          client_secret: "GITHUB_SECRET",
          redirect_uri: "http://example.org/redirectme",
        },
        // So we can mock out the URL
        enterpriseUrl: `http://localhost:${testHttpServer}`,
        auth: {
          privateKeyFile: "replaced",
          id: "1234",
        },
      },
    },
  }));

describe("GitHub", () => {
  for (const path of ["/", "/github/webhook"]) {
    test(`should be able to handle a GitHub event  (on path ${path})`, async ({
      testEnv,
      user,
      bridgeApi,
      webhooksPort,
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
      // Now hack in a GitHub connection.
      await testEnv.app.appservice.botClient.sendStateEvent(
        testRoomId,
        GitHubRepoConnection.CanonicalEventType,
        "my-test",
        {
          org: "my-org",
          repo: "my-repo",
        } satisfies GitHubRepoConnectionState,
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
        action: "opened",
        number: 1,
        pull_request: {
          id: 1,
          url: "https://api.github.com/repos/my-org/my-repo/pulls/1",
          html_url: "https://github.com/my-org/my-repo/pulls/1",
          number: 1,
          state: "open",
          locked: false,
          title: "My test pull request",
          user: {
            login: "alice",
          },
        },
        repository: {
          id: 1,
          html_url: "https://github.com/my-org/my-repo",
          name: "my-repo",
          full_name: "my-org/my-repo",
          owner: {
            login: "my-org",
          },
        },
        sender: {
          login: "alice",
        },
      });

      const hmac = createHmac(
        "sha256",
        testEnv.opts.config?.github?.webhook.secret!,
      );
      hmac.write(webhookPayload);
      hmac.end();

      // Send a webhook
      const req = await fetch(`http://localhost:${webhooksPort}${path}`, {
        method: "POST",
        headers: {
          "x-github-event": "pull_request",
          "X-Hub-Signature-256": `sha256=${hmac.read().toString("hex")}`,
          "X-GitHub-Delivery": randomUUID(),
          "Content-Type": "application/json",
        },
        body: webhookPayload,
      });
      expect(req.status).toBe(200);
      expect(await req.text()).toBe("OK");

      // And await the notice.
      const { body } = (await webhookNotice).data.content;
      expect(body).toContain("**alice** opened a new PR");
      expect(body).toContain("https://github.com/my-org/my-repo/pulls/1");
      expect(body).toContain("My test pull request");
    });
  }

  for (const path of ["/oauth", "/github/oauth"]) {
    test(`should redirect invalid oauth requests to oauth.html  (on path ${path})`, async ({
      webhooksPort,
    }) => {
      // This simply tests that oauth requests do not end up being ignored.
      const req = await fetch(`http://localhost:${webhooksPort}${path}`);
      expect(req.url.startsWith(`http://localhost:${webhooksPort}/oauth.html`))
        .to.be.true;
    });
  }
});
