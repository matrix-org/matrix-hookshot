import { BridgeConfigJiraOnPremOAuth } from "../../config/Config";
import Axios, { Method } from "axios"
import qs from "querystring";
import { createPrivateKey, createSign, KeyObject } from "crypto";
import fs from "fs";
import { Logger } from "matrix-appservice-bridge";
import { encodeJiraToken, JiraOAuth } from "../OAuth";
import { JiraOAuthResult } from "../Types";

const log = new Logger('JiraOnPremOAuth');

const NONCE_CHARS = [
    'a','b','c','d','e','f','g','h','i','j','k','l','m','n',
    'o','p','q','r','s','t','u','v','w','x','y','z','A','B',
    'C','D','E','F','G','H','I','J','K','L','M','N','O','P',
    'Q','R','S','T','U','V','W','X','Y','Z','0','1','2','3',
    '4','5','6','7','8','9'
];

export class JiraOnPremOAuth implements JiraOAuth {

    private static nonce(nonceSize = 32) {
        return [...Array(nonceSize)].map(() => NONCE_CHARS[Math.floor(Math.random() * NONCE_CHARS.length)]).join('');
    }

    private static encodeData(toEncode: string): string {
        return encodeURIComponent(toEncode).replace(/!/g, "%21")
                        .replace(/'/g, "%27")
                        .replace(/\(/g, "%28")
                        .replace(/\)/g, "%29")
                        .replace(/\*/g, "%2A");
    }

    private static normalizeUrl(url: string|URL): string {
        url = typeof url === "string" ? new URL(url) : url;
        let port = "";
        if (url.port) { 
            if ((url.protocol == "http:" && url.port != "80" ) ||
                (url.protocol == "https:" && url.port != "443") ) {
                    port = ":" + url.port;
                }
        }
        if (!url.pathname || url.pathname == "") {
            url.pathname = "/";
        }
        
        return url.protocol + "//" + url.hostname + port + url.pathname;
    }
    
    private static createSignatureBase (method: string, url: string, parameters: string): string {
        return `${method.toUpperCase()}&${JiraOnPremOAuth.encodeData(JiraOnPremOAuth.normalizeUrl(url))}&${JiraOnPremOAuth.encodeData(parameters)}`;
    }

    public readonly privateKey: KeyObject;
    private stateToTokenSecret = new Map<string, string>();

    constructor(private readonly config: BridgeConfigJiraOnPremOAuth, private readonly instanceUrl: string) {
        // TODO: Make this async.
        this.privateKey = createPrivateKey(fs.readFileSync(config.privateKey));
    }


    public async exchangeRequestForToken(codeOrToken: string, verifier: string): Promise<JiraOAuthResult> {
        if (!verifier) {
            throw Error('Missing verifier');
        }

        const result = await this.secureRequest<{oauth_token: string, oauth_token_secret: string}>(codeOrToken, "POST", `${this.instanceUrl}/plugins/servlet/oauth/access-token`, {
            oauth_verifier: verifier
        });
        return {
            access_token: encodeJiraToken(result.oauth_token, result.oauth_token_secret),
            scope: ""
        }
    }

    public async getAuthUrl(state: string) {
        // Need to fetch a token first.
        const details = await this.getOAuthRequestToken(state);

        if (!details.oauth_token || !details.oauth_token_secret) {
            log.info(`Unexpected response from JIRA:`, JSON.stringify(details));
            throw Error('Unexpected OAuth response from server');
        }
        this.stateToTokenSecret.set(state, details.oauth_token_secret);
        return `${this.instanceUrl}/plugins/servlet/oauth/authorize?oauth_token=${details.oauth_token}`;
    }

    private async getOAuthRequestToken(state: string) {
        const callbackUrl = new URL(this.config.redirect_uri);
        callbackUrl.searchParams.set('state', state);
        const results = this.secureRequest<{oauth_token: string, oauth_token_secret: string}>(null, "POST", `${this.instanceUrl}/plugins/servlet/oauth/request-token`, {
            oauth_callback: callbackUrl.toString(),
        });
        return results;
    }

    private async secureRequest<T>(
        oauthToken: string|null,
        method: Method,
        urlStr: string,
        extraParams: Record<string, string> = {},
        body: unknown = null,
        contentType = "application/x-www-form-urlencoded"
    ): Promise<T> {
        const orderedParameters = this.prepareParameters(oauthToken, method, urlStr, extraParams);
        const url = new URL(urlStr); 

        const headers: Record<string,string> = {};
        headers["Authorization"]= JiraOnPremOAuth.buildAuthorizationHeaders(orderedParameters);
        headers["Host"] = url.host;

        // Filter out any passed extra_params that are really to do with OAuth
        for(const key in extraParams) {
            if( JiraOnPremOAuth.isParameterNameAnOAuthParameter( key ) ) {
                delete extraParams[key];
            }
        }
        log.info(`Requesting ${url}`, orderedParameters);
        const req = await Axios.request({
            method,
            headers: {
                Authorization: JiraOnPremOAuth.buildAuthorizationHeaders(orderedParameters),
                Host: url.host,
                'Content-Type': contentType,
            },
            data: body || qs.stringify(extraParams),
            url: url.toString(),
        });
        return qs.parse(req.data) as unknown as T;
    }

    private prepareParameters(oauthToken: string|null, method: Method, urlStr: string, extraParams: Record<string, string> = {}) {
        const oauthParameters: Record<string, string> = {
            oauth_timestamp: Math.floor( Date.now() / 1000 ).toString(),
            oauth_nonce: JiraOnPremOAuth.nonce(),
            oauth_version: "1.0",
            oauth_signature_method: "RSA-SHA1",
            oauth_consumer_key: this.config.consumerKey,
            ...(oauthToken && {oauth_token: oauthToken}),
            ...extraParams,
        };

        const url = new URL(urlStr);
      
        for (const [key, value] of url.searchParams.entries() ) {
            oauthParameters[key]= value;
        }
      
        const sig = this.getSignatue(method, urlStr, JiraOnPremOAuth.normaliseRequestParams(oauthParameters));
        const orderedParameters = JiraOnPremOAuth.sortRequestParams( JiraOnPremOAuth.makeArrayOfArgumentsHash(oauthParameters) );
        orderedParameters[orderedParameters.length] = ["oauth_signature", sig];
        return orderedParameters;
    }


    private createSignature (signatureBase: string) {
        if (!this.privateKey) {
            throw Error('Cannot sign request, privateKey not ready');
        }
        return createSign("RSA-SHA1").update(signatureBase).sign(this.privateKey, 'base64');  
    }


    private getSignatue(method: Method, url: string, parameters: string) {
        return this.createSignature(JiraOnPremOAuth.createSignatureBase(method, url, parameters));
    }


    private static makeArrayOfArgumentsHash (argumentsHash: Record<string, string|string[]>): [string, string][] {
        const argumentPairs: [string, string][] = [];
        for(const key in argumentsHash ) {
            const value = argumentsHash[key];
            if (Array.isArray(value) ) {
                for (let i = 0; i < value.length; i++) {
                    argumentPairs[argumentPairs.length] = [key, value[i]];
                }
            }
            else {
                argumentPairs[argumentPairs.length] = [key, value];
            }
        }
        return argumentPairs;  
    }



    // Sorts the encoded key value pairs by encoded name, then encoded value
    private static sortRequestParams= function(pairs: [string, string][]): [string, string][] {
        // Sort by name, then value.
        return pairs.sort(function(a,b) {
            if ( a[0]== b[0] )  {
            return a[1] < b[1] ? -1 : 1; 
            }
            else return a[0] < b[0] ? -1 : 1;  
        });
    }

    private static normaliseRequestParams(args: Record<string, string>) {
        let pairs = JiraOnPremOAuth.makeArrayOfArgumentsHash(args);
        // First encode them #3.4.1.3.2 .1
        for(let i=0;i<pairs.length;i++) {
            pairs[i][0] = JiraOnPremOAuth.encodeData( pairs[i][0] );
            pairs[i][1] = JiraOnPremOAuth.encodeData( pairs[i][1] );
        }
        
        // Then sort them #3.4.1.3.2 .2
        pairs = JiraOnPremOAuth.sortRequestParams( pairs );
        
        // Then concatenate together #3.4.1.3.2 .3 & .4
        let result = "";
        for(let i=0;i<pairs.length;i++) {
            result += pairs[i][0];
            result += "=";
            result += pairs[i][1];
            if( i < pairs.length-1 ) result+= "&";
        }     
        return result;
    }

    private static buildAuthorizationHeaders(orderedParameters: [string, string][]) {
        let authHeader = "OAuth ";
        for( const [key, value] of Object.values(orderedParameters)) {
           // Whilst the all the parameters should be included within the signature, only the oauth_ arguments
           // should appear within the authorization header.
            if (JiraOnPremOAuth.isParameterNameAnOAuthParameter(key) ) {
                authHeader+= JiraOnPremOAuth.encodeData(key)+"=\""+ JiraOnPremOAuth.encodeData(value)+"\",";
            }
        }
        authHeader= authHeader.substring(0, authHeader.length - 1);
        return authHeader;
    }

    // Is the parameter considered an OAuth parameter
    private static isParameterNameAnOAuthParameter (parameter: string) {
        const m = parameter.match('^oauth_');
        return m && m[0] === "oauth_";
    }
}