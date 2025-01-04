/**
 * Provider system implementation for dependency injection
 * @module @signe/di/provider
 */

import { ClassProvider, Provider, Providers, ProviderToken } from "./types";
import { inject, provide } from "./inject";
import { Context } from "./context";

/**
 * Type guard to check if a provider is a ClassProvider
 * @param provider - Provider to check
 * @returns True if the provider is a ClassProvider
 */
function isClassProvider(provider: Provider): provider is ClassProvider {
    if (typeof provider === 'string') {
        return false;
    }
    return 'useClass' in provider && typeof provider.useClass === 'function';
}

/**
 * Processes and instantiates all providers in the given context
 * @param context - The injection context
 * @param providers - Array of providers to process
 * @returns Promise that resolves when all providers are processed
 * 
 * @example
 * ```typescript
 * const context = new Context();
 * const providers = [
 *   UserService,
 *   { provide: 'CONFIG', useValue: { apiUrl: 'http://api.example.com' } },
 *   { provide: AuthService, useFactory: (ctx) => new AuthService(ctx) }
 * ];
 * 
 * await injector(context, providers);
 * ```
 */
export async function injector(context: Context, providers: Providers) {
    providers = providers.flat();
    for (const provider of providers) {
        let token: ProviderToken;
        let instance: any;

        if (typeof provider === 'function') {
            // If provider is a class, treat it as a ClassProvider
            token = provider;
            instance = new provider(context);
        } else {
            token = provider.provide;
            if (isClassProvider(provider)) {
                instance = new provider.useClass(context);
            } else if ('useValue' in provider) {
                instance = provider.useValue;
            } else if ('useFactory' in provider) {
                instance = provider.useFactory?.(context);
                if (instance instanceof Promise) {
                    instance = await instance;
                }
            } else if ('useExisting' in provider) {
                instance = inject(context, provider.useExisting);
            }
        }

        const name = typeof token === 'function' ? token.name : token;
        provide(context, name, instance);
    }
}