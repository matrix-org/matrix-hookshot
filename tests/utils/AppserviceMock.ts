import { IntentMock } from "./IntentMock";

export class AppserviceMock {
    public readonly botIntent = IntentMock.create();
    static create(){
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new this() as any;
    }

    get botUserId() {
        return `@bot:example.com`;
    }

    get botClient() {
        return this.botIntent.underlyingClient;
    }

    public getIntentForUserId() {
        return IntentMock.create();
    }
}
