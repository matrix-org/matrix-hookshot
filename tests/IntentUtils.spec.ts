import { describe, it, expect } from "vitest";
import { IntentMock, MatrixClientMock } from "./utils/IntentMock";
import { ensureUserIsInRoom } from "../src/IntentUtils";
import { MatrixError } from "matrix-bot-sdk";

const ROOM_ID = "!foo:bar";
const SENDER_USER_ID = "@my_target:foo";

describe("IntentUtils", () => {
  describe("ensureUserIsInRoom", () => {
    it("no-ops if the user is already joined to the room", async () => {
      const targetIntent = IntentMock.create(SENDER_USER_ID);
      targetIntent.ensureJoined = () => {
        /* No-op */
      };
      const matrixClient = MatrixClientMock.create();
      await ensureUserIsInRoom(targetIntent, matrixClient, ROOM_ID);
    });

    it("invites the user to the room and joins", async () => {
      const targetIntent = IntentMock.create(SENDER_USER_ID);
      const matrixClient = MatrixClientMock.create();
      let hasInvited = false;
      targetIntent.ensureJoined = (roomId: string) => {
        if (hasInvited) {
          return;
        }
        expect(roomId).toBe(ROOM_ID);
        throw new MatrixError(
          { errcode: "M_FORBIDDEN", error: "Test forced error" },
          401,
          {},
        );
      };

      matrixClient.inviteUser = (userId: string, roomId: string) => {
        expect(userId).toBe(SENDER_USER_ID);
        expect(roomId).toBe(ROOM_ID);
        hasInvited = true;
      };

      await ensureUserIsInRoom(targetIntent, matrixClient, ROOM_ID);
      expect(hasInvited).toBe(true);
    });

    it("invites the user to the room and handles the failure", async () => {
      const targetIntent = IntentMock.create(SENDER_USER_ID);
      const matrixClient = MatrixClientMock.create();

      targetIntent.ensureJoined = () => {
        throw new MatrixError(
          { errcode: "FORCED_FAILURE", error: "Test forced error" },
          500,
          {},
        );
      };
      await expect(
        ensureUserIsInRoom(targetIntent, matrixClient, ROOM_ID),
      ).rejects.toThrow(
        `Could not ensure that ${SENDER_USER_ID} is in ${ROOM_ID}`,
      );
    });

    it("does not invite for a plain object with a forbidden error code", async () => {
      const targetIntent = IntentMock.create(SENDER_USER_ID);
      const matrixClient = MatrixClientMock.create();
      let hasInvited = false;

      targetIntent.ensureJoined = () => {
        if (hasInvited) {
          return;
        }
        throw { errcode: "M_FORBIDDEN" };
      };
      matrixClient.inviteUser = () => {
        hasInvited = true;
      };

      await expect(
        ensureUserIsInRoom(targetIntent, matrixClient, ROOM_ID),
      ).rejects.toThrow(
        `Could not ensure that ${SENDER_USER_ID} is in ${ROOM_ID}`,
      );
      expect(hasInvited).toBe(false);
    });
  });
});
