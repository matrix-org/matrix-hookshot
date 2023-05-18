import { JiraOAuthResult } from "./Types";

export interface JiraOAuth {
    getAuthUrl(state: string): Promise<string>;
    exchangeRequestForToken(codeOrToken: string,verifier?: string): Promise<JiraOAuthResult>;
}

export interface JiraOAuthRequestCloud {
    state: string;
    code: string;
}

export interface JiraOAuthRequestOnPrem {
    state: string;
    oauthToken: string;
    oauthVerifier: string;
}

export enum JiraOAuthRequestResult {
    UnknownFailure,
    Success,
    UserNotFound,
}

export function encodeJiraToken(oauthToken: string, oauthTokenSecret: string): string {
    return `jira-oauth1.0:${oauthToken}/${oauthTokenSecret}`;
}

export function decodeJiraToken(token: string): {oauthToken: string, oauthTokenSecret: string} {
    const [ oauthToken, oauthTokenSecret] = token.substring("jira-oauth1.0:".length).split('/');
    return { oauthToken, oauthTokenSecret };
}