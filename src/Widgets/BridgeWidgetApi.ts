import express, { Router, Request, Response, NextFunction } from "express";
import cors from "cors";
import { AdminRoom } from "../AdminRoom";
import LogWrapper from "../LogWrapper";
import { ApiError, ErrCode, errorMiddleware } from "../api";
import { BridgeConfig } from "../Config/Config";
import { WidgetConfigurationSection, WidgetConfigurationType } from "./BridgeWidgetInterface";

const log = new LogWrapper("BridgeWidgetApi");

export class BridgeWidgetApi {
    public readonly expressRouter: Router;
    constructor(private adminRooms: Map<string, AdminRoom>, private readonly config: BridgeConfig) {
        this.expressRouter = Router();
        this.expressRouter.use((req, _res, next) => {
            log.info(`${req.method} ${req.path} ${req.ip || ''} ${req.headers["user-agent"] || ''}`);
            next();
        });
        this.expressRouter.use('/widgetapi/static', express.static('public'));
        this.expressRouter.use(cors());
        this.expressRouter.get('/widgetapi/v1/health', this.getHealth.bind(this));
        this.expressRouter.get('/widgetapi/v1/verify', this.getVerifyToken.bind(this));
        this.expressRouter.get('/widgetapi/v1/state', this.getRoomState.bind(this));
        this.expressRouter.get('/widgetapi/v1/config/sections', this.getConfigSections.bind(this));
        this.expressRouter.get('/widgetapi/v1/config/:section', this.getConfigSection.bind(this));
        this.expressRouter.use('/widgetapi', (_, res) => res.redirect('/widgetapi/static'));
        this.expressRouter.use((err: unknown, req: Request, res: Response, next: NextFunction) => errorMiddleware(log)(err, req, res, next));
    }

    private async getRoomFromRequest(req: Request): Promise<AdminRoom> {
        const token = req.headers.authorization?.substr('Bearer '.length);
        if (!token) {
            throw new ApiError("Access token not given", ErrCode.BadToken);
        }
        // Replace with actual auth
        const room = [...this.adminRooms.values()].find(r => r.verifyWidgetAccessToken(token));
        if (!room) {
            throw new ApiError("Access token not known", ErrCode.BadToken);
        }

        return room;
    }


    private async getVerifyToken(req: Request, res: Response) {
        await this.getRoomFromRequest(req);
        return res.sendStatus(204);
    }

    private async getRoomState(req: Request, res: Response) {
        const room = await this.getRoomFromRequest(req);
        try {
            return res.send(await room.getBridgeState());
        } catch (ex) {
            log.error(`Failed to get room state:`, ex);
            throw new ApiError("An error occured when getting room state", ErrCode.Unknown);
        }
    }

    private async getConfigSections(req: Request, res: Response<{[section: string]: boolean}>) {
        await this.getRoomFromRequest(req);
        res.send({
            general: true,
            github: !!this.config.github,
            gitlab: !!this.config.gitlab,
            jira: !!this.config.jira,
            figma: !!this.config.figma,
        });
    }

    private async getConfigSection(req: Request<{section: string}>, res: Response<WidgetConfigurationSection[]>) {
        await this.getRoomFromRequest(req);
        if (req.params.section === "general") {
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
        } else {
            throw new ApiError("Not a known config section", ErrCode.NotFound);
        }
    }

    private getHealth(req: Request, res: Response) {
        res.status(200).send({ok: true});
    }
}
