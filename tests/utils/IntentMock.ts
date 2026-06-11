import { expect } from "vitest";
import { MatrixError } from "matrix-bot-sdk";
import { MatrixCapabilities } from "matrix-bot-sdk/lib/models/Capabilities";

type SentEvent = { roomId: string; content: Record<string, any> };

export class MatrixClientMock {
  static create() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new this([]) as any;
  }

  // map room Id → user Ids
  private joinedMembers: Map<string, string[]> = new Map();
  public readonly roomAccountData: Map<string, string> = new Map();

  constructor(private readonly sentEvents: SentEvent[]) {}

  async setDisplayName() {
    return;
  }

  async getCapabilities(): Promise<MatrixCapabilities> {
    return {
      "m.set_displayname": {
        enabled: true,
      },
      "m.set_avatar_url": {
        enabled: true,
      },
    };
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
    const data = this.roomAccountData.get(roomId + key);
    if (data) {
      return data;
    }
    throw new MatrixError(
      {
        errcode: "M_NOT_FOUND",
        error: "Test error: No account data",
      },
      404,
      {},
    );
  }

  async setRoomAccountData(
    key: string,
    roomId: string,
    value: string,
  ): Promise<void> {
    this.roomAccountData.set(roomId + key, value);
  }

  async sendMessage(
    roomId: string,
    content: Record<string, unknown>,
  ): Promise<string> {
    this.sentEvents?.push({ roomId, content });
    return `event_${this.sentEvents.length - 1}`;
  }

  async sendStateEvent(): Promise<string> {
    return `$state_event_sent`;
  }
}

export class IntentMock {
  public sentEvents: SentEvent[] = [];
  public readonly underlyingClient = new MatrixClientMock(this.sentEvents);

  constructor(readonly userId: string) {}

  static create(userId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new this(userId) as any;
  }

  sendText(roomId: string, noticeText: string, msgtype: string) {
    this.sentEvents.push({
      roomId,
      content: {
        msgtype,
        body: noticeText,
      },
    });
  }

  sendEvent(roomId: string, content: Record<string, unknown>): Promise<string> {
    return this.underlyingClient.sendMessage(roomId, content);
  }

  expectNoEvent() {
    expect(this.sentEvents, "Expected no events to be sent.").toHaveLength(0);
  }

  expectEventBodyContains(matcher: string | RegExp, eventIndex?: number) {
    if (eventIndex !== undefined) {
      expect(
        this.sentEvents[eventIndex],
        `Expected event ${eventIndex} to exist`,
      ).toBeDefined();
      const body = this.sentEvents[eventIndex].content.body;
      expect(
        body.includes(matcher as string),
        `Expected event body ${eventIndex} to match '${matcher}'.\nMessage was: '${body}'`,
      ).toBe(true);
      return;
    }
    expect(
      !!this.sentEvents.find((ev) =>
        ev.content.body.includes(matcher as string),
      ),
      `Expected any event body to match '${matcher}'`,
    ).toBe(true);
  }

  expectEventMatches(
    matcher: (content: SentEvent) => boolean,
    description: string,
    eventIndex?: number,
  ) {
    if (eventIndex !== undefined) {
      expect(
        this.sentEvents[eventIndex],
        `Expected event ${eventIndex} to exist`,
      ).toBeDefined();
      expect(matcher(this.sentEvents[eventIndex]), description).toBe(true);
      return;
    }
    expect(
      this.sentEvents.some((ev) => matcher(ev)),
      description,
    ).toBe(true);
  }

  async ensureJoined() {
    return true;
  }

  async ensureRegistered() {
    return true;
  }
}
