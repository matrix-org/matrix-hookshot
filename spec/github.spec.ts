import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";
import { describe, it, beforeEach, afterEach } from "@jest/globals";
import { createHmac, randomUUID } from "crypto";
import { GitHubRepoConnection, GitHubRepoConnectionState } from "../src/Connections";
import { MessageEventContent } from "matrix-bot-sdk";
import { getBridgeApi } from "./util/bridge-api";
import { Server, createServer } from "http";

describe('GitHub', () => {
    let testEnv: E2ETestEnv;
    let githubServer: Server;
    const webhooksPort = 9500 + E2ETestEnv.workerId;
    const githubPort = 9700 + E2ETestEnv.workerId;

    beforeEach(async () => {
        // Fake out enough of a GitHub API to get past startup. Later
        // tests might make more use of this.
        githubServer = createServer((req, res) => {
            if (req.method === 'GET' && req.url === '/api/v3/app') {
                res.writeHead(200, undefined, { "content-type": 'application/json'});
                res.write(JSON.stringify({}));
            } else if (req.method === 'GET' && req.url === '/api/v3/app/installations?per_page=100&page=1') {
                res.writeHead(200, undefined, { "content-type": 'application/json'});
                res.write(JSON.stringify([]));
            } else {
                console.log('Unknown request', req.method, req.url);
                res.writeHead(404);
            }
            res.end();
        }).listen(githubPort);
        testEnv = await E2ETestEnv.createTestEnv({matrixLocalparts: ['user'], config: {
            github: {
                webhook: {
                    secret: randomUUID(),
                },
                // So we can mock out the URL
                enterpriseUrl: `http://localhost:${githubPort}`,
                auth: {
                    privateKeyFile: 'replaced',
                    id: '1234',
                }
            },
            widgets: {
                publicUrl: `http://localhost:${webhooksPort}`
            },
            listeners: [{
                port: webhooksPort,
                bindAddress: '0.0.0.0',
                // Bind to the SAME listener to ensure we don't have conflicts.
                resources: ['webhooks', 'widgets'],
            }],
        }});
        await testEnv.setUp();
    }, E2ESetupTestTimeout);

    afterEach(() => {
        githubServer?.close();
        return testEnv?.tearDown();
    });

    it('should be able to handle a GitHub event', async () => {
        const user = testEnv.getUser('user');
        const bridgeApi = await getBridgeApi(testEnv.opts.config?.widgets?.publicUrl!, user);
        const testRoomId = await user.createRoom({ name: 'Test room', invite:[testEnv.botMxid] });
        await user.setUserPowerLevel(testEnv.botMxid, testRoomId, 50);
        await user.waitForRoomJoin({sender: testEnv.botMxid, roomId: testRoomId });
        // Now hack in a GitHub connection.
        await testEnv.app.appservice.botClient.sendStateEvent(testRoomId, GitHubRepoConnection.CanonicalEventType, "my-test", {
            org: 'my-org',
            repo: 'my-repo'
        } satisfies GitHubRepoConnectionState);

        // Wait for connection to be accepted.
        await new Promise<void>(r => {
            let interval: NodeJS.Timeout;
            interval = setInterval(() => {
                bridgeApi.getConnectionsForRoom(testRoomId).then(conns => {
                    if (conns.length > 0) {
                        clearInterval(interval);
                        r();
                    }
                })
            }, 500);
        });

        const webhookNotice = user.waitForRoomEvent<MessageEventContent>({
            eventType: 'm.room.message', sender: testEnv.botMxid, roomId: testRoomId
        });

        const webhookPayload = JSON.stringify({
            "action": "opened",
            "number": 1,
            "pull_request": {
              id: 1,
              "url": "https://api.github.com/repos/my-org/my-repo/pulls/1",
              "html_url": "https://github.com/my-org/my-repo/pulls/1",
              "number": 1,
              "state": "open",
              "locked": false,
              "title": "My test pull request",
              "user": {
                "login": "alice",
              },
            },
            repository: {
                id: 1,
                "html_url": "https://github.com/my-org/my-repo",
                name: 'my-repo',
                full_name: 'my-org/my-repo',
                owner: {
                    login: 'my-org',
                }
            },
            sender: {
                login: 'alice',
            }
        });

        const hmac = createHmac('sha256', testEnv.opts.config?.github?.webhook.secret!);
        hmac.write(webhookPayload);
        hmac.end();

        // Send a webhook
        const req = await fetch(`http://localhost:${webhooksPort}/`, {
            method: 'POST',
            headers: {
                'x-github-event': 'pull_request',
                'X-Hub-Signature-256': `sha256=${hmac.read().toString('hex')}`,
                'X-GitHub-Delivery': randomUUID(),
                'Content-Type': 'application/json'
            },
            body: webhookPayload,
        });
        expect(req.status).toBe(200);
        expect(await req.text()).toBe('OK');
        
        // And await the notice.
        const { body } = (await webhookNotice).data.content;
        expect(body).toContain('**alice** opened a new PR');
        expect(body).toContain('https://github.com/my-org/my-repo/pulls/1');
        expect(body).toContain('My test pull request');
    });
});
