/**
 * Core functionality for dependency injection
 * @module @signe/di/inject
 */

import { Provider, Providers } from "./types";
import { Context } from "./context";

/**
 * Provides a value to the dependency injection context
 * @template T - Type of the value being provided
 * @param context - The injection context
 * @param name - Identifier for the provided value
 * @param value - The value to provide
 * @returns The provided value
 */
export function provide<T>(context: Context, name: string, value: T): T {
  context.set("inject:" + name, value);
  return value;
}

/**
 * Checks if a service has been injected into the context
 * @param context - The injection context
 * @param name - Name of the service to check
 * @returns True if the service has been injected, false otherwise
 */
export function isInjected(context: Context, name: string): boolean {
  return context.get('injected:' + name) === true;
}

/**
 * Checks if a service has been provided in the context
 * @param context - The injection context
 * @param name - Name of the service to check
 * @returns True if the service has been provided, false otherwise
 */
export function isProvided(context: Context, name: string): boolean {
  return context.get('inject:' + name) !== undefined;
}

/**
 * Retrieves a service from the dependency injection context
 * @template T - Type of the service to inject
 * @param context - The injection context
 * @param service - Class constructor or string identifier of the service
 * @param args - Optional arguments for service instantiation
 * @returns The injected service instance
 * @throws {Error} If the requested service is not found in the context
 */
export function inject<T>(
  context: Context,
  service: (new (...args: any[]) => T) | string,
  args: any[] = []
): T {
  const isClass = typeof service === "function";
  const name = isClass ? service.name : service;
  const value = context.get("inject:" + name);
  if (value) {
    context.set('injected:' + name, true)
    return value as T;
  }
  throw new Error(`Injection provider ${name} not found`);
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
