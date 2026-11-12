import { Appservice } from "matrix-bot-sdk";
import { Logger } from "matrix-appservice-bridge";

/**
 * The device is a transport destination for appservice to-device delivery.
 * It is deliberately fixed so a restart reuses the same homeserver device.
 */
export const HOOKSHOT_TO_DEVICE_RECEIVER_DEVICE_ID = "HOOKSHOT_CAPABILITIES";

const log = new Logger("HookshotToDeviceDeviceProvisioner");

/**
 * Ensure that each configured capability bot has a visible Matrix device.
 *
 * MSC4190 makes PUT /devices/{device_id} an appservice-authorised upsert. The
 * appservice token authenticates the request and the SDK's Intent supplies the
 * user_id query parameter when the target is a service bot.
 *
 * Encrypted intents have their device provisioned by matrix-bot-sdk's crypto
 * setup. Callers must leave those devices alone to avoid creating a second
 * device for the same bot.
 */
export async function provisionToDeviceReceiverDevices(
  appservice: Appservice,
  capabilityBotUserIds: Iterable<string>,
  encryptionEnabled: boolean,
): Promise<void> {
  if (encryptionEnabled) {
    return;
  }

  const botUserIds = new Set(capabilityBotUserIds);
  for (const botUserId of botUserIds) {
    await provisionToDeviceReceiverDevice(appservice, botUserId);
  }
}

async function provisionToDeviceReceiverDevice(
  appservice: Appservice,
  botUserId: string,
): Promise<void> {
  const intent = appservice.getIntentForUserId(botUserId);
  try {
    await intent.ensureRegistered();
    await intent.underlyingClient.doRequest(
      "PUT",
      `/_matrix/client/v3/devices/${encodeURIComponent(
        HOOKSHOT_TO_DEVICE_RECEIVER_DEVICE_ID,
      )}`,
      null,
      {},
    );

    const devices = await intent.underlyingClient.getOwnDevices();
    if (
      !devices.some(
        (device) => device.device_id === HOOKSHOT_TO_DEVICE_RECEIVER_DEVICE_ID,
      )
    ) {
      throw new Error("device was not visible after provisioning");
    }
  } catch {
    // Do not log the SDK error: it may contain request details. The startup
    // error is intentionally limited to the bot, device, and outcome.
    log.error(
      `bot=${botUserId} device=${HOOKSHOT_TO_DEVICE_RECEIVER_DEVICE_ID} outcome=failed`,
    );
    throw new Error(
      `Failed to provision receiver device ${HOOKSHOT_TO_DEVICE_RECEIVER_DEVICE_ID} for bot ${botUserId}`,
    );
  }

  log.info(
    `bot=${botUserId} device=${HOOKSHOT_TO_DEVICE_RECEIVER_DEVICE_ID} outcome=ready`,
  );
}
