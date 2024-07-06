export function Action(name: string, bodyValidation?) {
  return function (target: any, propertyKey: string) {
    if (!target.constructor._actionMetadata) {
      target.constructor._actionMetadata = new Map();
    }
    target.constructor._actionMetadata.set(name, {
      key: propertyKey,
      bodyValidation,
    });
  };
}

export interface RoomOptions {
  path: string;
  maxUsers?: number;
  throttleStorage?: number;
  throttleSync?: number;
  hibernate?: boolean;
}

export function Room(options: RoomOptions) {
  return function (target: any) {
    target.path = options.path;
    target.maxUsers = options.maxUsers;
    target.throttleStorage = options.throttleStorage;
    target.throttleSync = options.throttleSync;
  };
}
