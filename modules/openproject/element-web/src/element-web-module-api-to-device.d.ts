import type { ToDeviceApi } from "./OpenProjectCapabilityClient";

// Remove this augmentation when the Module API release includes toDevice.
declare module "@element-hq/element-web-module-api" {
  interface ClientApi {
    readonly toDevice: ToDeviceApi;
  }
}
