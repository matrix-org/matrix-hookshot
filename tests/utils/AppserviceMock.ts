import { IntentMock } from "./IntentMock";

export class AppserviceMock {
    static create(){
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new this() as any;
    }

    get botUserId() {
        return `@bot:example.com`;
    }

    public getIntentForUserId() {
        return IntentMock.create();
    }
}
