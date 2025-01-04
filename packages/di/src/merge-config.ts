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
 * Merges two application configurations
 * @param baseConfig - Base configuration to merge into
 * @param config - Configuration to merge with base
 * @returns Merged configuration with providers properly combined
 */
export function mergeConfig(baseConfig: AppConfig, config: AppConfig): AppConfig {
    const mergedConfig: AppConfig = {
        ...baseConfig,
        ...config
    }
    for (let provider of config.providers) {
        const isFound = findProvider(baseConfig.providers, provider.provide)
        if (!isFound) {
            mergedConfig.providers = override(baseConfig.providers, provider, { upsert: true })
        }
    }
    return mergedConfig;
}
