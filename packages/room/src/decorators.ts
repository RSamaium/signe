export function action(name: string, bodyValidation?) {
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

export function Room(options) {
  return function (target: any) {
    target.path = options.path;
    target.maxUsers = options.maxUsers;
    target.throttleStorage = options.throttleStorage;
  };
}
