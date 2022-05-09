
import { expect } from "chai";
export class MatrixClientMock {
    async setDisplayName() {
        return;
    }
}

export class IntentMock {
    public readonly underlyingClient = new MatrixClientMock();
    public sentEvents: {roomId: string, content: any}[] = [];

    static create(){
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new this() as any;
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
        expect(this.sentEvents).to.be.empty;
    }

    expectEventBodyContains(matcher: string|RegExp, eventIndex?: number) {
        if (eventIndex !== undefined) {
            expect(this.sentEvents[eventIndex].content.body.includes(matcher)).to.be.true;
        }
        expect(!!this.sentEvents.find(ev => ev.content.body.includes(matcher))).to.be.true;
    }

    async ensureRegistered() {
        return true;
    }
}
