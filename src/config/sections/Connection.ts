import { ConnectionDeclarations } from "../../Connections";
import { ConnectionType } from "../../Connections/type";
import { ConfigError } from "../../Errors";

export interface BridgeConfigConnectionConfig {
  roomId: string;
  connectionType: string;
  stateKey: string;
  state: Record<string, unknown>;
}

export function validateConnectionConfig(
  connection: Record<keyof BridgeConfigConnectionConfig, unknown>,
  enabledServices: ConnectionType[],
): connection is BridgeConfigConnectionConfig {
  if (typeof connection.roomId !== "string") {
    throw new ConfigError("roomId", "is not a string");
  }
  if (typeof connection.stateKey !== "string") {
    throw new ConfigError("stateKey", "is not an string");
  }
  if (typeof connection.state !== "object") {
    throw new ConfigError("state", "is not an object");
  }
  if (typeof connection.connectionType !== "string") {
    throw new ConfigError("connectionType", "is not an string");
  }
  const cType = connection.connectionType;
  const resolvedcType = ConnectionDeclarations.find((c) =>
    c.EventTypes.includes(cType),
  );
  if (!resolvedcType) {
    throw new ConfigError("connectionType", "is not a known connection type");
  }
  if (!resolvedcType.SupportsStaticConfiguration) {
    throw new ConfigError(
      "connectionType",
      "does not support static configuration",
    );
  }
  if (!enabledServices.includes(resolvedcType.ServiceCategory)) {
    throw new ConfigError(
      "connectionType",
      `Service '${resolvedcType.ServiceCategory}' is not enabled in the config.`,
    );
  }

  return true;
}
