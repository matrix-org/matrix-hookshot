import { BridgeConfigProvisioning } from "../Config/Config";
import e, { Application, default as express, NextFunction, Request, Response } from "express";
import { ConnectionManager } from "../ConnectionManager";
import LogWrapper from "../LogWrapper";
import { Server } from "http";
import { ApiError, GetConnectionsResponseItem } from "./api";
import { Intent, MembershipEventContent, PowerLevelsEventContent } from "matrix-bot-sdk";

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
        private readonly intent: Intent,) {
        if (!this.config.secret) {
            throw Error('Missing secret in provisioning config');
        }
        if (!this.config.port) {
            throw Error('Missing port in provisioning config');
        }
        this.expressApp = express();
        this.expressApp.get("/v1/health", this.getHealth);
        this.expressApp.use(this.checkAuth.bind(this));
        this.expressApp.use(this.checkUserId.bind(this));
        // Room Routes
        this.expressApp.get<{roomId: string}, unknown, unknown, {userId: string}>(
            "/v1/:roomId/connections",
            this.checkRoomId.bind(this),
            (...args) => this.checkUserPermission("read", ...args),
            this.getConnections.bind(this),
        );
        this.expressApp.use(this.onError);
    }

    private checkAuth(req: Request, res: Response, next: NextFunction) {
        if (req.headers.authorization === `Bearer ${this.config.secret}`) {
            return next();
        }
        throw new ApiError("Unauthorized", 401);
    }

    private checkRoomId(req: Request, _res: Response, next: NextFunction) {
        if (!req.params.roomId || !ROOM_ID_VALIDATOR.exec(req.params.roomId)) {
            throw new ApiError("Invalid roomId", 400);
        }
        next();
    }

    private checkUserId(req: Request, _res: Response, next: NextFunction) {
        if (typeof req.query.userId !== "string" || !USER_ID_VALIDATOR.exec(req.query.userId)) {
            throw new ApiError("Invalid userId", 400);
        }
        next();
    }

    private onError(err: unknown, _req: Request, res: Response, _next: NextFunction) {
        if (!err) {
            return;
        }
        log.warn(err);
        if (res.headersSent) {
            return;
        }
        if (err instanceof ApiError) {
            console.log("BIBBLE", err.statusCode, err.errorMessage);
            res.status(err.statusCode).send({error: err.errorMessage});
        } else {
            res.status(500).send({error: "An internal error occured."});
        }
    }

    private async checkUserPermission(requiredPermission: "read"|"write", req: Request<{roomId: string}, unknown, unknown, {userId: string}>, res: Response, next: NextFunction) {
        const userId = req.query.userId;
        const roomId = req.params.roomId;
        // If the user just wants to read, just ensure they are in the room.
        try {
            const membership = await this.intent.underlyingClient.getRoomStateEvent(roomId, "m.room.member", userId) as MembershipEventContent;
            if (membership.membership !== "join") {
                return next(new ApiError("User is not joined to the room.", 403));
            }
        } catch (ex) {
            if (ex.body.errcode === "M_NOT_FOUND") {
                return next(new ApiError("User is not joined to the room.", 403));
            }
            log.warn(`Failed to find member event for ${req.query.userId} in room ${roomId}`, ex);
            return next(new ApiError(`Could not determine if the user is in the room.`, 403));
        }
        if (requiredPermission === "read") {
            return next();
        }
        let pls: PowerLevelsEventContent;
        try {
            pls = await this.intent.underlyingClient.getRoomStateEvent(req.params.roomId, "m.room.power_levels", "") as PowerLevelsEventContent;
        } catch (ex) {
            log.warn(`Failed to find PL event for room ${req.params.roomId}`, ex);
            return next(new ApiError(`Could not get power levels for ${req.params.roomId}. Is the bot invited?`, 403));
        }

        // TODO: Decide what PL consider "write" permissions
        const botPl = pls.users?.[this.intent.userId] || pls.users_default || 0;
        const userPl = pls.users?.[userId] || pls.users_default || 0;
        const requiredPl = pls.state_default || 50;
        
        // Check the bot's permissions
        if (botPl < requiredPl) {
            return next(new ApiError(`Bot has a PL of ${botPl} but needs at least ${requiredPl}.`, 403));
        }

        // Now check the users
        if (userPl >= requiredPl) {
            next();
        } else {
            return next(new ApiError(`User has a PL of ${userPl} but needs at least ${requiredPl}.`, 403));
        }
    }

    private getHealth(_req: Request, res: Response) {
        return res.send({})
    }

    private async getConnections(req: Request<{roomId: string}>, res: Response<GetConnectionsResponseItem[]>, next: NextFunction) {
        try {
            const connections = await this.connMan.getAllConnectionsForRoom(req.params.roomId);
            const details = connections.map(c => c.getProvisionerDetails?.()).filter(c => !!c) as GetConnectionsResponseItem[];
            return res.send(details);
        } catch (ex) {
            log.warn(`Failed to fetch connections for ${req.params.roomId}`, ex);
            return next(new ApiError(`An internal issue occured while trying to fetch connections`));
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