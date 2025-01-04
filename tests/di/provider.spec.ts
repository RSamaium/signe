import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provide, inject, isInjected, override, findProvider, findProviders, Context } from '../../packages/di/src';
import { Providers } from '../../packages/di/src';

// Mock service class for testing
class TestService {
  constructor(public value: string = 'test') {}
}

// Mock provider object
const mockProvider = {
  provide: 'mockService',
  useValue: 'mock value'
};

describe('Injection System', () => {
  let context: Context;

  beforeEach(() => {
    // Create a mock Context with get/set methods
    context = {
      get: vi.fn(),
      set: vi.fn(),
    } as unknown as Context;
  });

  describe('provide', () => {
    it('should store value in context and return it', () => {
      const value = 'test value';
      const result = provide(context, 'testKey', value);
      
      expect(context.set).toHaveBeenCalledWith('inject:testKey', value);
      expect(result).toBe(value);
    });
  });

  describe('inject', () => {
    it('should retrieve existing value from context', () => {
      const mockValue = new TestService();
      context.get = vi.fn().mockReturnValue(mockValue);
      
      const result = inject(context, TestService);
      
      expect(context.get).toHaveBeenCalledWith('inject:TestService');
      expect(result).toBe(mockValue);
    });

    it('should throw error when provider not found', () => {
      context.get = vi.fn().mockReturnValue(undefined);
      
      expect(() => inject(context, TestService)).toThrow('Injection provider TestService not found');
    });
  });

  describe('isInjected', () => {
    it('should return true if service was injected', () => {
      context.get = vi.fn().mockReturnValue(true);
      
      expect(isInjected(context, 'TestService')).toBe(true);
    });

    it('should return false if service was not injected', () => {
      context.get = vi.fn().mockReturnValue(false);
      
      expect(isInjected(context, 'TestService')).toBe(false);
    });
  });

  describe('override', () => {
    it('should replace existing provider', () => {
      const providers = [TestService];
      const newProvider = { provide: 'TestService', useValue: 'new value' };
      
      const result = override(providers, newProvider);
      
      expect(result).toContainEqual(newProvider);
    });

    it('should add new provider when upsert is true', () => {
      const providers = [TestService];
      const newProvider = { provide: 'NewService', useValue: 'value' };
      
      const result = override(providers, newProvider, { upsert: true });
      
      expect(result).toHaveLength(2);
      expect(result).toContainEqual(newProvider);
    });
  });

  describe('findProvider', () => {
    it('should find provider by exact name', () => {
      const providers = [mockProvider];
      
      const result = findProvider(providers, 'mockService');
      
      expect(result).toBe(mockProvider);
    });

    it('should find provider by regex', () => {
      const providers = [mockProvider];
      
      const result = findProvider(providers, /mock/);
      
      expect(result).toBe(mockProvider);
    });

    it('should return null when provider not found', () => {
      const providers = [mockProvider];
      
      const result = findProvider(providers, 'nonexistent');
      
      expect(result).toBeNull();
    });

    it('should find provider in nested arrays', () => {
      const nestedProviders: Providers = [
        mockProvider,
        [
          { provide: 'nestedService', useValue: 'nested value' },
          [
            { provide: 'deeplyNestedService', useValue: 'deep value' }
          ]
        ]
      ];
      
      const result = findProvider(nestedProviders, 'deeplyNestedService');
      
      expect(result).toEqual({ provide: 'deeplyNestedService', useValue: 'deep value' });
    });

    it('should return null when provider not found in nested arrays', () => {
      const nestedProviders = [
        mockProvider,
        [
          { provide: 'nestedService', useValue: 'nested value' }
        ]
      ];
      
      const result = findProvider(nestedProviders, 'nonexistent');
      
      expect(result).toBeNull();
    });
  });

  describe('findProviders', () => {
    it('should find all matching providers', () => {
      const providers = [
        mockProvider,
        { provide: 'mockService2', useValue: 'another mock' }
      ];
      
      const results = findProviders(providers, /mock/);
      
      expect(results).toHaveLength(2);
    });

    it('should find all matching providers in nested arrays', () => {
      const nestedProviders = [
        { provide: 'mockService1', useValue: 'value 1' },
        [
          { provide: 'mockService2', useValue: 'value 2' },
          [
            { provide: 'mockService3', useValue: 'value 3' }
          ]
        ]
      ];
      
      const results = findProviders(nestedProviders, /mock/);
      
      expect(results).toHaveLength(3);
      expect(results).toContainEqual({ provide: 'mockService1', useValue: 'value 1' });
      expect(results).toContainEqual({ provide: 'mockService2', useValue: 'value 2' });
      expect(results).toContainEqual({ provide: 'mockService3', useValue: 'value 3' });
    });
  });
});
