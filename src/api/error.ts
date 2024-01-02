import { ErrorObject } from "ajv";
import { NextFunction, Response, Request } from "express";
import { StatusCodes } from "http-status-codes";
import { IApiError } from "matrix-appservice-bridge";
import { Logger } from "matrix-appservice-bridge";

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

const ErrCodeToStatusCode: Record<ErrCode, StatusCodes> = {
    HS_UNKNOWN: StatusCodes.INTERNAL_SERVER_ERROR,
    HS_NOTFOUND: StatusCodes.NOT_FOUND,
    HS_UNSUPPORTED_OPERATION: StatusCodes.BAD_REQUEST,
    HS_FORBIDDEN_USER: StatusCodes.FORBIDDEN,
    HS_FORBIDDEN_BOT: StatusCodes.FORBIDDEN,
    HS_NOT_IN_ROOM: StatusCodes.FORBIDDEN,
    HS_BAD_VALUE: StatusCodes.BAD_REQUEST,
    HS_BAD_TOKEN: StatusCodes.UNAUTHORIZED,
    HS_DISABLED_FEATURE: StatusCodes.INTERNAL_SERVER_ERROR,
    HS_ADDITIONAL_ACTION_REQUIRED: StatusCodes.BAD_REQUEST,
    HS_CONFLICTING_CONNECTION: StatusCodes.CONFLICT,
    HS_METHOD_NOT_ALLOWED: StatusCodes.METHOD_NOT_ALLOWED,
}

export class ApiError extends Error implements IApiError {
    static readonly GenericFailure = new ApiError("An internal error occurred");

    constructor(
        public readonly error: string,
        public readonly errcode = ErrCode.Unknown,
        public readonly statusCode: number|StatusCodes = -1,
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

export class ValidatorApiError extends ApiError {
    constructor(errors?: ErrorObject[]|null) {
        if (!errors) {
            throw Error('ValidatorApiError thrown but no errors were found. This is possibly a bug.')
        }
        const errorStrings = errors.map(e => `${e.instancePath}: ${e.message}`).join(", ");
        super(`Failed to validate: ${errorStrings}`, ErrCode.BadValue, -1, {
            validationErrors: errors.map(e => ({message: e.message, path: e.instancePath}))
        });
    }
}


export function errorMiddleware(log: Logger) {
    return (err: unknown, req: Request, res: Response, next: NextFunction) => {
        if (!err) {
            next();
            return;
        }
        const apiError = err instanceof ApiError ? err : ApiError.GenericFailure;
        // Log a reduced error on info
        log.info(`${req.method} ${req.path} ${apiError.statusCode} - ${apiError.errcode} - ${apiError.error}`);
        // Only show full error on debug level.
        log.debug(err);
        if (res.headersSent) {
            return;
        }
        apiError.apply(res);
    }
}