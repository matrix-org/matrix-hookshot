import { BridgeConfigJiraOnPremOAuth } from "../../Config/Config";
import Axios, { Method } from "axios"
import { createPrivateKey, createSign, KeyObject } from "crypto";
import { Logger } from "matrix-appservice-bridge";
import { encodeJiraToken, JiraOAuth } from "../OAuth";
import { JiraOAuthResult } from "../Types";

const log = new Logger('JiraOnPremOAuth');

type OAuthBody = {
    oauth_token: string;
    oauth_token_secret: string;
};

export const assertOAuthRequestToken = (body: Record<string, string>): OAuthBody => {
    try {
        if (typeof body.oauth_token !== "string" || !body.oauth_token) {
            throw Error("Unexpected OAuth response from server: missing or invalid oauth_token");
        }
        if (typeof body.oauth_token_secret !== "string" || !body.oauth_token_secret) {
            throw Error("Unexpected OAuth response from server: missing or invalid oauth_token_secret");
        }
    } catch (error) {
        log.info(`Unexpected response from JIRA:`, JSON.stringify(body));
        throw error;
    }
    return {
        oauth_token: body.oauth_token,
        oauth_token_secret: body.oauth_token_secret,
    };
};

export const buildAuthorizationHeaders = (orderedParameters: [string, string][]) => {
    // Whilst the all the parameters should be included within the signature, only the oauth_ arguments
    // should appear within the authorization header.
    const authParams = orderedParameters.filter(([key]) => isParameterNameAnOAuthParameter(key));
    // Convert to strings: ["oauth_foo", "bar"] becomes oauth_foo="bar"
    const authStrings = authParams.map(([key, value]) => `${encodeData(key)}="${encodeData(value)}"`);
    return `OAuth ${authStrings.join(",")}`;
}

export const createSignatureBase = (method: string, url: string, parameters: string): string => {
    return `${method.toUpperCase()}&${encodeData(normalizeUrl(url))}&${encodeData(parameters)}`;
}

export const encodeData = (toEncode: string): string => {
    return encodeURIComponent(toEncode).replace(/!/g, "%21")
        .replace(/'/g, "%27")
        .replace(/\(/g, "%28")
        .replace(/\)/g, "%29")
        .replace(/\*/g, "%2A");
}

/**
 * Is the parameter considered an OAuth parameter?
 */
const isParameterNameAnOAuthParameter = (parameter: string): boolean => {
    return parameter.startsWith("oauth_");
}

export const makeArrayOfArgumentsHash = (argumentsHash: Map<string, string | string[]>): [string, string][] => {
    const argumentPairs: [string, string][] = [];
    for (const [key, value] of argumentsHash) {
        if (Array.isArray(value)) {
            for (const singleValue of value) {
                argumentPairs.push([key, singleValue]);
            }
        } else {
            argumentPairs.push([key, value]);
        }
    }
    return argumentPairs;
}

const NONCE_CHARS: string[] = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
export const nonce = (nonceSize = 32) => {
    return [...Array(nonceSize)].map(() => NONCE_CHARS[Math.floor(Math.random() * NONCE_CHARS.length)]).join('');
}

export const normalizeRequestParams = (args: Map<string, string>) => {
    let pairs = makeArrayOfArgumentsHash(args);
    // First encode them #3.4.1.3.2 .1
    for (const pair of pairs) {
        pair[0] = encodeData(pair[0]);
        pair[1] = encodeData(pair[1]);
    }

    // Then sort them #3.4.1.3.2 .2
    pairs = sortRequestParams(pairs);

    // Then concatenate together #3.4.1.3.2 .3 & .4
    return pairs.map(pair => pair.join("=")).join("&");
}

/**
 * 1. Removes unnecessary port declarations
 * 2. Normalizes an empty path to "/"
 * 3. Removes search queries
 */
export const normalizeUrl = (url: string | URL): string => {
    url = typeof url === "string" ? new URL(url) : url;
    const port = usesCustomPort(url) ? `:${url.port}` : "";
    return url.protocol + "//" + url.hostname + port + (url.pathname || "/");
}

/**
 * Sorts key value pairs by name, then value.
 */
export const sortRequestParams = function (pairs: [string, string][]): [string, string][] {
    // Sort by name, then value.
    return pairs.sort(function (a, b) {
        if (a[0] === b[0]) {
            return a[1] < b[1] ? -1 : 1;
        }
        return a[0] < b[0] ? -1 : 1;
    });
}

/**
 * Does the URL specify a port that isn't the protocol's default port?
 */
export const usesCustomPort = (url: URL): boolean => (
    !!url.port &&
    !(url.protocol === "http:" && url.port === "80") &&
    !(url.protocol === "https:" && url.port === "443")
);

export class JiraOnPremOAuth implements JiraOAuth {
    public readonly privateKey: KeyObject;
    private stateToTokenSecret = new Map<string, string>();

    constructor(
        private readonly config: BridgeConfigJiraOnPremOAuth,
        private readonly instanceUrl: string,
        privateKey: Buffer,
    ) {
        this.privateKey = createPrivateKey(privateKey);
    }

    public async exchangeRequestForToken(codeOrToken: string, verifier: string): Promise<JiraOAuthResult> {
        if (!verifier) {
            throw Error('Missing verifier');
        }

        const response = await this.secureRequest(
            codeOrToken,
            "POST",
            `${this.instanceUrl}/plugins/servlet/oauth/access-token`,
            { oauth_verifier: verifier },
        );
        const result = assertOAuthRequestToken(response);
        return {
            access_token: encodeJiraToken(result.oauth_token, result.oauth_token_secret),
            scope: "",
        }
    }

    public async getAuthUrl(state: string): Promise<string> {
        // Need to fetch a token first.
        const details = await this.getOAuthRequestToken(state);
        this.stateToTokenSecret.set(state, details.oauth_token_secret);
        return `${this.instanceUrl}/plugins/servlet/oauth/authorize?oauth_token=${details.oauth_token}`;
    }

    private async getOAuthRequestToken(
        state: string
    ): Promise<OAuthBody> {
        const callbackUrl = new URL(this.config.redirect_uri);
        callbackUrl.searchParams.set('state', state);
        const response = await this.secureRequest(
            null,
            "POST",
            `${this.instanceUrl}/plugins/servlet/oauth/request-token`,
            { oauth_callback: callbackUrl.toString() },
        );
        return assertOAuthRequestToken(response);
    }

    private async secureRequest(
        oauthToken: string|null,
        method: Method,
        urlStr: string,
        extraParams: Record<string, string> = {},
        body: unknown = null,
        contentType = "application/x-www-form-urlencoded"
    ): Promise<Record<string, string>> {
        const orderedParameters = this.prepareParameters(oauthToken, method, urlStr, extraParams);
        const url = new URL(urlStr); 

        // Filter out any passed extra_params that are really to do with OAuth
        for (const key in extraParams) {
            if (isParameterNameAnOAuthParameter(key) ) {
                delete extraParams[key];
            }
        }
        log.info(`Requesting ${url}`, orderedParameters);
        const req = await Axios.request({
            method,
            headers: {
                Authorization: buildAuthorizationHeaders(orderedParameters),
                Host: url.host,
                'Content-Type': contentType,
            },
            data: body ?? `${new URLSearchParams(extraParams)}`,
            url: url.toString(),
        });
        // Convert x-www-form-urlencoded string to a Record<string, string>
        return Object.fromEntries(new URLSearchParams(req.data));
    }

    private prepareParameters(
        oauthToken: string | null,
        method: Method,
        urlStr: string,
        extraParams: Record<string, string> = {}
    ): [string, string][] {
        const oauthParameters = new Map<string, string>(Object.entries({
            oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
            oauth_nonce: nonce(),
            oauth_version: "1.0",
            oauth_signature_method: "RSA-SHA1",
            oauth_consumer_key: this.config.consumerKey,
            ...(oauthToken && { oauth_token: oauthToken }),
            ...extraParams,
        }));

        const url = new URL(urlStr);

        for (const [key, value] of url.searchParams.entries()) {
            oauthParameters.set(key, value);
        }
      
        const sig = this.getSignatue(method, urlStr, normalizeRequestParams(oauthParameters));
        const orderedParameters = sortRequestParams(makeArrayOfArgumentsHash(oauthParameters));
        orderedParameters.push(["oauth_signature", sig]);
        return orderedParameters;
    }

    private getSignatue(method: Method, url: string, parameters: string): string {
        const signatureBase = createSignatureBase(method, url, parameters);
        return createSign("RSA-SHA1").update(signatureBase).sign(this.privateKey, 'base64');  
    }
}
