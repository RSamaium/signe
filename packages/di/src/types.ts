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

export interface ValueProvider {
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
export interface ClassProvider {
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
export interface FactoryProvider {
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
export interface ExistingProvider {
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