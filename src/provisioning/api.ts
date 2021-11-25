export interface GetConnectionsResponseItem {
    type: string;
    service: string;
    config: Record<string, unknown>;
}

export class ApiError extends Error {
    constructor(public readonly errorMessage: string, public readonly statusCode = 500) {
        super(`An API error occured: ${errorMessage}`);
    }
}