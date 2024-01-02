import { MatrixClient } from "matrix-bot-sdk";
import { BridgeAPI } from "../../web/BridgeAPI";
import { WidgetApi } from "matrix-widget-api";

export async function getBridgeApi(publicUrl: string, user: MatrixClient) {
    return BridgeAPI.getBridgeAPI(publicUrl, {
        requestOpenIDConnectToken: () => {
            return user.getOpenIDConnectToken()
        },
    } as unknown as WidgetApi, {
        getItem() { return null},
        setItem() { },
    } as unknown as Storage);
}