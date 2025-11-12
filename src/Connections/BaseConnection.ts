import { MatrixClient, MatrixError } from "matrix-bot-sdk";
import { FormatUtil } from "../FormatUtil";

/**
 * Base connection class from which all connections should extend from.
 */
export abstract class BaseConnection {
  constructor(
    public readonly roomId: string,
    public readonly stateKey: string,
    public readonly canonicalStateType: string,
  ) {}

  public get connectionId(): string {
    return FormatUtil.hashId(
      `${this.roomId}/${this.canonicalStateType}/${this.stateKey}`,
    );
  }

  public get priority(): number {
    return -1;
  }
}

export async function removeConnectionState(
  client: MatrixClient,
  roomId: string,
  stateKey: string,
  {
    CanonicalEventType,
    LegacyEventType,
  }: { CanonicalEventType: string; LegacyEventType?: string },
) {
  try {
    await client.getRoomStateEventContent(roomId, CanonicalEventType, stateKey);
  } catch (ex) {
    if (ex instanceof MatrixError && ex.errcode === "M_NOT_FOUND") {
      if (!LegacyEventType) {
        throw Error("No state found, cannot remove connection");
      }
      try {
        await client.getRoomStateEventContent(
          roomId,
          LegacyEventType,
          stateKey,
        );
      } catch (ex) {
        if (ex instanceof MatrixError && ex.errcode === "M_NOT_FOUND") {
          throw Error("No state found, cannot remove connection");
        }
        throw ex;
      }
      await client.sendStateEvent(roomId, LegacyEventType, stateKey, {
        disabled: true,
      });
    } else {
      throw ex;
    }
  }
  await client.sendStateEvent(roomId, CanonicalEventType, stateKey, {
    disabled: true,
  });
}
