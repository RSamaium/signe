/**
 * Configuration merging functionality for dependency injection
 * @module @signe/di/merge-config
 */

import { findProvider, override } from "./inject";

/**
 * Application configuration interface
 */
export interface AppConfig {
    /** Array of dependency providers */
    providers: any[];
    /** Optional static files configuration */
    staticFiles?: {
        /** Path to static files */
        path: string;
        /** Static file serving configuration */
        serve: any;
    }
}

/**
 * Process a provider or nested provider array and add it to the merged config
 * @param mergedConfig - Configuration being built
 * @param baseConfig - Original base configuration 
 * @param provider - Provider or nested provider array to process
 */
function processProvider(mergedConfig: AppConfig, baseConfig: AppConfig, provider: any) {
    // Handle nested arrays of providers
    if (Array.isArray(provider)) {
        for (const nestedProvider of provider) {
            processProvider(mergedConfig, baseConfig, nestedProvider);
        }
        return;
    }

    // Handle individual provider
    const existingProvider = findProvider(baseConfig.providers, provider.provide);
    if (existingProvider) {
        // Replace existing provider
        mergedConfig.providers = override(mergedConfig.providers, provider);
    } else {
        // Add new provider
        mergedConfig.providers.push(provider);
    }
}

/**
 * Merges two application configurations
 * @param baseConfig - Base configuration to merge into
 * @param config - Configuration to merge with base
 * @returns Merged configuration with providers properly combined
 */
export function mergeConfig(baseConfig: AppConfig, config: AppConfig): AppConfig {
    // Create a new config object with everything except providers
    const mergedConfig: AppConfig = {
        ...baseConfig,
        ...config,
        providers: [...baseConfig.providers] // Start with a copy of base providers
    }

    // Process each provider from the config to merge
    for (const provider of config.providers) {
        processProvider(mergedConfig, baseConfig, provider);
    }

    return mergedConfig;
}
