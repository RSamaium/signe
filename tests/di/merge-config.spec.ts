import { describe, it, expect } from 'vitest';
import { mergeConfig, AppConfig } from '../../packages/di/src/merge-config';
import { ValueProvider } from '../../packages/di/src/types';

describe('mergeConfig', () => {
    it('should merge basic configurations', () => {
        const baseConfig: AppConfig = {
            providers: []
        };
        const config: AppConfig = {
            providers: []
        };
        
        const result = mergeConfig(baseConfig, config);
        expect(result).toEqual({
            providers: []
        });
    });

    it('should merge static files configuration', () => {
        const baseConfig: AppConfig = {
            providers: [],
            staticFiles: {
                path: '/base',
                serve: { option: 'base' }
            }
        };
        const config: AppConfig = {
            providers: [],
            staticFiles: {
                path: '/override',
                serve: { option: 'override' }
            }
        };
        
        const result = mergeConfig(baseConfig, config);
        expect(result.staticFiles).toEqual({
            path: '/override',
            serve: { option: 'override' }
        });
    });

    it('should merge providers and add new ones', () => {
        const baseProvider: ValueProvider = {
            provide: 'baseService',
            useValue: 'base value'
        };
        const newProvider: ValueProvider = {
            provide: 'newService',
            useValue: 'new value'
        };

        const baseConfig: AppConfig = {
            providers: [baseProvider]
        };
        const config: AppConfig = {
            providers: [newProvider]
        };
        
        const result = mergeConfig(baseConfig, config);
        expect(result.providers).toHaveLength(2);
        expect(result.providers).toContainEqual(baseProvider);
        expect(result.providers).toContainEqual(newProvider);
    });

    it('should not duplicate providers with same token', () => {
        const baseProvider: ValueProvider = {
            provide: 'service',
            useValue: 'base value'
        };
        const overrideProvider: ValueProvider = {
            provide: 'service',
            useValue: 'override value'
        };

        const baseConfig: AppConfig = {
            providers: [baseProvider]
        };
        const config: AppConfig = {
            providers: [overrideProvider]
        };
        
        const result = mergeConfig(baseConfig, config);
        expect(result.providers).toHaveLength(1);
        expect(result.providers[0]).toEqual(overrideProvider);
    });

    it('should keep base providers when config providers is empty', () => {
        const baseProvider: ValueProvider = {
            provide: 'baseService',
            useValue: 'base value'
        };

        const baseConfig: AppConfig = {
            providers: [baseProvider]
        };
        const config: AppConfig = {
            providers: []
        };
        
        const result = mergeConfig(baseConfig, config);
        expect(result.providers).toHaveLength(1);
        expect(result.providers[0]).toEqual(baseProvider);
    });

    it('should handle multiple override providers', () => {
        const baseProviders: ValueProvider[] = [
            {
                provide: 'service1',
                useValue: 'base value 1'
            },
            {
                provide: 'service2',
                useValue: 'base value 2'
            },
            {
                provide: 'service3',
                useValue: 'base value 3'
            }
        ];

        const overrideProviders: ValueProvider[] = [
            {
                provide: 'service1',
                useValue: 'override value 1'
            },
            {
                provide: 'service2',
                useValue: 'override value 2'
            },
            {
                provide: 'service4',
                useValue: 'new value 4'
            }
        ];

        const baseConfig: AppConfig = {
            providers: baseProviders
        };
        const config: AppConfig = {
            providers: overrideProviders
        };
        
        const result = mergeConfig(baseConfig, config);
        
        expect(result.providers).toHaveLength(4);
        
        expect(result.providers).toContainEqual({
            provide: 'service1',
            useValue: 'override value 1'
        });
        expect(result.providers).toContainEqual({
            provide: 'service2',
            useValue: 'override value 2'
        });
        expect(result.providers).toContainEqual({
            provide: 'service3',
            useValue: 'base value 3'
        });
        expect(result.providers).toContainEqual({
            provide: 'service4',
            useValue: 'new value 4'
        });
    });

    it('should override base providers with nested array providers having the same token', () => {
        const baseProviders = [
            {
                provide: 'serviceA',
                useValue: 'base value A'
            },
            {
                provide: 'serviceB',
                useValue: 'base value B'
            },
            {
                provide: 'serviceC',
                useValue: 'base value C'
            }
        ];

        // Create deeply nested providers array with an override
        const nestedProviders = [
            {
                provide: 'serviceD',
                useValue: 'new value D'
            },
            [
                {
                    provide: 'serviceE',
                    useValue: 'new value E'
                },
                {
                    provide: 'serviceB', // This should override the base serviceB
                    useValue: 'deeply nested override B'
                }
            ]
        ];

        const baseConfig: AppConfig = {
            providers: baseProviders
        };
        const config: AppConfig = {
            providers: nestedProviders
        };
        
        const result = mergeConfig(baseConfig, config);
        
        // Should have 5 providers total (3 from base, minus 1 overridden, plus 3 new ones)
        expect(result.providers).toHaveLength(5);
        
        // Make sure original providers that weren't overridden are still there
        expect(result.providers).toContainEqual({
            provide: 'serviceA',
            useValue: 'base value A'
        });
        expect(result.providers).toContainEqual({
            provide: 'serviceC',
            useValue: 'base value C'
        });
        
        // Check that the deeply nested provider replaced the base one
        expect(result.providers).toContainEqual({
            provide: 'serviceB',
            useValue: 'deeply nested override B'
        });
        // Verify it does NOT contain the original baseProvider
        expect(result.providers).not.toContainEqual({
            provide: 'serviceB',
            useValue: 'base value B'
        });
        
        // And the new ones were added
        expect(result.providers).toContainEqual({
            provide: 'serviceD',
            useValue: 'new value D'
        });
        expect(result.providers).toContainEqual({
            provide: 'serviceE',
            useValue: 'new value E'
        });
    });
}); 