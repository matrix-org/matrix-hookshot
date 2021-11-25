import EventEmitter from "events";
import { Intent } from "matrix-bot-sdk";
import { BridgeConfig } from "./Config/Config";
import { UserTokenStore } from "./UserTokenStore";

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

    // This needs moving to the JIRA specific impl.
    protected pendingJiraOAuthState: string|null = null;

    public get jiraOAuthState() {
        return this.pendingJiraOAuthState;
    }

    public clearJiraOauthState() {
        this.pendingJiraOAuthState = null;
    }

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