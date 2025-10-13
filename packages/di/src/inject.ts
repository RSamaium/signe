/**
 * Core functionality for dependency injection
 * @module @signe/di/inject
 */

import { Context } from "./context";
import {
  InjectionOptions,
  InstanceLookupOptions,
  ProvideOptions,
  Provider,
  ProviderToken,
  Providers
} from "./types";

const DEFAULT_INSTANCE_KEY = "__default__";

interface ProviderRecord {
  multi: boolean;
  values: Map<string, any>;
  injected: Set<string>;
}

function toTokenName(token: ProviderToken | string): string {
  return typeof token === "function" ? token.name : token;
}

function toInstanceKey(name?: string): string {
  return name ?? DEFAULT_INSTANCE_KEY;
}

function getRecord(context: Context, token: ProviderToken | string): ProviderRecord | undefined {
  return context.get("inject:" + toTokenName(token));
}

function ensureRecord(context: Context, token: ProviderToken | string): ProviderRecord {
  const key = "inject:" + toTokenName(token);
  let record = context.get(key) as ProviderRecord | undefined;
  if (!record) {
    record = {
      multi: false,
      values: new Map<string, any>(),
      injected: new Set<string>()
    };
  }
  context.set(key, record);
  return record;
}

/**
 * Provides a value to the dependency injection context
 * @template T - Type of the value being provided
 * @param context - The injection context
 * @param token - Identifier for the provided value
 * @param value - The value to provide
 * @param options - Configuration options for the provided value
 * @returns The provided value
 */
export function provide<T>(
  context: Context,
  token: ProviderToken | string,
  value: T,
  options: ProvideOptions = {}
): T {
  const record = ensureRecord(context, token);
  const instanceKey = toInstanceKey(options.name);

  if (options.multi) {
    record.multi = true;
  }

  if (!record.multi && instanceKey !== DEFAULT_INSTANCE_KEY) {
    // If we are switching from single to named instance without multi, enable multi mode implicitly
    record.multi = true;
  }

  record.values.set(instanceKey, value);
  return value;
}

/**
 * Checks if a service has been injected into the context
 * @param context - The injection context
 * @param token - Token of the service to check
 * @param options - Optional lookup configuration
 * @returns True if the service has been injected, false otherwise
 */
export function isInjected(
  context: Context,
  token: ProviderToken | string,
  options: InstanceLookupOptions = {}
): boolean {
  const record = getRecord(context, token);
  if (!record) {
    return false;
  }

  if (options.name) {
    return record.injected.has(toInstanceKey(options.name));
  }

  if (record.multi) {
    return record.injected.size > 0;
  }

  return record.injected.has(DEFAULT_INSTANCE_KEY);
}

/**
 * Checks if a service has been provided in the context
 * @param context - The injection context
 * @param token - Token of the service to check
 * @param options - Optional lookup configuration
 * @returns True if the service has been provided, false otherwise
 */
export function isProvided(
  context: Context,
  token: ProviderToken | string,
  options: InstanceLookupOptions = {}
): boolean {
  const record = getRecord(context, token);
  if (!record) {
    return false;
  }

  if (options.name) {
    return record.values.has(toInstanceKey(options.name));
  }

  if (record.multi) {
    return record.values.size > 0;
  }

  return record.values.has(DEFAULT_INSTANCE_KEY);
}

/**
 * Checks if an instance exists in the context
 * @param context - The injection context
 * @param token - Token of the service to check
 * @param options - Optional lookup configuration
 * @returns True if the instance exists, false otherwise
 */
export function hasInstance(
  context: Context,
  token: ProviderToken | string,
  options: InstanceLookupOptions = {}
): boolean {
  return isProvided(context, token, options);
}

function handleMissingInjection(
  token: ProviderToken | string,
  options: InjectionOptions
): never {
  const name = toTokenName(token);
  if (options.name) {
    throw new Error(`Injection provider ${name} with name ${options.name} not found`);
  }
  throw new Error(`Injection provider ${name} not found`);
}

function markInjected(record: ProviderRecord, key: string) {
  record.injected.add(key);
}

function markAllInjected(record: ProviderRecord) {
  for (const key of record.values.keys()) {
    record.injected.add(key);
  }
}

export function inject<T>(context: Context, token: ProviderToken | string, options: InjectionOptions & { multi: true }): T[];
export function inject<T>(context: Context, token: ProviderToken | string, options: InjectionOptions & { optional: true }): T | undefined;
export function inject<T>(context: Context, token: ProviderToken | string, options?: InjectionOptions): T;
/**
 * Retrieves a service from the dependency injection context
 * @template T - Type of the service to inject
 * @param context - The injection context
 * @param token - Class constructor or string identifier of the service
 * @param options - Optional configuration for resolving the service
 * @returns The injected service instance or `undefined` when optional
 * @throws {Error} If the requested service is not found in the context
 */
export function inject<T>(
  context: Context,
  token: ProviderToken | string,
  options: InjectionOptions = {}
): T | T[] | undefined {
  const record = getRecord(context, token);

  if (!record) {
    if (options.optional) {
      return options.multi ? [] : undefined;
    }
    return handleMissingInjection(token, options);
  }

  if (options.name) {
    const instanceKey = toInstanceKey(options.name);
    if (!record.values.has(instanceKey)) {
      if (options.optional) {
        return undefined;
      }
      return handleMissingInjection(token, options);
    }
    const value = record.values.get(instanceKey);
    markInjected(record, instanceKey);
    return value as T;
  }

  if (options.multi || record.multi) {
    if (record.values.size === 0) {
      if (options.optional) {
        return [];
      }
      return handleMissingInjection(token, options);
    }
    markAllInjected(record);
    return Array.from(record.values.values()) as T[];
  }

  const value = record.values.get(DEFAULT_INSTANCE_KEY);
  if (value === undefined) {
    if (options.optional) {
      return undefined;
    }
    return handleMissingInjection(token, options);
  }

  markInjected(record, DEFAULT_INSTANCE_KEY);
  return value as T;
}

/**
 * Overrides or adds a provider in the providers array
 * @param providers - Array of existing providers
 * @param newProvider - Provider to add or replace with
 * @param options - Configuration options
 * @param options.upsert - If true, adds the provider when not found
 * @param options.key - Custom key to identify the provider
 * @returns Updated array of providers
 */
export function override(
  providers: Providers,
  newProvider: Provider,
  options?: {
    upsert?: boolean,
    key?: string
  }
) {
  let { upsert = false, key } = options ?? {};
  if (!key) {
    key = (
      typeof newProvider === "function" ? newProvider.name : newProvider.provide
    ) as string;
  }

  // Flatten the providers array
  const flatProviders = providers.flat();

  // Check if provider exists
  const exists = flatProviders.some(provider => {
    if (typeof provider === "function") {
      return provider.name === key;
    } else if (typeof provider === "object") {
      return (provider as any).provide === key;
    }
    return false;
  });

  // Map and replace if found
  const mappedProviders = flatProviders.map((provider) => {
    if (typeof provider === "function" && provider.name === key) {
      return newProvider;
    } else if (typeof provider === "object" && (provider as any).provide === key) {
      return newProvider;
    }
    return provider;
  });

  // If upsert is true and provider wasn't found, add it to the end
  if (upsert && !exists) {
    mappedProviders.push(newProvider);
  }

  return mappedProviders;
}

/**
 * Finds all providers matching the given name or pattern
 * @template T - Type of provider to return
 * @param providers - Array of providers to search
 * @param name - String or RegExp to match against provider names
 * @returns Array of matching providers
 */
export function findProviders<T extends Provider = Provider>(providers: Providers, name: string | RegExp): T[] {
  const results: any[] = [];

  for (const provider of providers) {
    if (Array.isArray(provider)) {
      // Recursively search in nested arrays and concat results
      results.push(...findProviders(provider, name));
    } else if (findProvider(provider as any, name)) {
      // Add matching provider to results
      results.push(provider as T);
    }
  }

  return results;
}

/**
 * Finds the first provider matching the given name or pattern
 * @template T - Type of provider to return
 * @param providers - Array of providers to search
 * @param name - String or RegExp to match against provider names
 * @returns Matching provider or null if not found
 */
export function findProvider<T extends Provider = Provider>(providers: Providers, name: string | RegExp): T | null {
  // Handle single provider case
  if (!Array.isArray(providers)) {
    if (typeof providers === "object" && 'provide' in providers) {
      const provider = providers as any
      const providerName = typeof provider.provide === "function"
        ? provider.provide.name
        : provider.provide;

      if (name instanceof RegExp) {
        if (name.test(providerName)) return providers as T;
      } else {
        if (providerName === name) return providers as T;
      }
    }
    return null;
  }

  // Original array handling logic
  for (const provider of providers) {
    // If provider is an array, recursively search in it
    if (Array.isArray(provider)) {
      const found = findProvider(provider, name);
      if (found) return found as T;
      continue;
    }

    // Check object provider
    if (typeof provider === "object" && 'provide' in provider) {
      const providerName = typeof provider.provide === "function"
        ? provider.provide.name
        : provider.provide;

      // Handle RegExp matching
      if (name instanceof RegExp) {
        if (name.test(providerName)) return provider as T;
      } else {
        // Handle exact string matching
        if (providerName === name) return provider as T;
      }
    }
  }
  return null;
}
