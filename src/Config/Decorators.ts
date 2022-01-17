import "reflect-metadata";

const configKeyMetadataKey = Symbol("configKey");

export function configKey(comment?: string, optional = false) {
  return Reflect.metadata(configKeyMetadataKey, [comment, optional]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getConfigKeyMetadata(target: any, propertyKey: string): [string, boolean] {
    return Reflect.getMetadata(configKeyMetadataKey, target, propertyKey);
}

const hideKeyMetadataKey = Symbol("hideKey");
export function hideKey() {
  return Reflect.metadata(hideKeyMetadataKey, true);
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function keyIsHidden(target: any, propertyKey: string): boolean {
  return Reflect.getMetadata(hideKeyMetadataKey, target, propertyKey) !== undefined;
}