import { Application, Response } from "express";
import { AdminRoom } from "../AdminRoom";
import LogWrapper from "../LogWrapper";
import { ApiError, ErrCode } from "../api";
import { BridgeConfig } from "../Config/Config";
import { WidgetConfigurationSection, WidgetConfigurationType } from "./BridgeWidgetInterface";
import { UserTokenStore } from "../UserTokenStore";
import { ProvisioningApi, ProvisioningRequest } from "matrix-appservice-bridge";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";
import { ConnectionManager } from "../ConnectionManager";
import { assertUserPermissionsInRoom, GetConnectionsResponseItem } from "../provisioning/api";
import { Intent, PowerLevelsEvent } from "matrix-bot-sdk";

const log = new LogWrapper("BridgeWidgetApi");
export class BridgeWidgetApi {
    private readonly api: ProvisioningApi;
    constructor(
        private adminRooms: Map<string, AdminRoom>,
        private readonly config: BridgeConfig,
        private readonly tokenStore: UserTokenStore,
        storageProvider: IBridgeStorageProvider,
        expressApp: Application,
        private readonly connMan: ConnectionManager,
        private readonly intent: Intent,
    ) {
        this.api = new ProvisioningApi(
            storageProvider,
        {
            apiPrefix: "/widgetapi",
            widgetFrontendLocation: "public",
            expressApp,
            widgetTokenPrefix: "hookshot_",
            openIdOverride: {
                'beefy': 'http://localhost:8008' as any,
            }
        });
        this.api.addRoute("get", "/v1/state", this.getRoomState.bind(this));
        this.api.addRoute("get", '/v1/config/sections', this.getConfigSections.bind(this));
        this.api.addRoute("get", '/v1/config/:section', this.getConfigSection.bind(this));
        this.api.addRoute("get", '/v1/:roomId/connections', this.getConnections.bind(this));
        // this.expressRouter.post('/widgetapi/v1/search/users', this.postSearchUsers.bind(this));
    }

    private async getRoomFromRequest(req: ProvisioningRequest): Promise<AdminRoom> {
        const room = [...this.adminRooms.values()].find(r => r.userId === req.userId);
        if (!room) {
            throw new ApiError("No room found for access token", ErrCode.BadToken);
        }
        return room;
    }

    private async getRoomState(req: ProvisioningRequest, res: Response) {
        try {
            const room = await this.getRoomFromRequest(req);
            await res.send(await room.getBridgeState());
        } catch (ex) {
            log.error(`Failed to get room state:`, ex);
            throw new ApiError("An error occured when getting room state", ErrCode.Unknown);
        }
    }

    private async getConfigSections(req: ProvisioningRequest, res: Response<{[section: string]: boolean}>) {
        res.send({
            general: true,
            github: !!this.config.github,
            gitlab: !!this.config.gitlab,
            generic: !!this.config.generic,
            jira: !!this.config.jira,
            figma: !!this.config.figma,
        });
    }

    private async getConfigSection(req: ProvisioningRequest, res: Response<WidgetConfigurationSection[]>) {
        await this.getRoomFromRequest(req);
        if (req.params.section !== "general") {
            throw new ApiError("Not a known config section", ErrCode.NotFound);
        }
        res.send(
            [{

                name: 'Overview',
                options: [{
                    key: 'name',
                    type: WidgetConfigurationType.String,
                    currentValue: null,
                    defaultValue: 'Agent Smith',
                }]
            }]
        );
    }

    private async getConnections(req: ProvisioningRequest, res: Response<GetConnectionsResponseItem[]>) {
        if (!req.userId) {
            throw Error('Cannot get connections without a valid userId');
        }
        await assertUserPermissionsInRoom(req.userId, req.params.roomId as string, "read", this.intent);
        const connections = this.connMan.getAllConnectionsForRoom(req.params.roomId as string);
        const powerlevel = new PowerLevelsEvent({content: await this.intent.underlyingClient.getRoomStateEvent(req.params.roomId, "m.room.power_levels", "")});
        const details = connections.map(c => c.getProvisionerDetails?.(true)).filter(c => !!c) as GetConnectionsResponseItem[];

        for (const c of details) {
            const userPl = powerlevel.content.users?.[req.userId] || powerlevel.defaultUserLevel;
            const requiredPl = Math.max(powerlevel.content.events?.[c.type] || 0, powerlevel.defaultStateEventLevel);
            c.canEdit = userPl >= requiredPl;
            if (userPl < requiredPl) {
                delete c.secrets;
            }
        }

        res.send(details);
    }

    // private async postSearchUsers(req: ProvisioningRequest, res: Response<UserSearchResults>, next: NextFunction) {
    //     const room = await this.getRoomFromRequest(req);
    //     const octokit = await this.tokenStore.getOctokitForUser(room.userId);
    //     if (!octokit) {
    //         next(new ApiError('You must be logged in to search GitHub', ErrCode.ForbiddenUser));
    //         return;
    //     }
    //     if (!req.query.query || typeof req.query.query !== "string" || req.query.query.length < 3) {
    //         next(new ApiError('Query was not a string of at least 3 characters', ErrCode.BadValue));
    //         return;
    //     }
    //     const searchResults = await octokit.search.users({q: req.query.query, per_page: 10});
    //     // Handle lots of results
    //     res.send({
    //         data: searchResults.data.items.map((u) => ({
    //             userId: `@_github_${u.login}:beefy`,
    //             service: 'github',
    //             displayName: u.name || u.login || undefined,
    //             rawAvatarUrl: u.avatar_url,
    //         }))
    //     });
    // }
}
