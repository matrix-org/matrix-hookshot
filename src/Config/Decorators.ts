import "reflect-metadata";

const configKeyMetadataKey = Symbol("configKey");

export function configKey(comment?: string, optional = false) {
  return Reflect.metadata(configKeyMetadataKey, [comment, optional]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getConfigKeyMetadata(target: any, propertyKey: string): [string, boolean] {
    return Reflect.getMetadata(configKeyMetadataKey, target, propertyKey);
}