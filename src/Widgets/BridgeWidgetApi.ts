import { Application, NextFunction, Response } from "express";
import { AdminRoom } from "../AdminRoom";
import { Logger } from "matrix-appservice-bridge";
import { ApiError, ErrCode } from "../api";
import { BridgeConfig } from "../config/Config";
import { GetAuthPollResponse, GetAuthResponse, GetConnectionsForServiceResponse } from "./BridgeWidgetInterface";
import { ProvisioningApi, ProvisioningRequest } from "matrix-appservice-bridge";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";
import { ConnectionManager } from "../ConnectionManager";
import BotUsersManager, {BotUser} from "../Managers/BotUsersManager";
import { assertUserPermissionsInRoom, GetConnectionsResponseItem } from "../provisioning/api";
import { Appservice, PowerLevelsEvent } from "matrix-bot-sdk";
import { GithubInstance } from '../github/GithubInstance';
import { AllowedTokenTypes, TokenType, UserTokenStore } from '../tokens/UserTokenStore';

const log = new Logger("BridgeWidgetApi");

export class BridgeWidgetApi extends ProvisioningApi {
    constructor(
        private adminRooms: Map<string, AdminRoom>,
        private readonly config: BridgeConfig,
        storageProvider: IBridgeStorageProvider,
        expressApp: Application,
        private readonly connMan: ConnectionManager,
        private readonly botUsersManager: BotUsersManager,
        private readonly as: Appservice,
        private readonly tokenStore: UserTokenStore,
        private readonly github?: GithubInstance,
    ) {
        super(
            storageProvider,
        {
            apiPrefix: "/widgetapi",
            widgetFrontendLocation: "public",
            expressApp,
            widgetTokenPrefix: "hookshot_",
            disallowedIpRanges: config.widgets?.disallowedIpRanges,
            openIdOverride: config.widgets?.openIdOverrides,
        });
        
        const wrapHandler = (handler: (req: ProvisioningRequest, res: Response, next?: NextFunction) => Promise<unknown>) => {
            return async (req: ProvisioningRequest, res: Response) => {
                await handler.call(this, req, res);
            }
        }
        this.addRoute("get", "/v1/state", wrapHandler(this.getRoomState));
        this.addRoute("get", '/v1/config/sections', wrapHandler(this.getConfigSections));
        this.addRoute("get", '/v1/service/:service/config', wrapHandler(this.getServiceConfig));
        this.addRoute("get", '/v1/:roomId/connections', wrapHandler(this.getConnections));
        this.addRoute("get", '/v1/:roomId/connections/:service', wrapHandler(this.getConnectionsForService));
        this.addRoute("post", '/v1/:roomId/connections/:type', wrapHandler(this.createConnection));
        this.addRoute("put", '/v1/:roomId/connections/:connectionId', wrapHandler(this.updateConnection));
        this.addRoute("patch", '/v1/:roomId/connections/:connectionId', wrapHandler(this.updateConnection));
        this.addRoute("delete", '/v1/:roomId/connections/:connectionId', wrapHandler(this.deleteConnection));
        this.addRoute("get", '/v1/targets/:type', wrapHandler(this.getConnectionTargets));
        this.addRoute('get', '/v1/service/:service/auth', wrapHandler(this.getAuth));
        this.addRoute('get', '/v1/service/:service/auth/:state', wrapHandler(this.getAuthPoll));
        this.addRoute('post', '/v1/service/:service/auth/logout', wrapHandler(this.postAuthLogout));
    }

    private async getBotUserInRoom(roomId: string, serviceType?: string): Promise<BotUser> {
        let botUser = this.botUsersManager.getBotUserInRoom(roomId, serviceType);
        if (!botUser) {
            // Not bot in the room...yet. Let's try an ensure join.
            const intent = (serviceType && this.botUsersManager.getBotUserForService(serviceType)?.intent) || this.as.botIntent;
            try {
                await intent.ensureJoined(roomId);
            } catch (ex) {
                // Just fail with this, we couldn't join.
                throw new ApiError("Bot was not invited to the room.", ErrCode.NotInRoom);
            }
            botUser = this.botUsersManager.getBotUserInRoom(roomId, serviceType);
            if (!botUser) {
                throw new ApiError("Bot is not joined to the room.", ErrCode.NotInRoom);
            }
        }
        return botUser;
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
            res.send(await room.getBridgeState());
        } catch (ex) {
            log.error(`Failed to get room state:`, ex);
            throw new ApiError("An error occurred when getting room state", ErrCode.Unknown);
        }
    }

    private async getConfigSections(req: ProvisioningRequest, res: Response<{[section: string]: boolean}>) {
        res.send({
            general: true,
            github: !!this.config.github,
            gitlab: !!this.config.gitlab,
            generic: !!this.config.generic?.enabled,
            genericOutbound: !!this.config.generic?.outbound,
            jira: !!this.config.jira,
            figma: !!this.config.figma,
            feeds: !!this.config.feeds?.enabled,
        });
    }

    private async getServiceConfig(req: ProvisioningRequest, res: Response<object>) {
        // GitHub is a special case because it depends on live config.
        if (req.params.service === 'github') {
            res.send(this.config.github?.publicConfig(this.github));
        } else {
            res.send(await this.config.getPublicConfigForService(req.params.service));
        }
    }

    private async getConnectionsForRequest(req: ProvisioningRequest) {
        if (!req.userId) {
            throw Error('Cannot get connections without a valid userId');
        }
        const roomId = req.params.roomId;
        const serviceType = req.params.service;

        const botUser = await this.getBotUserInRoom(roomId, serviceType);
        await assertUserPermissionsInRoom(req.userId, roomId, "read", botUser.intent);
        const allConnections = this.connMan.getAllConnectionsForRoom(roomId);
        const powerlevel = new PowerLevelsEvent({content: await botUser.intent.underlyingClient.getRoomStateEvent(roomId, "m.room.power_levels", "")});
        const serviceFilter = req.params.service;
        const connections = allConnections.map(c => c.getProvisionerDetails?.(true))
            .filter(c => !!c)
            // If we have a service filter.
            .filter(c => typeof serviceFilter !== "string" || c?.service === serviceFilter) as GetConnectionsResponseItem[];
        const userPl = powerlevel.content.users?.[req.userId] || powerlevel.defaultUserLevel;
        const botPl = powerlevel.content.users?.[botUser.userId] || powerlevel.defaultUserLevel;
        for (const c of connections) {
            // TODO: What about crypto?
            const requiredPlForEdit = Math.max(powerlevel.content.events?.[c.type] ?? 0, powerlevel.defaultStateEventLevel);
            const requiredPlForMessages = Math.max(powerlevel.content.events?.["m.room.message"] ?? powerlevel.content.events_default ?? 0);
            c.canEdit = userPl >= requiredPlForEdit;
            c.canSendMessages = botPl >= requiredPlForMessages;
            if (!c.canEdit) {
                delete c.secrets;
            }
        }

        return {
            connections,
            canEdit: userPl >= powerlevel.defaultStateEventLevel,
        };
    }

    private async getConnections(req: ProvisioningRequest, res: Response<GetConnectionsResponseItem[]>) {
        res.send((await this.getConnectionsForRequest(req)).connections);
    }

    private async getConnectionsForService(req: ProvisioningRequest, res: Response<GetConnectionsForServiceResponse<GetConnectionsResponseItem>>) {
        res.send(await this.getConnectionsForRequest(req));
    }

    private async createConnection(req: ProvisioningRequest, res: Response<GetConnectionsResponseItem>) {
        if (!req.userId) {
            throw Error('Cannot get connections without a valid userId');
        }
        const roomId = req.params.roomId;
        const eventType = req.params.type;
        const connectionType = this.connMan.getConnectionTypeForEventType(eventType);
        if (!connectionType) {
            throw new ApiError("Unknown event type", ErrCode.NotFound);
        }
        const serviceType = connectionType.ServiceCategory;

        const botUser = await this.getBotUserInRoom(roomId, serviceType);
        await assertUserPermissionsInRoom(req.userId, roomId, "write", botUser.intent);
        try {
            if (!req.body || typeof req.body !== "object") {
                throw new ApiError("A JSON body must be provided", ErrCode.BadValue);
            }
            this.connMan.validateCommandPrefix(req.params.roomId, req.body);
            const result = await this.connMan.provisionConnection(roomId, botUser.intent, req.userId, connectionType, req.body);
            if (!result.connection.getProvisionerDetails) {
                throw new Error('Connection supported provisioning but not getProvisionerDetails');
            }
            res.send({
                ...result.connection.getProvisionerDetails(true),
                warning: result.warning,
            });
        } catch (ex) {
            log.error(`Failed to create connection for ${req.params.roomId}`, ex);
            throw ex;
        }
    }

    private async updateConnection(req: ProvisioningRequest, res: Response<GetConnectionsResponseItem>) {
        if (!req.userId) {
            throw Error('Cannot get connections without a valid userId');
        }
        const roomId = req.params.roomId;
        const serviceType = req.params.type;
        const connectionId = req.params.connectionId;

        const botUser = await this.getBotUserInRoom(roomId, serviceType);
        await assertUserPermissionsInRoom(req.userId, roomId, "write", botUser.intent);
        const connection = this.connMan.getConnectionById(roomId, connectionId);
        if (!connection) {
            throw new ApiError("Connection does not exist", ErrCode.NotFound);
        }
        if (!connection.provisionerUpdateConfig || !connection.getProvisionerDetails)  {
            throw new ApiError("Connection type does not support updates", ErrCode.UnsupportedOperation);
        }
        this.connMan.validateCommandPrefix(roomId, req.body, connection);
        await connection.provisionerUpdateConfig(req.userId, req.body);
        res.send(connection.getProvisionerDetails(true));
    }

    private async deleteConnection(req: ProvisioningRequest, res: Response<{ok: true}>) {
        if (!req.userId) {
            throw Error('Cannot get connections without a valid userId');
        }
        const roomId = req.params.roomId;
        const serviceType = req.params.type;
        const connectionId = req.params.connectionId;

        const botUser = await this.getBotUserInRoom(roomId, serviceType);
        await assertUserPermissionsInRoom(req.userId, roomId, "write", botUser.intent);
        const connection = this.connMan.getConnectionById(roomId, connectionId);
        if (!connection) {
            throw new ApiError("Connection does not exist", ErrCode.NotFound);
        }
        if (!connection.onRemove) {
            throw new ApiError("Connection does not support removal", ErrCode.UnsupportedOperation);
        }
        await this.connMan.purgeConnection(roomId, connectionId);
        res.send({ok: true});
    }

    private async getConnectionTargets(req: ProvisioningRequest, res: Response) {
        if (!req.userId) {
            throw Error('Cannot get connections without a valid userId');
        }
        const type = req.params.type;
        const connections = await this.connMan.getConnectionTargets(req.userId, type, req.query);
        res.send(connections);
    }


    private async getAuth(req: ProvisioningRequest, res: Response<GetAuthResponse>) {
        if (!req.userId) {
            throw Error('Expected userId on request');
        }
        const service = req.params.service;
        if (!service) {
            throw Error('Expected service in parameters');
        }

        // TODO: Should this be part of the GitHub module code.
        if (service === 'github') {
            if (!this.config.github || !this.config.github.oauth) {
                throw new ApiError('GitHub oauth is not configured', ErrCode.DisabledFeature);
            }

            let user;
            try {
                const octokit = await this.tokenStore.getOctokitForUser(req.userId);
                if (octokit !== null) {
                    const me = await octokit.users.getAuthenticated();
                    user = {
                        name: me.data.login,
                    };
                }
            } catch (e) {
                // Need to authenticate
            }

            if (user) {
                return res.json({
                    authenticated: true,
                    user
                });
            } else {
                const state = this.tokenStore.createStateForOAuth(req.userId);
                const authUrl = GithubInstance.generateOAuthUrl(
                    this.config.github.baseUrl,
                    'authorize',
                    {
                        state,
                        client_id: this.config.github.oauth.client_id,
                        redirect_uri: this.config.github.oauth.redirect_uri,
                    }
                );
                return res.json({
                    authenticated: false,
                    stateId: state,
                    authUrl
                });
            }
        } else {
            throw new ApiError('Service not found', ErrCode.NotFound);
        }
    }

    private async getAuthPoll(req: ProvisioningRequest, res: Response<GetAuthPollResponse>) {
        if (!req.userId) {
            throw Error('Expected userId on request');
        }
        const { service, state } = req.params;
    
        if (!service) {
            throw Error('Expected service in parameters');
        }
        
        // N.B. Service isn't really used.
        const stateUserId = this.tokenStore.getUserIdForOAuthState(state, false);

        if (!stateUserId || req.userId !== stateUserId) {
            // If the state isn't found then either the state has been completed or the key is wrong.
            // We don't actually know, so we assume the sender knows what they are doing.
            res.send({
                state: 'complete',
            });
            return;
        }
        res.send({
            state: 'waiting',
        });
        return;
    }

    private async postAuthLogout(req: ProvisioningRequest, res: Response<{ok: true}>) {
        if (!req.userId) {
            throw Error('Expected userId on request');
        }
        const { service } = req.params;
    
        if (!service) {
            throw Error('Expected service in parameters');
        }

        if (AllowedTokenTypes.includes(service)) {
            const result = await this.tokenStore.clearUserToken(service as TokenType, req.userId);
            if (result) {
                res.send({ok: true});
            } else {
                throw new ApiError("You are not logged in", ErrCode.NotFound);
            }
        } else {
            throw new ApiError('Service not found', ErrCode.NotFound);
        }
    }
}
