import { IntentMock, MatrixClientMock } from "./utils/IntentMock";
import { ensureUserIsInRoom } from "../src/IntentUtils";
import { expect } from "chai";
import { MatrixError } from "matrix-bot-sdk";

const ROOM_ID = "!foo:bar";
const SENDER_USER_ID = "@my_target:foo";

describe("IntentUtils", () => {
    describe("ensureUserIsInRoom", () => {
        it("no-ops if the user is already joined to the room", () => {
            const targetIntent = IntentMock.create(SENDER_USER_ID);
            targetIntent.ensureJoined = () => { /* No-op */ };
            const matrixClient = MatrixClientMock.create();
            ensureUserIsInRoom(targetIntent, matrixClient, ROOM_ID);
        });

        it("invites the user to the room and joins", () => {
            const targetIntent = IntentMock.create(SENDER_USER_ID);
            const matrixClient = MatrixClientMock.create();
            let hasInvited = false;
            // This should fail the first time, then pass once we've tried to invite the user
            targetIntent.ensureJoined = (roomId: string) => {
                if (hasInvited) {
                    return;
                }
                expect(roomId).to.equal(ROOM_ID);
                throw new MatrixError({ errcode: "M_FORBIDDEN", error: "Test forced error"}, 401, {})
            };

            // This should invite the puppet user.
            matrixClient.inviteUser = (userId: string, roomId: string) => {
                expect(userId).to.equal(SENDER_USER_ID);
                expect(roomId).to.equal(ROOM_ID);
                hasInvited = true;
            }

            ensureUserIsInRoom(targetIntent, matrixClient, ROOM_ID);
            // Only pass if we've actually bothered to invite the bot.
            expect(hasInvited).to.be.true;
        });

        it("invites the user to the room and handles the failure", () => {
            const targetIntent = IntentMock.create(SENDER_USER_ID);
            const matrixClient = MatrixClientMock.create();
    
            // This should fail the first time, then pass once we've tried to invite the user
            targetIntent.ensureJoined = () => {
                throw new MatrixError({ errcode: "FORCED_FAILURE", error: "Test forced error"}, 500, { })
            };
            try {
                ensureUserIsInRoom(targetIntent, matrixClient, ROOM_ID);
            } catch (ex) {
                expect(ex.message).to.contain(`Could not ensure that ${SENDER_USER_ID} is in ${ROOM_ID}`)
            }
        });
    })
});