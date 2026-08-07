import { test as baseTest } from "./util/fixtures";
import { describe, expect } from "vitest";
import { MessageEventContent } from "matrix-bot-sdk";

const test = baseTest.override("testEnvOpts", {
  matrixLocalparts: ["denied_user", "allowed_user", "legacy_user"],
  permissionsRoom: {
    members: ["allowed_user"],
    permissions: [
      {
        level: "manageConnections",
        service: "generic",
      },
    ],
  },
  e2eClientOpts: {
    autoAcceptInvite: true,
  },
  config: {
    gitlab: {
      instances: {
        test: {
          url: "https://example.org/foo/bar",
        },
      },
      webhook: {
        secret: "foo!",
      },
    },
    generic: {
      enabled: true,
      urlPrefix: `http://localhost`,
    },
    permissions: [
      {
        actor: "legacy_user",
        services: [
          {
            service: "webhooks",
            level: "manageConnections",
          },
        ],
      },
    ],
  },
});

describe("Permissions test", () => {
  test("should only allow users in the permissions room", async ({
    testEnv,
  }) => {
    const deniedUser = testEnv.getUser("denied_user");
    const allowedUser = testEnv.getUser("allowed_user");

    // Invite allowed user to permissions room
    const roomId = await deniedUser.createRoom({
      name: "Test room",
      invite: [await allowedUser.getUserId()],
    });

    await deniedUser.inviteUser(testEnv.botMxid, roomId);
    // User is not in the permissions room
    const { data } = await deniedUser.waitForRoomLeave({
      sender: testEnv.botMxid,
      roomId,
    });
    expect(data.content.reason).to.equal(
      "You do not have permission to invite this bot.",
    );

    await allowedUser.inviteUser(testEnv.botMxid, roomId);
    await deniedUser.waitForRoomJoin({ sender: testEnv.botMxid, roomId });
  });

  test("should disallow users without permission to use a service", async ({
    testEnv,
  }) => {
    const user = testEnv.getUser("allowed_user");
    const roomId = await user.createRoom({
      name: "Test room",
      invite: [testEnv.botMxid],
    });
    await user.waitForRoomJoin({ sender: testEnv.botMxid, roomId });

    // Try to create a GitLab connection, should fail.
    const msgGitLab = user.waitForRoomEvent<MessageEventContent>({
      eventType: "m.room.message",
      sender: testEnv.botMxid,
      roomId,
    });
    await user.sendText(
      roomId,
      "!hookshot gitlab project https://github.com/my/project",
    );
    expect((await msgGitLab).data.content.body).to.include(
      "Failed to handle command: You are not permitted to provision connections for gitlab.",
    );
  });

  for (const localpart of ["allowed_user", "legacy_user"] as const) {
    test(`should allow users with permission to use a service (${localpart})`, async ({
      testEnv,
    }) => {
      const user = testEnv.getUser(localpart);
      const roomId = await user.createRoom({
        name: "Test room",
        invite: [testEnv.botMxid],
      });
      await user.setUserPowerLevel(testEnv.botMxid, roomId, 50);
      await user.waitForRoomJoin({ sender: testEnv.botMxid, roomId });

      const msgWebhooks = user.waitForRoomEvent<MessageEventContent>({
        eventType: "m.room.message",
        sender: testEnv.botMxid,
        roomId,
      });
      await user.sendText(roomId, "!hookshot webhook test");
      expect((await msgWebhooks).data.content.body).to.include(
        "Room configured to bridge webhooks. See admin room for secret url.",
      );
    });
  }

  test("should allow users with permission to use a service in a v12 room", async ({
    testEnv,
  }) => {
    const user = testEnv.getUser("allowed_user");
    const roomId = await user.createRoom({
      name: "Test room",
      invite: [testEnv.botMxid],
      room_version: "12",
    });
    await user.setUserPowerLevel(testEnv.botMxid, roomId, 50);
    await user.waitForRoomJoin({ sender: testEnv.botMxid, roomId });

    const msgWebhooks = user.waitForRoomEvent<MessageEventContent>({
      eventType: "m.room.message",
      sender: testEnv.botMxid,
      roomId,
    });
    await user.sendText(roomId, "!hookshot webhook test");
    expect((await msgWebhooks).data.content.body).to.include(
      "Room configured to bridge webhooks. See admin room for secret url.",
    );
  });
});
