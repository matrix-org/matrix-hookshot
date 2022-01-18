import express, { Router, Request, Response, NextFunction } from "express";
import cors from "cors";
import { AdminRoom } from "../AdminRoom";
import LogWrapper from "../LogWrapper";
import { ApiError, ErrCode, errorMiddleware } from "../api";
import { BridgeConfig } from "../Config/Config";
import { UserSearchResults, WidgetConfigurationSection, WidgetConfigurationType } from "./BridgeWidgetInterface";
import { UserTokenStore } from "../UserTokenStore";

const log = new LogWrapper("BridgeWidgetApi");

export class BridgeWidgetApi {
    public readonly expressRouter: Router;
    constructor(private adminRooms: Map<string, AdminRoom>, private readonly config: BridgeConfig, private readonly tokenStore: UserTokenStore) {
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

        this.expressRouter.post('/widgetapi/v1/search/users', this.postSearchUsers.bind(this));

        this.expressRouter.use('/widgetapi', (_, res) => res.redirect('/widgetapi/static'));
        this.expressRouter.use((err: unknown, req: Request, res: Response, next: NextFunction) => errorMiddleware(log)(err, req, res, next));
    }

    private async getRoomFromRequest(req: Request<unknown, unknown, unknown, unknown>): Promise<AdminRoom> {
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


    private async getVerifyToken(req: Request, res: Response, next: NextFunction) {
        try {
            await this.getRoomFromRequest(req);
            return res.sendStatus(204);
        } catch (ex) {
            next(ex);
            return;
        }
    }

    private async getRoomState(req: Request, res: Response, next: NextFunction) {
        try {
            const room = await this.getRoomFromRequest(req);
            return res.send(await room.getBridgeState());
        } catch (ex) {
            log.error(`Failed to get room state:`, ex);
            next(new ApiError("An error occured when getting room state", ErrCode.Unknown));
            return;
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

    private async getConfigSection(req: Request<{section: string}>, res: Response<WidgetConfigurationSection[]>, next: NextFunction) {
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
            next(new ApiError("Not a known config section", ErrCode.NotFound));
        }
    }

    private async postSearchUsers(req: Request<unknown, unknown, unknown, {query: string}>, res: Response<UserSearchResults>, next: NextFunction) {
        const room = await this.getRoomFromRequest(req);
        const octokit = await this.tokenStore.getOctokitForUser(room.userId);
        if (!octokit) {
            next(new ApiError('You must be logged in to search GitHub', ErrCode.ForbiddenUser));
            return;
        }
        if (!req.query.query || typeof req.query.query !== "string" || req.query.query.length < 3) {
            next(new ApiError('Query was not a string of at least 3 characters', ErrCode.BadValue));
            return;
        }
        const searchResults = await octokit.search.users({q: req.query.query, per_page: 10});
        // Handle lots of results
        res.send({
            data: searchResults.data.items.map((u) => ({
                userId: `@_github_${u.login}:beefy`,
                service: 'github',
                displayName: u.name || u.login || undefined,
                rawAvatarUrl: u.avatar_url,
            }))
        });
    }

    private getHealth(req: Request, res: Response) {
        res.status(200).send({ok: true});
    }
}
