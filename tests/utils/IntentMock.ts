
import { expect } from "chai";
export class MatrixClientMock {
    async setDisplayName() {
        return;
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
