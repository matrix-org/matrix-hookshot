import { E2ESetupTestTimeout, E2ETestEnv } from "./util/e2e-test";
import { describe, expect, beforeAll, afterAll, test } from "vitest";
import { createHmac, randomUUID } from "crypto";
import { MessageEventContent } from "matrix-bot-sdk";
import { getBridgeApi } from "./util/bridge-api";
import { waitFor } from "./util/helpers";
import {
  OpenProjectConnection,
  OpenProjectConnectionState,
} from "../src/Connections/OpenProjectConnection";

const OPEN_PROJECT_PAYLOAD = {
  action: "work_package:created",
  work_package: {
    _type: "WorkPackage",
    id: 50,
    lockVersion: 0,
    subject: "test 133",
    description: { format: "markdown", raw: "", html: "" },
    scheduleManually: true,
    date: null,
    estimatedTime: null,
    derivedEstimatedTime: null,
    derivedRemainingTime: null,
    ignoreNonWorkingDays: false,
    percentageDone: null,
    derivedPercentageDone: null,
    createdAt: "2025-05-08T13:19:12.275Z",
    updatedAt: "2025-05-08T13:19:12.309Z",
    _embedded: {
      attachments: {
        _type: "Collection",
        total: 0,
        count: 0,
        _embedded: { elements: [] },
        _links: { self: { href: "/api/v3/work_packages/50/attachments" } },
      },
      relations: {
        _type: "Collection",
        total: 0,
        count: 0,
        _embedded: { elements: [] },
        _links: { self: { href: "/api/v3/work_packages/50/relations" } },
      },
      type: {
        _type: "Type",
        id: 2,
        name: "Milestone",
        color: "#35C53F",
        position: 2,
        isDefault: true,
        isMilestone: true,
        createdAt: "2025-05-08T11:36:17.444Z",
        updatedAt: "2025-05-08T11:36:17.444Z",
        _links: { self: { href: "/api/v3/types/2", title: "Milestone" } },
      },
      priority: {
        _type: "Priority",
        id: 8,
        name: "Normal",
        position: 2,
        color: "#74C0FC",
        isDefault: true,
        isActive: true,
        _links: { self: { href: "/api/v3/priorities/8", title: "Normal" } },
      },
      project: {
        _type: "Project",
        id: 1,
        identifier: "demo-project",
        name: "Demo project",
        active: true,
        public: true,
        description: {
          format: "markdown",
          raw: "This is a short summary of the goals of this demo project.",
          html: '\u003cp class="op-uc-p"\u003eThis is a short summary of the goals of this demo project.\u003c/p\u003e',
        },
        createdAt: "2025-05-08T11:36:19.527Z",
        updatedAt: "2025-05-08T11:36:19.527Z",
        statusExplanation: {
          format: "markdown",
          raw: "All tasks are on schedule. The people involved know their tasks. The system is completely set up.",
          html: '\u003cp class="op-uc-p"\u003eAll tasks are on schedule. The people involved know their tasks. The system is completely set up.\u003c/p\u003e',
        },
        _links: {
          self: { href: "/api/v3/projects/1", title: "Demo project" },
          createWorkPackage: {
            href: "/api/v3/projects/1/work_packages/form",
            method: "post",
          },
          createWorkPackageImmediately: {
            href: "/api/v3/projects/1/work_packages",
            method: "post",
          },
          workPackages: { href: "/api/v3/projects/1/work_packages" },
          storages: [],
          categories: { href: "/api/v3/projects/1/categories" },
          versions: { href: "/api/v3/projects/1/versions" },
          memberships: {
            href: "/api/v3/memberships?filters=%5B%7B%22project%22%3A%7B%22operator%22%3A%22%3D%22%2C%22values%22%3A%5B%221%22%5D%7D%7D%5D",
          },
          types: { href: "/api/v3/projects/1/types" },
          update: { href: "/api/v3/projects/1/form", method: "post" },
          updateImmediately: { href: "/api/v3/projects/1", method: "patch" },
          delete: { href: "/api/v3/projects/1", method: "delete" },
          schema: { href: "/api/v3/projects/schema" },
          ancestors: [],
          projectStorages: {
            href: "/api/v3/project_storages?filters=%5B%7B%22projectId%22%3A%7B%22operator%22%3A%22%3D%22%2C%22values%22%3A%5B%221%22%5D%7D%7D%5D",
          },
          parent: { href: null },
          status: {
            href: "/api/v3/project_statuses/on_track",
            title: "On track",
          },
        },
      },
      status: {
        _type: "Status",
        id: 1,
        name: "New",
        isClosed: false,
        color: "#1098AD",
        isDefault: true,
        isReadonly: false,
        excludedFromTotals: false,
        defaultDoneRatio: 0,
        position: 1,
        _links: { self: { href: "/api/v3/statuses/1", title: "New" } },
      },
      author: {
        _type: "User",
        id: 4,
        name: "OpenProject Admin",
        createdAt: "2025-05-08T11:36:19.023Z",
        updatedAt: "2025-05-08T11:41:10.832Z",
        login: "admin",
        admin: true,
        firstName: "OpenProject",
        lastName: "Admin",
        email: "admin@example.net",
        avatar:
          "http://gravatar.com/avatar/cb4f282fed12016bd18a879c1f27ff97?default=404\u0026secure=false",
        status: "active",
        identityUrl: null,
        language: "en",
        _links: {
          self: { href: "/api/v3/users/4", title: "OpenProject Admin" },
          memberships: {
            href: "/api/v3/memberships?filters=%5B%7B%22principal%22%3A%7B%22operator%22%3A%22%3D%22%2C%22values%22%3A%5B%224%22%5D%7D%7D%5D",
            title: "Memberships",
          },
          showUser: { href: "/users/4", type: "text/html" },
          updateImmediately: {
            href: "/api/v3/users/4",
            title: "Update admin",
            method: "patch",
          },
          lock: {
            href: "/api/v3/users/4/lock",
            title: "Set lock on admin",
            method: "post",
          },
          delete: {
            href: "/api/v3/users/4",
            title: "Delete admin",
            method: "delete",
          },
        },
      },
      customActions: [],
    },
    _links: {
      attachments: { href: "/api/v3/work_packages/50/attachments" },
      addAttachment: {
        href: "/api/v3/work_packages/50/attachments",
        method: "post",
      },
      fileLinks: { href: "/api/v3/work_packages/50/file_links" },
      addFileLink: {
        href: "/api/v3/work_packages/50/file_links",
        method: "post",
      },
      self: { href: "/api/v3/work_packages/50", title: "test 133" },
      update: { href: "/api/v3/work_packages/50/form", method: "post" },
      schema: { href: "/api/v3/work_packages/schemas/1-2" },
      updateImmediately: { href: "/api/v3/work_packages/50", method: "patch" },
      delete: { href: "/api/v3/work_packages/50", method: "delete" },
      logTime: {
        href: "/api/v3/time_entries",
        title: "Log time on work package 'test 133'",
      },
      move: {
        href: "/work_packages/50/move/new",
        type: "text/html",
        title: "Move work package 'test 133'",
      },
      copy: {
        href: "/work_packages/50/copy",
        type: "text/html",
        title: "Copy work package 'test 133'",
      },
      pdf: {
        href: "/work_packages/50.pdf",
        type: "application/pdf",
        title: "Export as PDF",
      },
      generate_pdf: {
        href: "/work_packages/50/generate_pdf_dialog",
        type: "text/vnd.turbo-stream.html",
        title: "Generate PDF",
      },
      atom: {
        href: "/work_packages/50.atom",
        type: "application/rss+xml",
        title: "Atom feed",
      },
      availableRelationCandidates: {
        href: "/api/v3/work_packages/50/available_relation_candidates",
        title: "Potential work packages to relate to",
      },
      customFields: {
        href: "/projects/demo-project/settings/custom_fields",
        type: "text/html",
        title: "Custom fields",
      },
      configureForm: {
        href: "/types/2/edit?tab=form_configuration",
        type: "text/html",
        title: "Configure form",
      },
      activities: { href: "/api/v3/work_packages/50/activities" },
      availableWatchers: {
        href: "/api/v3/work_packages/50/available_watchers",
      },
      relations: { href: "/api/v3/work_packages/50/relations" },
      revisions: { href: "/api/v3/work_packages/50/revisions" },
      watchers: { href: "/api/v3/work_packages/50/watchers" },
      addWatcher: {
        href: "/api/v3/work_packages/50/watchers",
        method: "post",
        payload: { user: { href: "/api/v3/users/{user_id}" } },
        templated: true,
      },
      removeWatcher: {
        href: "/api/v3/work_packages/50/watchers/{user_id}",
        method: "delete",
        templated: true,
      },
      addRelation: {
        href: "/api/v3/work_packages/50/relations",
        method: "post",
        title: "Add relation",
      },
      changeParent: {
        href: "/api/v3/work_packages/50",
        method: "patch",
        title: "Change parent of test 133",
      },
      addComment: {
        href: "/api/v3/work_packages/50/activities",
        method: "post",
        title: "Add comment",
      },
      previewMarkup: {
        href: "/api/v3/render/markdown?context=/api/v3/work_packages/50",
        method: "post",
      },
      timeEntries: {
        href: "/api/v3/time_entries?filters=%5B%7B%22work_package_id%22%3A%7B%22operator%22%3A%22%3D%22%2C%22values%22%3A%5B%2250%22%5D%7D%7D%5D",
        title: "Time entries",
      },
      ancestors: [],
      category: { href: null },
      type: { href: "/api/v3/types/2", title: "Milestone" },
      priority: { href: "/api/v3/priorities/8", title: "Normal" },
      project: { href: "/api/v3/projects/1", title: "Demo project" },
      status: { href: "/api/v3/statuses/1", title: "New" },
      author: { href: "/api/v3/users/4", title: "OpenProject Admin" },
      responsible: { href: null },
      assignee: { href: null },
      version: { href: null },
      parent: { href: null, title: null },
      customActions: [],
      github: { href: "/work_packages/50/tabs/github", title: "github" },
      github_pull_requests: {
        href: "/api/v3/work_packages/50/github_pull_requests",
        title: "GitHub pull requests",
      },
      gitlab: { href: "/work_packages/50/tabs/gitlab", title: "gitlab" },
      gitlab_merge_requests: {
        href: "/api/v3/work_packages/50/gitlab_merge_requests",
        title: "Gitlab merge requests",
      },
      gitlab_issues: {
        href: "/api/v3/work_packages/50/gitlab_issues",
        title: "Gitlab Issues",
      },
      meetings: { href: "/work_packages/50/tabs/meetings", title: "meetings" },
      convertBCF: {
        href: "/api/bcf/2.1/projects/demo-project/topics",
        title: "Convert to BCF",
        payload: { reference_links: ["/api/v3/work_packages/50"] },
        method: "post",
      },
    },
  },
};

describe("OpenProject", () => {
  let testEnv: E2ETestEnv;
  const webhooksPort = 9500 + E2ETestEnv.workerId;

  beforeAll(async () => {
    testEnv = await E2ETestEnv.createTestEnv({
      matrixLocalparts: ["user"],
      config: {
        openProject: {
          webhook: {
            secret: randomUUID(),
          },
          baseUrl: "http://mytestproject.com/",
        },
        widgets: {
          publicUrl: `http://localhost:${webhooksPort}`,
        },
        listeners: [
          {
            port: webhooksPort,
            bindAddress: "0.0.0.0",
            // Bind to the SAME listener to ensure we don't have conflicts.
            resources: ["webhooks", "widgets"],
          },
        ],
      },
    });
    await testEnv.setUp();
  }, E2ESetupTestTimeout);

  afterAll(() => {
    return testEnv?.tearDown();
  });

  test("should be able to handle a OpenProject event", async () => {
    const user = testEnv.getUser("user");
    const bridgeApi = await getBridgeApi(
      testEnv.opts.config?.widgets?.publicUrl!,
      user,
    );
    const testRoomId = await user.createRoom({
      name: "Test room",
      invite: [testEnv.botMxid],
    });
    await user.setUserPowerLevel(testEnv.botMxid, testRoomId, 50);
    const openProjectId =
      OPEN_PROJECT_PAYLOAD.work_package._embedded.project.id;
    // Pre-grant connection to allow us to bypass the oauth dance.
    await user.waitForRoomJoin({ sender: testEnv.botMxid, roomId: testRoomId });

    // "Create" a JIRA connection.
    const url = `http://mytestproject.com/projects/${openProjectId}`;
    await testEnv.app.appservice.botClient.sendStateEvent(
      testRoomId,
      OpenProjectConnection.CanonicalEventType,
      url,
      {
        url,
        events: ["work_package:created", "work_package:updated"],
      } satisfies OpenProjectConnectionState,
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

    const webhookPayload = JSON.stringify(OPEN_PROJECT_PAYLOAD);

    const hmac = createHmac(
      "sha1",
      testEnv.opts.config?.openProject?.webhook.secret!,
    );
    hmac.write(webhookPayload);
    hmac.end();

    const req = await fetch(
      `http://localhost:${webhooksPort}/openproject/webhook`,
      {
        method: "POST",
        headers: {
          "X-Op-Signature": `sha1=${hmac.read().toString("hex")}`,
          "Content-Type": "application/json",
        },
        body: webhookPayload,
      },
    );
    expect(req.status).toBe(200);
    expect(await req.text()).toBe("OK");

    // And await the notice.
    const { body } = (await webhookNotice).data.content;
    expect(body).toContain(
      'OpenProject Admin created a new work package [50](http://mytestproject.com/projects/demo-project/work_packages/50): "test 133"',
    );
  });
});
