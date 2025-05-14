import { ProvisioningRequest } from "matrix-appservice-bridge";
import { GetAuthResponse } from "../widgets/BridgeWidgetInterface";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { Response } from "express";
import { ApiError, ErrCode } from "../api";

export class OpenProjectWidgetAPI {
  public static async getAuth(
    req: ProvisioningRequest,
    res: Response<GetAuthResponse>,
    tokenStore: UserTokenStore,
  ) {
    if (!req.userId) {
      throw new ApiError("Missing userId");
    }
    const user = await tokenStore.getOpenProjectForUser(req.userId);
    if (user) {
      const ident = await user.getIdentity();
      res.json({ user: { name: ident.name }, authenticated: true });
    } else {
      if (!tokenStore.openProjectOAuth) {
        throw new ApiError(
          "OAuth is not supported",
          ErrCode.UnsupportedOperation,
        );
      }
      const stateId = tokenStore.createStateForOAuth(req.userId);
      const authUrl = await tokenStore.openProjectOAuth.getAuthUrl(stateId);
      res.json({ authUrl, authenticated: false, stateId });
    }
  }
}
