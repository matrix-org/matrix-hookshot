import { IntentMock } from "./IntentMock";

export class AppserviceMock {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly intentMap = new Map<string, any>();
  public readonly botIntent = IntentMock.create(`@bot:example.com`);
  public namespace = "@hookshot_";

  static create() {
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
    let intent = this.intentMap.get(userId);
    if (intent) {
      return intent;
    }
    intent = IntentMock.create(userId);
    this.intentMap.set(userId, intent);
    return intent;
  }

  public isNamespacedUser(userId: string) {
    return userId.startsWith(this.namespace);
  }
}
