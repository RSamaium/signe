/**
 * Type definitions for the dependency injection system
 * @module @signe/di/types
 */

/**
 * Context object used for dependency injection
 */
export type ProviderContext = any;

/**
 * Token used to identify a provider. Can be either a class constructor or a string
 */
export type ProviderToken = (new (...args: any[]) => any) | string;

/**
 * Factory function type that creates instances using the provided context
 * @param context - The injection context
 * @returns The created instance
 */
export type FactoryFn = (context: ProviderContext) => any;

/**
 * Provider configuration for value-based injection
 */
export interface ProviderMeta {
  [key: string]: any;
}

/**
 * Common options available to all providers
 */
export interface ProviderOptions {
  /**
   * When true, allows multiple instances to be registered for the same token
   */
  multi?: boolean;
  /**
   * Optional name used to register and resolve a specific instance
   */
  name?: string;
}

/**
 * Options that can be passed when calling {@link provide}
 */
export interface ProvideOptions extends ProviderOptions {}

/**
 * Options that can be passed when calling {@link inject}
 */
export interface InjectionOptions {
  /**
   * Optional name used to resolve a specific instance
   */
  name?: string;
  /**
   * When true, allows retrieving all instances registered with {@link ProviderOptions.multi}
   */
  multi?: boolean;
  /**
   * When true, `inject` will return `undefined` instead of throwing if the instance is missing
   */
  optional?: boolean;
}

/**
 * Options used when checking if an instance exists in the context
 */
export interface InstanceLookupOptions {
  /**
   * Optional name of the instance to check
   */
  name?: string;
}

export interface ValueProvider extends ProviderOptions {
  /** Token to identify the provider */
  provide: ProviderToken;
  /** Value to be injected */
  useValue: any;
  /** Tokens that must be injected before this provider */
  deps?: ProviderToken[];
  /** Optional metadata for the provider */
  meta?: ProviderMeta;
}

/**
 * Provider configuration for class-based injection
 */
export interface ClassProvider extends ProviderOptions {
  /** Token to identify the provider */
  provide: ProviderToken;
  /** Class to be instantiated */
  useClass: new (context: ProviderContext) => any;
  /** Tokens that must be injected before this provider */
  deps?: ProviderToken[];
  /** Optional metadata for the provider */
  meta?: ProviderMeta;
}

/**
 * Provider configuration for factory-based injection
 */
export interface FactoryProvider extends ProviderOptions {
  /** Token to identify the provider */
  provide: ProviderToken;
  /** Tokens that must be injected before this provider */
  deps?: ProviderToken[];
  /** Optional metadata for the provider */
  meta?: ProviderMeta;
  /** Factory function to create the instance */
  useFactory: FactoryFn;
}

/**
 * Provider configuration for alias-based injection
 */
export interface ExistingProvider extends ProviderOptions {
  /** Token to identify the provider */
  provide: ProviderToken;
  /** Token of the existing provider to use */
  useExisting: ProviderToken;
  /** Tokens that must be injected before this provider */
  deps?: ProviderToken[];
  /** Optional metadata for the provider */
  meta?: ProviderMeta;
}

/**
 * Union type for all possible provider configurations
 */
export type Provider = 
  | (new (...args: any[]) => any) // Allow direct class usage
  | (ValueProvider & { useClass?: never, useFactory?: never, useExisting?: never })
  | (ClassProvider & { useValue?: never, useFactory?: never, useExisting?: never })
  | (FactoryProvider & { useValue?: never, useClass?: never, useExisting?: never })
  | (ExistingProvider & { useValue?: never, useClass?: never, useFactory?: never });

/**
 * Array of providers that can be nested one level deep
 */
export type Providers = (Provider | Providers)[];