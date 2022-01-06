import express, { Router, Request, Response } from "express";
import cors from "cors";
import { AdminRoom } from "../AdminRoom";
import LogWrapper from "../LogWrapper";
import { Server } from "http";

const log = new LogWrapper("BridgeWidgetApi");

export class BridgeWidgetApi {
    public readonly expressRouter: Router;
    private server?: Server;
    constructor(private adminRooms: Map<string, AdminRoom>) {
        this.expressRouter = Router();
        this.expressRouter.use((req, _res, next) => {
            log.info(`${req.method} ${req.path} ${req.ip || ''} ${req.headers["user-agent"] || ''}`);
            next();
        });
        this.expressRouter.use('/', express.static('public'));
        this.expressRouter.use(cors());
        this.expressRouter.get('/widgetapi/:roomId/verify', this.getVerifyToken.bind(this));
        this.expressRouter.get('/widgetapi/:roomId', this.getRoomState.bind(this));
        this.expressRouter.get('/health', this.getHealth.bind(this));
    }

    private async getRoomFromRequest(req: Request): Promise<AdminRoom|{error: string, statusCode: number}> {
        const { roomId } = req.params;
        const token = req.headers.authorization?.substr('Bearer '.length);
        if (!token) {
            return {
                error: 'Access token not given',
                statusCode: 400,
            };
        }
        // Replace with actual auth
        const room = this.adminRooms.get(roomId);
        if (!room || !room.verifyWidgetAccessToken(token)) {
            return {error: 'Unauthorized access to room', statusCode: 401}
        }

        return room;
    }


    private async getVerifyToken(req: Request, res: Response) {
        const roomOrError = await this.getRoomFromRequest(req);
        if (roomOrError instanceof AdminRoom) {
            return res.sendStatus(204);
        }

        return res.status(roomOrError.statusCode).send({error: roomOrError.error});
    }

    private async getRoomState(req: Request, res: Response) {
        const roomOrError = await this.getRoomFromRequest(req);
        if (!(roomOrError instanceof AdminRoom)) {
            return res.status(roomOrError.statusCode).send({error: roomOrError.error});
        }
        try {
            return res.send(await roomOrError.getBridgeState());
        } catch (ex) {
            log.error(`Failed to get room state:`, ex);
            return res.status(500).send({error: "An error occured when getting room state"});
        }
    }

    private getHealth(req: Request, res: Response) {
        res.status(200).send({ok: true});
    }
}
