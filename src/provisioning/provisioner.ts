import { BridgeConfigProvisioning } from "../config/Config";
import { Router, default as express, NextFunction, Request, Response } from "express";
import { ConnectionManager } from "../ConnectionManager";
import { Logger } from "matrix-appservice-bridge";
import { assertUserPermissionsInRoom, GetConnectionsResponseItem, GetConnectionTypeResponseItem } from "./api";
import { ApiError, ErrCode } from "../api";
import { Appservice } from "matrix-bot-sdk";
import Metrics from "../Metrics";
import BotUsersManager from "../Managers/BotUsersManager";

const log = new Logger("Provisioner");

// Simple validator
const ROOM_ID_VALIDATOR = /!.+:.+/;
const USER_ID_VALIDATOR = /@.+:.+/;


export class Provisioner {
    public readonly expressRouter: Router = Router();
    constructor(
        private readonly config: BridgeConfigProvisioning,
        private readonly connMan: ConnectionManager,
        private readonly botUsersManager: BotUsersManager,
        private readonly as: Appservice,
        additionalRoutes: {route: string, router: Router}[]) {
        if (!this.config.secret) {
            throw Error('Missing secret in provisioning config');
        }
        this.expressRouter.use("/v1", (req, _res, next) => {
            Metrics.provisioningHttpRequest.inc({path: req.path, method: req.method});
            next();
        });
        this.expressRouter.get("/v1/health", this.getHealth);
        this.expressRouter.use("/v1", this.checkAuth.bind(this));
        this.expressRouter.use(express.json());
        // Room Routes
        this.expressRouter.get(
            "/v1/connectiontypes",
            this.getConnectionTypes.bind(this),
        );
        this.expressRouter.use("/v1", this.checkUserId.bind(this));
        additionalRoutes.forEach(route => {
            this.expressRouter.use(route.route, route.router);
        });
        this.expressRouter.get<{roomId: string}, unknown, unknown, {userId: string}>(
            "/v1/:roomId/connections",
            this.checkRoomId.bind(this),
            (...args) => this.checkUserPermission("read", ...args),
            this.getConnections.bind(this),
        );
        this.expressRouter.get<{roomId: string, connectionId: string}, unknown, unknown, {userId: string}>(
            "/v1/:roomId/connections/:connectionId",
            this.checkRoomId.bind(this),
            (...args) => this.checkUserPermission("read", ...args),
            this.getConnection.bind(this),
        );
        this.expressRouter.put<{roomId: string, type: string}, unknown, Record<string, unknown>, {userId: string}>(
            "/v1/:roomId/connections/:type",
            this.checkRoomId.bind(this),
            (...args) => this.checkUserPermission("write", ...args),
            this.putConnection.bind(this),
        );
        this.expressRouter.patch<{roomId: string, connectionId: string}, unknown, Record<string, unknown>, {userId: string}>(
            "/v1/:roomId/connections/:connectionId",
            this.checkRoomId.bind(this),
            (...args) => this.checkUserPermission("write", ...args),
            this.patchConnection.bind(this),
        );
        this.expressRouter.delete<{roomId: string, connectionId: string}, unknown, unknown, {userId: string}>(
            "/v1/:roomId/connections/:connectionId",
            this.checkRoomId.bind(this),
            (...args) => this.checkUserPermission("write", ...args),
            this.deleteConnection.bind(this),
        );
    }

    private checkAuth(req: Request, _res: Response, next: NextFunction) {
        if (req.headers.authorization === `Bearer ${this.config.secret}`) {
            return next();
        }
        throw new ApiError("Unauthorized", ErrCode.BadToken);
    }

    private checkRoomId(req: Request<{roomId: string}>, _res: Response, next: NextFunction) {
        if (!req.params.roomId || !ROOM_ID_VALIDATOR.exec(req.params.roomId)) {
            throw new ApiError("Invalid roomId", ErrCode.BadValue);
        }
        next();
    }

    private checkUserId(req: Request, _res: Response, next: NextFunction) {
        if (typeof req.query.userId !== "string" || !USER_ID_VALIDATOR.exec(req.query.userId)) {
            throw new ApiError("Invalid userId", ErrCode.BadValue);
        }
        next();
    }

    private async checkUserPermission(requiredPermission: "read"|"write", req: Request<{roomId: string}, unknown, unknown, {userId: string}>, res: Response, next: NextFunction) {
        const userId = req.query.userId;
        const roomId = req.params.roomId;

        const botUser = this.botUsersManager.getBotUserInRoom(roomId);
        if (!botUser) {
            throw new ApiError("Bot is not joined to the room.", ErrCode.NotInRoom);
        }

        try {
            await assertUserPermissionsInRoom(userId, roomId, requiredPermission, botUser.intent);
            next();
        } catch (ex) {
            next(ex);
        }
    }

    private getHealth(_req: Request, res: Response) {
        return res.send({})
    }

    private getConnectionTypes(_req: Request, res: Response<Record<string, GetConnectionTypeResponseItem>>) {
        return res.send(this.connMan.enabledForProvisioning);
    }

    private getConnections(req: Request<{roomId: string}>, res: Response<GetConnectionsResponseItem[]>) {
        const connections = this.connMan.getAllConnectionsForRoom(req.params.roomId);
        const details = connections.map(c => c.getProvisionerDetails?.()).filter(c => !!c) as GetConnectionsResponseItem[];
        return res.send(details);
    }

    private getConnection(req: Request<{roomId: string, connectionId: string}>, res: Response<GetConnectionsResponseItem>) {
        const connection = this.connMan.getConnectionById(req.params.roomId, req.params.connectionId);
        if (!connection) {
            throw new ApiError("Connection does not exist.", ErrCode.NotFound);
        }
        if (!connection.getProvisionerDetails)  {
            throw new ApiError("Connection type does not support updates.", ErrCode.UnsupportedOperation);
        }
        return res.send(connection.getProvisionerDetails());
    }

    private async putConnection(req: Request<{roomId: string, type: string}, unknown, Record<string, unknown>, {userId: string}>, res: Response<GetConnectionsResponseItem>, next: NextFunction) {
        const roomId = req.params.roomId;
        const userId = req.query.userId;
        const eventType = req.params.type;
        const connectionType = this.connMan.getConnectionTypeForEventType(eventType);
        if (!connectionType) {
            throw new ApiError("Unknown event type", ErrCode.NotFound);
        }
        const serviceType = connectionType.ServiceCategory;

        // Need to figure out which connections are available
        try {
            if (!req.body || typeof req.body !== "object") {
                throw new ApiError("A JSON body must be provided", ErrCode.BadValue);
            }
            this.connMan.validateCommandPrefix(roomId, req.body);

            const botUser = this.botUsersManager.getBotUserInRoom(roomId, serviceType);
            if (!botUser) {
                throw new ApiError("Bot is not joined to the room.", ErrCode.NotInRoom);
            }

            const result = await this.connMan.provisionConnection(roomId, botUser.intent, userId, connectionType, req.body);
            if (!result.connection.getProvisionerDetails) {
                throw new Error('Connection supported provisioning but not getProvisionerDetails');
            }

            res.send({
                ...result.connection.getProvisionerDetails(true),
                warning: result.warning,
            });
        } catch (ex) {
            log.error(`Failed to create connection for ${roomId}`, ex);
            return next(ex);
        }
    }

    private async patchConnection(req: Request<{roomId: string, connectionId: string}, unknown, Record<string, unknown>, {userId: string}>, res: Response<GetConnectionsResponseItem>, next: NextFunction) {
        try {
            const connection = this.connMan.getConnectionById(req.params.roomId, req.params.connectionId);
            if (!connection) {
                return next(new ApiError("Connection does not exist.", ErrCode.NotFound));
            }
            if (!connection.provisionerUpdateConfig || !connection.getProvisionerDetails)  {
                return next(new ApiError("Connection type does not support updates.", ErrCode.UnsupportedOperation));
            }
            this.connMan.validateCommandPrefix(req.params.roomId, req.body, connection);
            await connection.provisionerUpdateConfig(req.query.userId, req.body);
            res.send(connection.getProvisionerDetails(true));
        } catch (ex) {
            next(ex);
        }
    }

    private async deleteConnection(req: Request<{roomId: string, connectionId: string}>, res: Response<{ok: true}>, next: NextFunction) {
        try {
            const connection = this.connMan.getConnectionById(req.params.roomId, req.params.connectionId);
            if (!connection) {
                return next(new ApiError("Connection does not exist.", ErrCode.NotFound));
            }
            if (!connection.onRemove) {
                return next(new ApiError("Connection does not support removal.", ErrCode.UnsupportedOperation));
            }
            await this.connMan.purgeConnection(req.params.roomId, req.params.connectionId);
            res.send({ok: true});
        } catch (ex) {
            return next(ex);
        }
    }
}
