import EventEmitter from "events";
import { Intent } from "matrix-bot-sdk";
import { BridgeConfig } from "./config/Config";
import { UserTokenStore } from "./tokens/UserTokenStore";
import { botCommand } from "./BotCommands";

export enum Category {
    ConnectionManagement = "Connection Management",
    Github               = "Github",
    Gitlab               = "Gitlab",
    Jira                 = "Jira",
}

export interface AdminAccountData {
    // eslint-disable-next-line camelcase
    admin_user: string;
    github?: {
        notifications?: {
            enabled: boolean;
            participating?: boolean;
        };
    };
    gitlab?: {
        [instanceUrl: string]: {
            notifications: {
                enabled: boolean;
            }
        }
    }
}

export abstract class AdminRoomCommandHandler extends EventEmitter {
    public get accountData() {
        return {...this.data};
    }

    public get userId() {
        return this.data.admin_user;
    }

    constructor(
        protected readonly botIntent: Intent,
        public readonly roomId: string,
        protected tokenStore: UserTokenStore,
        protected readonly config: BridgeConfig,
        protected data: AdminAccountData,
    ) { 
        super();
    }
    public async sendNotice(noticeText: string) {
        return this.botIntent.sendText(this.roomId, noticeText, "m.notice");
    }

    public async copyStateFromRoom(sourceRoomId: string) {
        const stateEvents = await this.botIntent.underlyingClient.getRoomState(sourceRoomId);
        const hookshotEvents = stateEvents.filter(event => event.type.startsWith("hookshot."));
        for (const event of hookshotEvents) {
            await this.botIntent.underlyingClient.sendStateEvent(this.roomId, event.type, event.state_key, event.content);
        }
        await this.sendNotice(`Copied ${hookshotEvents.length} 'hookshot.*' events from ${sourceRoomId} to ${this.roomId}`);
    }

    @botCommand("copy_state", { help: "Copy state from another room", requiredArgs: ['sourceRoomId'], category: Category.ConnectionManagement })
    public async copyStateCommand(sourceRoomId: string) {
        await this.copyStateFromRoom(sourceRoomId);
    }
}
