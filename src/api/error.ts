import { NextFunction, Response, Request } from "express";
import { IApiError } from "matrix-appservice-bridge";
import LogWrapper from "../LogWrapper";

export enum ErrCode {
    // Errors are prefixed with HS_
    /**
     * Generic failure, unknown reason
     */
    Unknown = "HS_UNKNOWN",
    /**
     * The resource was not found
     */
    NotFound = "HS_NOTFOUND",
    /**
     * The operation was not supported by this connection
     */
    UnsupportedOperation = "HS_UNSUPPORTED_OPERATION",
    /**
     * The target user does not have permissions to perform this action in the room.
     */
    ForbiddenUser = "HS_FORBIDDEN_USER",
    /**
     * The bot does not have permissions to perform this action in the room.
     */
    ForbiddenBot = "HS_FORBIDDEN_BOT",
    /**
     * The bot or user could not be confirmed to be in the room.
     */
    NotInRoom = "HS_NOT_IN_ROOM",
    /**
     * A bad value was given to the API.
     */
    BadValue = "HS_BAD_VALUE",
    /**
     * The secret token provided to the API was invalid or not given.
     */
    BadToken = "HS_BAD_TOKEN",
    /**
     * The requested feature is not enabled in the bridge.
     */
    DisabledFeature = "HS_DISABLED_FEATURE",
    /**
     * The operation action requires an additional action from the requestor.
     */
    AdditionalActionRequired = "HS_ADDITIONAL_ACTION_REQUIRED",
    /**
     * A connection with similar configuration exists
     */
    ConflictingConnection =  "HS_CONFLICTING_CONNECTION",

    MethodNotAllowed = "HS_METHOD_NOT_ALLOWED"
}

const ErrCodeToStatusCode: Record<ErrCode, number> = {
    HS_UNKNOWN: 500,
    HS_NOTFOUND: 404,
    HS_UNSUPPORTED_OPERATION: 400,
    HS_FORBIDDEN_USER: 403,
    HS_FORBIDDEN_BOT: 403,
    HS_NOT_IN_ROOM: 403,
    HS_BAD_VALUE: 400,
    HS_BAD_TOKEN: 401,
    HS_DISABLED_FEATURE: 500,
    HS_ADDITIONAL_ACTION_REQUIRED: 400,
    HS_CONFLICTING_CONNECTION: 409,
    HS_METHOD_NOT_ALLOWED: 405,
}

export class ApiError extends Error implements IApiError {
    constructor(
        public readonly error: string,
        public readonly errcode = ErrCode.Unknown,
        public readonly statusCode = -1,
        public readonly additionalContent: Record<string, unknown> = {},
    ) {
        super(`API error ${errcode}: ${error}`);
        if (statusCode === -1) {
            this.statusCode = ErrCodeToStatusCode[errcode];
        }
    }

    get jsonBody() {
        return {
            errcode: this.errcode,
            error: this.error,
            ...this.additionalContent,
        }
    }

    public apply(response: Response) {
        return response.status(this.statusCode).send(this.jsonBody);
    }
}

export function errorMiddleware(log: LogWrapper) {
    return (err: unknown, _req: Request, res: Response, next: NextFunction) => {
        if (!err) {
            next();
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
}