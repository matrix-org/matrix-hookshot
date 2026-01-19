import { BridgeOpenProjectOAuthConfig } from "../config/sections/OpenProject";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { OAuthRequest, OAuthRequestResult } from "../tokens/Oauth";
import { Logger } from "matrix-appservice-bridge";

const log = new Logger("OpenProjectOAuth");

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: "api_v3";
  created_at: number;
}

export class OpenProjectOAuth {
  constructor(
    private readonly tokenStore: UserTokenStore,
    private readonly oauthConfig: BridgeOpenProjectOAuthConfig,
    private readonly baseUrl: URL,
  ) {}
  public async getAuthUrl(state: string) {
    const url = new URL("/oauth/authorize", this.baseUrl);
    url.searchParams.set("client_id", this.oauthConfig.clientId);
    url.searchParams.set("redirect_uri", this.oauthConfig.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "api_v3");
    return url.toString();
  }

  public async exchangeRefreshToken(
    refreshToken: string,
  ): Promise<TokenResponse> {
    const url = new URL("/oauth/token", this.baseUrl);
    const params = new URLSearchParams();
    params.set("client_id", this.oauthConfig.clientId);
    params.set("client_secret", this.oauthConfig.clientSecret);
    params.set("refresh_token", refreshToken);
    params.set("grant_type", "refresh_token");
    const res = await fetch(url, {
      method: "POST",
      body: params.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const data = (await res.json()) as TokenResponse;
    if (res.status !== 200) {
      throw Error(`Unexpected status ${res.status}`);
    }
    return data;
  }

  public async exchangeRequestForToken(code: string): Promise<TokenResponse> {
    const url = new URL("/oauth/token", this.baseUrl);
    const params = new URLSearchParams();
    params.set("client_id", this.oauthConfig.clientId);
    params.set("client_secret", this.oauthConfig.clientSecret);
    params.set("redirect_uri", this.oauthConfig.redirectUri);
    params.set("code", code);
    params.set("grant_type", "authorization_code");
    const res = await fetch(url, {
      method: "POST",
      body: params.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const data = (await res.json()) as TokenResponse;
    if (res.status !== 200) {
      throw Error(`Unexpected status ${res.status}`);
    }
    return data;
  }

  public async handleOAuth({
    state,
    code,
  }: OAuthRequest): Promise<OAuthRequestResult> {
    const userId = this.tokenStore.getUserIdForOAuthState(state);
    if (!userId) {
      return OAuthRequestResult.UserNotFound;
    }
    try {
      const now = Date.now();
      const tokenInfo = await this.exchangeRequestForToken(code);
      if (!tokenInfo.scope.includes("api_v3")) {
        // Logout?
        return OAuthRequestResult.InvalidScope;
      }
      await this.tokenStore.storeOpenProjectToken(userId, {
        access_token: tokenInfo.access_token,
        refresh_token: tokenInfo.refresh_token,
        expires_in: now + tokenInfo.expires_in * 1000,
      });

      return OAuthRequestResult.Success;
    } catch (ex) {
      log.warn(`Failed to handle JIRA oauth token exchange`, ex);
      return OAuthRequestResult.UnknownFailure;
    }
  }
}
