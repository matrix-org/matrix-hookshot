import { createContext } from "preact";
import type { BridgeAPI } from "./BridgeAPI";

interface IBridgeContext {
    bridgeApi: BridgeAPI;
}

const fakeBridgeContext = {
    get bridgeApi(): BridgeAPI {
        throw Error('No context provided');
    }
}

export const BridgeContext = createContext<IBridgeContext>(fakeBridgeContext);

