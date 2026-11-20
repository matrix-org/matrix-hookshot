import { ProvisioningRequest } from "matrix-appservice-bridge";
import {
  GetAuthResponse,
  GetServiceStatusOptionsResponse,
} from "../widgets/BridgeWidgetInterface";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { Response } from "express";
import { ApiError, ErrCode } from "../api";

export class OpenProjectWidgetAPI {
  /** Return all statuses so the editor can explain which ones are closed. */
  public static async getStatuses(
    req: ProvisioningRequest,
    res: Response<GetServiceStatusOptionsResponse>,
    tokenStore: UserTokenStore,
  ) {
    if (!req.userId) {
      throw new ApiError("Missing userId");
    }
    if (!tokenStore.openProjectOAuth) {
      throw new ApiError(
        "OAuth is not supported",
        ErrCode.UnsupportedOperation,
      );
    }

    const client = await tokenStore.getOpenProjectForUser(req.userId);
    if (!client) {
      throw new ApiError(
        "OpenProject account is not connected",
        ErrCode.BadToken,
      );
    }

    const statuses = await client.getStatuses();
    res.json({
      statusOptions: statuses.map((status) => ({
        id: String(status.id),
        name: status.name,
        isClosed: status.isClosed,
      })),
    });
  }

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
