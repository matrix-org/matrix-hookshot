import { Intent } from "matrix-bot-sdk";
import { promises as fs } from "fs";
import { publicEncrypt, privateDecrypt } from "crypto";
import { LogWrapper } from "./LogWrapper";

const ACCOUNT_DATA_TYPE = "uk.half-shot.matrix-github.password-store:";
const log = new LogWrapper("UserTokenStore");

export class UserTokenStore {
    private key!: Buffer;
    private userTokens: Map<string, string>;
    constructor(private keyPath: string, private intent: Intent) {
        this.userTokens = new Map();
    }

    public async load() {
        this.key = await fs.readFile(this.keyPath);
    }

    public async storeUserToken(userId: string, token: string): Promise<void> {
        await this.intent.underlyingClient.setAccountData(`${ACCOUNT_DATA_TYPE}${userId}`, {
            encrypted: publicEncrypt(this.key, Buffer.from(token)).toString("base64"),
        });
        this.userTokens.set(userId, token);
        log.info("Stored new token for", userId);
    }

    public async getUserToken(userId: string): Promise<string|null> {
        if (this.userTokens.has(userId)) {
            return this.userTokens.get(userId)!;
        }
        let obj;
        try {
            obj = await this.intent.underlyingClient.getAccountData(`${ACCOUNT_DATA_TYPE}${userId}`);
        } catch (ex) {
            return null;
        }
        const encryptedTextB64 = obj.encrypted;
        const encryptedText = Buffer.from(encryptedTextB64, "base64");
        const token = privateDecrypt(this.key, encryptedText).toString("utf-8");
        this.userTokens.set(userId, token);
        return token;
    }
}
