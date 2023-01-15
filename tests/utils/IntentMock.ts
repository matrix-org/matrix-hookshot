
import { expect } from "chai";
export class MatrixClientMock {
    // map room Id → user Ids
    private joinedMembers: Map<string, string[]> = new Map();

    async setDisplayName() {
        return;
    }

    async getJoinedRoomMembers(roomId: string): Promise<string[]> {
        return this.joinedMembers.get(roomId) || [];
    }

    async inviteUser(userId: string, roomId: string): Promise<void> {
        const roomMembers = this.joinedMembers.get(roomId) || [];

        if (roomMembers.includes(userId)) {
            throw new Error("User already in room");
        }

        roomMembers.push(userId);
        this.joinedMembers.set(roomId, roomMembers);
    }
}

export class IntentMock {
    public readonly underlyingClient = new MatrixClientMock();
    public sentEvents: {roomId: string, content: any}[] = [];

    constructor(readonly userId: string) {}

    static create(userId: string){
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new this(userId) as any;
    }

    sendText(roomId: string, noticeText: string, msgtype: string) {
        this.sentEvents.push({
            roomId,
            content: {
                msgtype,
                body: noticeText,
            }
        });
    }

    sendEvent(roomId: string, content: any) {
        this.sentEvents.push({
            roomId,
            content,
        });
    }

    expectNoEvent() {
        expect(this.sentEvents, 'Expected no events to be sent.').to.be.empty;
    }

    expectEventBodyContains(matcher: string|RegExp, eventIndex?: number) {
        if (eventIndex !== undefined) {
            expect(this.sentEvents[eventIndex], `Expected event ${eventIndex} to exist`).to.not.be.undefined;
            const body = this.sentEvents[eventIndex].content.body;
            expect(
                body.includes(matcher),
                `Expected event body ${eventIndex} to match '${matcher}'.\nMessage was: '${body}'`
            ).to.be.true;
        }
        expect(!!this.sentEvents.find(ev => ev.content.body.includes(matcher)), `Expected any event body to match '${matcher}'`).to.be.true;
    }

    async ensureRegistered() {
        return true;
    }
}
