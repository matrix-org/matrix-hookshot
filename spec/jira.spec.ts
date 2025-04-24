import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";
import { describe, it, beforeEach, afterEach } from "@jest/globals";
import { createHmac, randomUUID } from "crypto";
import { JiraProjectConnection, JiraProjectConnectionState } from "../src/Connections";
import { MessageEventContent } from "matrix-bot-sdk";
import { Server } from "http";
import { JiraGrantChecker } from "../src/jira/GrantChecker";

const JIRA_PAYLOAD = {
    "timestamp": 1745506426948,
    "webhookEvent": "jira:issue_created",
    "issue_event_type_name": "issue_created",
    "user": {
        "accountId": "1234567890",
        "displayName": "Test User",
    },
    "issue": {
      "id": "10007",
      "self": "https://test-env",
      "key": "TP-8",
      "fields": {
        "statuscategorychangedate": "2025-04-24T15:53:47.084+0100",
        "issuetype": {
          "id": "10001",
          "name": "Task",
        },
        "components": [],
        "timespent": null,
        "timeoriginalestimate": null,
        "project": {
            "self": "https://example.org/my/test/project",
            "key": "TP",
        },
        "description": null,
        "summary": "Test issue",
        "lastViewed": null,
        "creator": {
          "accountId": "1234567890",
          "displayName": "Test User",
        },
        "subtasks": [],
        "created": "2025-04-24T15:53:46.821+0100",
        "reporter": {
          "accountId": "1234567890",
          "displayName": "Test User",
        },
        "labels": [],
        "environment": null,
        "timeestimate": null,
        "aggregatetimeoriginalestimate": null,
        "versions": [],
        "duedate": null,
        "progress": {
          "progress": 0,
          "total": 0
        },
        "issuelinks": [],
        "assignee": null,
        "updated": "2025-04-24T15:53:46.821+0100",
        "status": {
          "name": "To Do",
          "id": "10000",
        }
      }
    },
  };  

describe('JIRA', () => {
    let testEnv: E2ETestEnv;
    let githubServer: Server;
    const webhooksPort = 9500 + E2ETestEnv.workerId;

    beforeEach(async () => {
        testEnv = await E2ETestEnv.createTestEnv({matrixLocalparts: ['user'], config: {
            jira: {
                webhook: {
                    secret: randomUUID(),
                },
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
        return testEnv?.tearDown();
    });

    it('should be able to handle a JIRA event', async () => {
        const user = testEnv.getUser('user');
        const testRoomId = await user.createRoom({ name: 'Test room', invite:[testEnv.botMxid] });
        await user.setUserPowerLevel(testEnv.botMxid, testRoomId, 50);
        const jiraURL = JIRA_PAYLOAD.issue.fields.project.self;
        // Pre-grant connection to allow us to bypass the oauth dance.
        await user.waitForRoomJoin({sender: testEnv.botMxid, roomId: testRoomId });
        const granter = new JiraGrantChecker(testEnv.app.appservice, null as any);
        await granter.grantConnection(testRoomId, {
            url: jiraURL,
        });

        // "Create" a JIRA connection.
        await testEnv.app.appservice.botClient.sendStateEvent(testRoomId, JiraProjectConnection.CanonicalEventType, jiraURL, {
            url: jiraURL,
        } satisfies JiraProjectConnectionState);


        const webhookNotice = user.waitForRoomEvent<MessageEventContent>({
            eventType: 'm.room.message', sender: testEnv.botMxid, roomId: testRoomId
        });

        const webhookPayload = JSON.stringify(JIRA_PAYLOAD);

        const hmac = createHmac('sha256', testEnv.opts.config?.jira?.webhook.secret!);
        hmac.write(webhookPayload);
        hmac.end();

        // Send a webhook
        const req = await fetch(`http://localhost:${webhooksPort}/`, {
            method: 'POST',
            headers: {
                'X-Hub-Signature': `sha256=${hmac.read().toString('hex')}`,
                'x-atlassian-webhook-identifier': randomUUID(),
                'Content-Type': 'application/json'
            },
            body: webhookPayload,
        });
        expect(req.status).toBe(200);
        expect(await req.text()).toBe('OK');
        
        // And await the notice.
        const { body } = (await webhookNotice).data.content;
        console.log(body);
        expect(body).toContain('**alice** opened a new PR');
        expect(body).toContain('https://github.com/my-org/my-repo/pulls/1');
        expect(body).toContain('My test pull request');
    });
});
