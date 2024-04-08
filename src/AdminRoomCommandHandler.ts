import EventEmitter from "events";
import { Intent } from "matrix-bot-sdk";
import { BridgeConfig } from "./config/Config";
import { UserTokenStore } from "./tokens/UserTokenStore";


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

}