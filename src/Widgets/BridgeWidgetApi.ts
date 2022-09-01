import { Application, NextFunction, Response } from "express";
import { AdminRoom } from "../AdminRoom";
import LogWrapper from "../LogWrapper";
import { ApiError, ErrCode } from "../api";
import { BridgeConfig } from "../Config/Config";
import { GetConnectionsForServiceResponse } from "./BridgeWidgetInterface";
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
            disallowedIpRanges: config.widgets?.disallowedIpRanges,
            openIdOverride: config.widgets?.openIdOverrides,
        });
        const wrapHandler = (handler: (req: ProvisioningRequest, res: Response, next?: NextFunction) => Promise<unknown>) => {
            return async (req: ProvisioningRequest, res: Response, next?: NextFunction) => {
                try {
                    await handler.call(this, req, res);
                } catch (ex) {
                    // Pass to error handler without the req
                    next?.(ex);
                }
            }
        }
        this.api.addRoute("get", "/v1/state", wrapHandler(this.getRoomState));
        this.api.addRoute("get", '/v1/config/sections', wrapHandler(this.getConfigSections));
        this.api.addRoute("get", '/v1/service/:service/config', wrapHandler(this.getServiceConfig));
        this.api.addRoute("get", '/v1/:roomId/connections', wrapHandler(this.getConnections));
        this.api.addRoute("get", '/v1/:roomId/connections/:service', wrapHandler(this.getConnectionsForService));
        this.api.addRoute("post", '/v1/:roomId/connections/:type', wrapHandler(this.createConnection));
        this.api.addRoute("put", '/v1/:roomId/connections/:connectionId', wrapHandler(this.updateConnection));
        this.api.addRoute("patch", '/v1/:roomId/connections/:connectionId', wrapHandler(this.updateConnection));
        this.api.addRoute("delete", '/v1/:roomId/connections/:connectionId', wrapHandler(this.deleteConnection));
        this.api.addRoute("get", '/v1/targets/:type', wrapHandler(this.getConnectionTargets));
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
            feeds: !!this.config.feeds?.enabled,
        });
    }

    private async getServiceConfig(req: ProvisioningRequest, res: Response<Record<string, unknown>>) {
        res.send(this.config.getPublicConfigForService(req.params.service));
    }

    private async getConnectionsForRequest(req: ProvisioningRequest) {
        if (!req.userId) {
            throw Error('Cannot get connections without a valid userId');
        }
        await assertUserPermissionsInRoom(req.userId, req.params.roomId as string, "read", this.intent);
        const allConnections = this.connMan.getAllConnectionsForRoom(req.params.roomId as string);
        const powerlevel = new PowerLevelsEvent({content: await this.intent.underlyingClient.getRoomStateEvent(req.params.roomId, "m.room.power_levels", "")});
        const serviceFilter = req.params.service;
        const connections = allConnections.map(c => c.getProvisionerDetails?.(true))
            .filter(c => !!c)
            // If we have a service filter.
            .filter(c => typeof serviceFilter !== "string" || c?.service === serviceFilter) as GetConnectionsResponseItem[];
        const userPl = powerlevel.content.users?.[req.userId] || powerlevel.defaultUserLevel;

        for (const c of connections) {
            const requiredPl = Math.max(powerlevel.content.events?.[c.type] || 0, powerlevel.defaultStateEventLevel);
            c.canEdit = userPl >= requiredPl;
            if (!c.canEdit) {
                delete c.secrets;
            }
        }

        return {
            connections,
            canEdit: userPl >= powerlevel.defaultUserLevel
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
        await assertUserPermissionsInRoom(req.userId, req.params.roomId as string, "write", this.intent);
        try {
            if (!req.body || typeof req.body !== "object") {
                throw new ApiError("A JSON body must be provided", ErrCode.BadValue);
            }
            const connection = await this.connMan.provisionConnection(req.params.roomId as string, req.userId, req.params.type as string, req.body as Record<string, unknown>);
            if (!connection.getProvisionerDetails) {
                throw new Error('Connection supported provisioning but not getProvisionerDetails');
            }
            res.send(connection.getProvisionerDetails(true));
        } catch (ex) {
            log.error(`Failed to create connection for ${req.params.roomId}`, ex);
            throw ex;
        }
    }

    private async updateConnection(req: ProvisioningRequest, res: Response<GetConnectionsResponseItem>) {
        if (!req.userId) {
            throw Error('Cannot get connections without a valid userId');
        }
        await assertUserPermissionsInRoom(req.userId, req.params.roomId as string, "write", this.intent);
        const connection = this.connMan.getConnectionById(req.params.roomId as string, req.params.connectionId as string);
        if (!connection) {
            throw new ApiError("Connection does not exist", ErrCode.NotFound);
        }
        if (!connection.provisionerUpdateConfig || !connection.getProvisionerDetails)  {
            throw new ApiError("Connection type does not support updates", ErrCode.UnsupportedOperation);
        }
        await connection.provisionerUpdateConfig(req.userId, req.body);
        res.send(connection.getProvisionerDetails(true));
    }

    private async deleteConnection(req: ProvisioningRequest, res: Response<{ok: true}>) {
        if (!req.userId) {
            throw Error('Cannot get connections without a valid userId');
        }
        const roomId = req.params.roomId as string;
        const connectionId = req.params.connectionId as string;
        await assertUserPermissionsInRoom(req.userId, roomId, "write", this.intent);
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
}
