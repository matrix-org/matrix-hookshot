import { BridgeConfigProvisioning } from "../Config/Config";
import { Application, default as express, NextFunction, Request, Response, Router } from "express";
import { ConnectionManager } from "../ConnectionManager";
import LogWrapper from "../LogWrapper";
import { Server } from "http";
import { ApiError, ErrCode, GetConnectionsResponseItem, GetConnectionTypeResponseItem } from "./api";
import { Intent, MembershipEventContent, PowerLevelsEventContent } from "matrix-bot-sdk";
import Metrics from "../Metrics";

const log = new LogWrapper("Provisioner");

// Simple validator
const ROOM_ID_VALIDATOR = /!.+:.+/;
const USER_ID_VALIDATOR = /@.+:.+/;


export class Provisioner {
    private expressApp: Application;
    private server?: Server;
    constructor(
        private readonly config: BridgeConfigProvisioning,
        private readonly connMan: ConnectionManager,
        private readonly intent: Intent,
        additionalRoutes: {route: string, router: Router}[]) {
        if (!this.config.secret) {
            throw Error('Missing secret in provisioning config');
        }
        if (!this.config.port) {
            throw Error('Missing port in provisioning config');
        }
        this.expressApp = express();
        this.expressApp.use((req, _res, next) => {
            Metrics.provisioningHttpRequest.inc({path: req.path, method: req.method});
            next();
        });
        this.expressApp.get("/v1/health", this.getHealth);
        this.expressApp.use(this.checkAuth.bind(this));
        this.expressApp.use(express.json());
        // Room Routes
        this.expressApp.get(
            "/v1/connectiontypes",
            this.getConnectionTypes.bind(this),
        );
        this.expressApp.use(this.checkUserId.bind(this));
        additionalRoutes.forEach(route => {
            this.expressApp.use(route.route, route.router);
        });
        this.expressApp.get<{roomId: string}, unknown, unknown, {userId: string}>(
            "/v1/:roomId/connections",
            this.checkRoomId.bind(this),
            (...args) => this.checkUserPermission("read", ...args),
            this.getConnections.bind(this),
        );
        this.expressApp.get<{roomId: string, connectionId: string}, unknown, unknown, {userId: string}>(
            "/v1/:roomId/connections/:connectionId",
            this.checkRoomId.bind(this),
            (...args) => this.checkUserPermission("read", ...args),
            this.getConnection.bind(this),
        );
        this.expressApp.put<{roomId: string, type: string}, unknown, Record<string, unknown>, {userId: string}>(
            "/v1/:roomId/connections/:type",
            this.checkRoomId.bind(this),
            (...args) => this.checkUserPermission("write", ...args),
            this.putConnection.bind(this),
        );
        this.expressApp.patch<{roomId: string, connectionId: string}, unknown, Record<string, unknown>, {userId: string}>(
            "/v1/:roomId/connections/:connectionId",
            this.checkRoomId.bind(this),
            (...args) => this.checkUserPermission("write", ...args),
            this.patchConnection.bind(this),
        );
        this.expressApp.delete<{roomId: string, connectionId: string}, unknown, unknown, {userId: string}>(
            "/v1/:roomId/connections/:connectionId",
            this.checkRoomId.bind(this),
            (...args) => this.checkUserPermission("write", ...args),
            this.deleteConnection.bind(this),
        );
        this.expressApp.use(this.onError);
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private onError(err: unknown, _req: Request, res: Response, _next: NextFunction) {
        if (!err) {
            return;
        }
        log.warn(err);
        if (res.headersSent) {
            return;
        }
        if (err instanceof ApiError) {
            err.apply(res);
        } else {
            new ApiError("An internal error occured").apply(res);
        }
    }

    private async checkUserPermission(requiredPermission: "read"|"write", req: Request<{roomId: string}, unknown, unknown, {userId: string}>, res: Response, next: NextFunction) {
        const userId = req.query.userId;
        const roomId = req.params.roomId;
        try {
            const membership = await this.intent.underlyingClient.getRoomStateEvent(roomId, "m.room.member", this.intent.userId) as MembershipEventContent;
            if (membership.membership === "invite") {
                await this.intent.underlyingClient.joinRoom(roomId);
            } else if (membership.membership !== "join") {
                return next(new ApiError("Bot is not joined to the room.", ErrCode.NotInRoom));
            }
        } catch (ex) {
            if (ex.body.errcode === "M_NOT_FOUND") {
                return next(new ApiError("User is not joined to the room.", ErrCode.NotInRoom));
            }
            log.warn(`Failed to find member event for ${req.query.userId} in room ${roomId}`, ex);
            return next(new ApiError(`Could not determine if the user is in the room.`, ErrCode.NotInRoom));
        }
        // If the user just wants to read, just ensure they are in the room.
        try {
            const membership = await this.intent.underlyingClient.getRoomStateEvent(roomId, "m.room.member", userId) as MembershipEventContent;
            if (membership.membership !== "join") {
                return next(new ApiError("User is not joined to the room.", ErrCode.NotInRoom));
            }
        } catch (ex) {
            if (ex.body.errcode === "M_NOT_FOUND") {
                return next(new ApiError("User is not joined to the room.", ErrCode.NotInRoom));
            }
            log.warn(`Failed to find member event for ${req.query.userId} in room ${roomId}`, ex);
            return next(new ApiError(`Could not determine if the user is in the room.`, ErrCode.NotInRoom));
        }
        if (requiredPermission === "read") {
            return next();
        }
        let pls: PowerLevelsEventContent;
        try {
            pls = await this.intent.underlyingClient.getRoomStateEvent(req.params.roomId, "m.room.power_levels", "") as PowerLevelsEventContent;
        } catch (ex) {
            log.warn(`Failed to find PL event for room ${req.params.roomId}`, ex);
            return next(new ApiError(`Could not get power levels for ${req.params.roomId}. Is the bot invited?`, ErrCode.NotInRoom));
        }

        // TODO: Decide what PL consider "write" permissions
        const botPl = pls.users?.[this.intent.userId] || pls.users_default || 0;
        const userPl = pls.users?.[userId] || pls.users_default || 0;
        const requiredPl = pls.state_default || 50;
        
        // Check the bot's permissions
        if (botPl < requiredPl) {
            return next(new ApiError(`Bot has a PL of ${botPl} but needs at least ${requiredPl}.`, ErrCode.ForbiddenBot));
        }

        // Now check the users
        if (userPl >= requiredPl) {
            next();
        } else {
            return next(new ApiError(`User has a PL of ${userPl} but needs at least ${requiredPl}.`, ErrCode.ForbiddenUser));
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
            throw new ApiError("Connection does not exist", ErrCode.NotFound);
        }
        if (!connection.getProvisionerDetails)  {
            throw new ApiError("Connection type does not support updates", ErrCode.UnsupportedOperation);
        }
        return res.send(connection.getProvisionerDetails());
    }

    private async putConnection(req: Request<{roomId: string, type: string}, unknown, Record<string, unknown>, {userId: string}>, res: Response, next: NextFunction) {
        // Need to figure out which connections are available
        try {
            if (!req.body || typeof req.body !== "object") {
                throw new ApiError("A JSON body must be provided", ErrCode.BadValue);
            }
            const connection = await this.connMan.provisionConnection(req.params.roomId, req.query.userId, req.params.type, req.body);
            if (!connection.getProvisionerDetails) {
                throw new Error('Connection supported provisioning but not getProvisionerDetails');
            }
            res.send(connection.getProvisionerDetails());
        } catch (ex) {
            log.warn(`Failed to create connection for ${req.params.roomId}`, ex);
            return next(ex);
        }
    }

    private async patchConnection(req: Request<{roomId: string, connectionId: string}, unknown, Record<string, unknown>, {userId: string}>, res: Response<GetConnectionsResponseItem>, next: NextFunction) {
        try {
            const connection = this.connMan.getConnectionById(req.params.roomId, req.params.connectionId);
            if (!connection) {
                return next(new ApiError("Connection does not exist", ErrCode.NotFound));
            }
            if (!connection.provisionerUpdateConfig || !connection.getProvisionerDetails)  {
                return next(new ApiError("Connection type does not support updates", ErrCode.UnsupportedOperation));
            }
            await connection.provisionerUpdateConfig(req.query.userId, req.body);
            res.send(connection.getProvisionerDetails());
        } catch (ex) {
            next(ex);
        }
    }

    private async deleteConnection(req: Request<{roomId: string, connectionId: string}>, res: Response<{ok: true}>, next: NextFunction) {
        try {
            const connection = this.connMan.getConnectionById(req.params.roomId, req.params.connectionId);
            if (!connection) {
                return next(new ApiError("Connection does not exist", ErrCode.NotFound));
            }
            if (!connection.onRemove) {
                return next(new ApiError("Connection does not support removal", ErrCode.UnsupportedOperation));
            }
            await this.connMan.removeConnection(req.params.roomId, req.params.connectionId);
            res.send({ok: true});
        } catch (ex) {
            return next(ex);
        }
    }

    public listen() {
        const bindAddr = this.config.bindAddress || "0.0.0.0";
        this.server = this.expressApp.listen(
            this.config.port,
            bindAddr,
        );
        log.info(`Listening on http://${bindAddr}:${this.config.port}`);
    }

    public stop() {
        if (this.server) {
            this.server.close();
        }
    }
}
