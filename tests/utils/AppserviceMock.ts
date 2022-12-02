import { IntentMock } from "./IntentMock";

export class AppserviceMock {
    public readonly botIntent = IntentMock.create(`@bot:example.com`);
    static create(){
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new this() as any;
    }

    get botUserId() {
        return this.botIntent.userId;
    }

    get botClient() {
        return this.botIntent.underlyingClient;
    }

    public getIntentForUserId(userId: string) {
        return IntentMock.create(userId);
    }
}
