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
 * Retrieves dependencies declared on a provider
 * @param provider - Provider to inspect
 * @returns Array of provider tokens this provider depends on
 */
function getDeps(provider: Provider): ProviderToken[] {
    if (typeof provider === 'function') {
        return (provider as any).deps ?? [];
    }
    return (provider as any).deps ?? [];
}

/**
 * Sorts providers so that dependencies are instantiated first
 * @param providers - Array of providers to sort
 * @throws When a circular dependency is detected
 */
function sortProviders(providers: Provider[]): Provider[] {
    const tokenName = (t: ProviderToken) => typeof t === 'function' ? t.name : t;
    const map = new Map<string, Provider>();
    for (const p of providers) {
        const token = tokenName(typeof p === 'function' ? p : (p as any).provide);
        map.set(token, p);
    }

    const result: Provider[] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();

    const visit = (token: ProviderToken) => {
        const name = tokenName(token);
        if (visited.has(name)) return;
        if (stack.has(name)) {
            throw new Error(`Circular dependency detected for provider ${name}`);
        }
        stack.add(name);
        const provider = map.get(name);
        if (provider) {
            for (const dep of getDeps(provider)) {
                visit(dep);
            }
            visited.add(name);
            result.push(provider);
        }
        stack.delete(name);
    };

    for (const p of providers) {
        const token = typeof p === 'function' ? p : (p as any).provide;
        visit(token);
    }

    return result;
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
    providers = sortProviders(providers as Provider[]);

    for (const provider of providers) {
        let token: ProviderToken;
        let instance: any;

        if (typeof provider === 'function') {
            // If provider is a class, treat it as a ClassProvider
            token = provider;
            instance = new provider(context);
        } else {
            token = (provider as any).provide;
            const provideUserClass = (provider as any).useClass;
            const isClass = typeof provideUserClass === 'function';
            if (isClass) {
                instance = new provideUserClass(context);
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