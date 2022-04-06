import { Application, Response } from "express";
import { AdminRoom } from "../AdminRoom";
import LogWrapper from "../LogWrapper";
import { ApiError, ErrCode } from "../api";
import { BridgeConfig } from "../Config/Config";
import { GetConnectionsForServiceResponse, WidgetConfigurationSection, WidgetConfigurationType } from "./BridgeWidgetInterface";
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
        });
        this.api.addRoute("get", "/v1/state", this.getRoomState.bind(this));
        this.api.addRoute("get", '/v1/config/sections', this.getConfigSections.bind(this));
        this.api.addRoute("get", '/v1/config/:section', this.getConfigSection.bind(this));
        this.api.addRoute("get", '/v1/service/:service/config', this.getServiceConfig.bind(this));
        this.api.addRoute("get", '/v1/:roomId/connections', this.getConnections.bind(this));
        this.api.addRoute("get", '/v1/:roomId/connections/:service', this.getConnectionsForService.bind(this));
        this.api.addRoute("post", '/v1/:roomId/connections/:type', this.createConnection.bind(this));
        // TODO: Ideally this would be a PATCH, but needs https://github.com/matrix-org/matrix-appservice-bridge/pull/397 to land to support PATCH.
        this.api.addRoute("put", '/v1/:roomId/connections/:connectionId', this.updateConnection.bind(this));
        this.api.addRoute("delete", '/v1/:roomId/connections/:connectionId', this.deleteConnection.bind(this));
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
        });
    }

    private async getServiceConfig(req: ProvisioningRequest, res: Response<Record<string, unknown>>) {
        let config: undefined|Record<string, unknown>;
        switch (req.params.service) {
            case "generic":
                config = this.config.generic?.publicConfig;
                break;
            default:
                throw new ApiError("Not a known service, or service doesn't expose a config", ErrCode.NotFound);
        }

        if (!config) {
            throw new ApiError("Service is not enabled", ErrCode.DisabledFeature);
        }

        res.send(
            config
        );
    }

    private async getConfigSection(req: ProvisioningRequest, res: Response<WidgetConfigurationSection[]>) {
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
            log.warn(`Failed to create connection for ${req.params.roomId}`, ex);
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
}
