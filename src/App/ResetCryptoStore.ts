import { rm } from "fs/promises";

import { BridgeConfig, parseRegistrationFile } from "../config/Config";
import { Logger } from "matrix-appservice-bridge";
import { LogService, MatrixClient } from "matrix-bot-sdk";
import { getAppservice } from "../appservice";
import BotUsersManager from "../Managers/BotUsersManager";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";

const log = new Logger("ResetCryptoStore");

let bridgeStorage: IBridgeStorageProvider | undefined;

async function start() {
    const configFile = process.argv[2] || "./config.yml";
    const registrationFile = process.argv[3] || "./registration.yml";
    const config = await BridgeConfig.parseConfig(configFile, process.env);
    const registration = await parseRegistrationFile(registrationFile);
    Logger.configure({
        console: config.logging.level,
        colorize: config.logging.colorize,
        json: config.logging.json,
        timestampFormat: config.logging.timestampFormat
    });
    LogService.setLogger(Logger.botSdkLogger);

    const {appservice, storage, cryptoStorage} = getAppservice(config, registration);
    bridgeStorage = storage;
    if (!cryptoStorage) {
        log.info(`Encryption is not enabled in the configuration file "${configFile}", so there is no encryption state to be reset`);
        return;
    }

    const botUsersManager = new BotUsersManager(config, appservice);

    for (const botUser of botUsersManager.botUsers) {
        try {
            const userStorage = storage.storageForUser?.(botUser.userId);
            if (!userStorage) {
                log.warn(`No storage for ${botUser.userId}`);
                continue;
            }
            const accessToken = await userStorage?.readValue("accessToken");
            if (!accessToken) {
                log.debug(`No access token for ${botUser.userId}: no session to remove`);
                continue;
            }

            const userCryptoStorage = cryptoStorage?.storageForUser(botUser.userId);
            if (!userCryptoStorage) {
                log.warn(`No crypto storage for ${botUser.userId}`);
                continue;
            }
            const deviceId = await userCryptoStorage?.getDeviceId();
            if (!deviceId) {
                log.debug(`No crypto device ID for ${botUser.userId}: no crypto state to remove`);
                continue;
            }

            const client = new MatrixClient(config.bridge.url, accessToken, userStorage, userCryptoStorage);
            await client.doRequest("POST", "/_matrix/client/v3/logout", {
                user_id: botUser.userId,
                "org.matrix.msc3202.device_id": deviceId,
            });
            log.info(`Logged out crypto device for ${botUser.userId}`);

            try {
                await userStorage.storeValue("accessToken", "");
                log.info(`Deleted access token for ${botUser.userId}`);
            } catch (ex: unknown) {
                log.error(`Failed to delete access token for ${botUser.userId}`, ex);
            }

        } catch (ex: unknown) {
            log.error(`Failed to log out crypto device for ${botUser.userId}`, ex);
        }
    }

    if (config.encryption?.storagePath) {
        try {
            await rm(config.encryption.storagePath, { recursive: true, force: true });
            log.info("Removed crypto store from disk");
        } catch (ex) {
            log.error("Failed to remove crypto store from disk", ex);
        }
    }
}

start().catch((ex) => {
    log.error("ResetCryptoStore encountered an error and has stopped:", ex);
}).finally(() => {
    bridgeStorage?.disconnect?.();
});
