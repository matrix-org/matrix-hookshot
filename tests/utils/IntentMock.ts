
import { expect } from "chai";
import { MatrixError } from "matrix-bot-sdk";
export class MatrixClientMock {

    static create(){
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new this() as any;
    }

    // map room Id → user Ids
    private joinedMembers: Map<string, string[]> = new Map();
    public readonly roomAccountData: Map<string, string> = new Map();

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

    async getRoomAccountData(key: string, roomId: string): Promise<string> {
        const data = this.roomAccountData.get(roomId+key);
        if (data) {
            return data;
        }
        throw new MatrixError({
            errcode: 'M_NOT_FOUND',
            error: 'Test error: No account data',
        }, 404, { });
    }

    async setRoomAccountData(key: string, roomId: string, value: string): Promise<void> {
        this.roomAccountData.set(roomId+key, value);
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

    sendEvent(roomId: string, content: any): Promise<string> {
        this.sentEvents.push({
            roomId,
            content,
        });
        return Promise.resolve(`event_${this.sentEvents.length - 1}`);
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
            return;
        }
        expect(!!this.sentEvents.find(ev => ev.content.body.includes(matcher)), `Expected any event body to match '${matcher}'`).to.be.true;
    }

    expectEventMatches(matcher: (content: any) => boolean, description: string, eventIndex?: number) {
        if (eventIndex !== undefined) {
            expect(this.sentEvents[eventIndex], `Expected event ${eventIndex} to exist`).to.not.be.undefined;
            expect(matcher(this.sentEvents[eventIndex]), description).to.be.true;
            return;
        }
        expect(this.sentEvents.some(ev => matcher(ev)), description).to.be.true;
    }

    async ensureJoined() {
        return true;
    }

    async ensureRegistered() {
        return true;
    }
}
