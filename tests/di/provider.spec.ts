import { describe, it, expect, beforeEach } from 'vitest';
import {
  provide,
  inject,
  isInjected,
  override,
  findProvider,
  findProviders,
  Context,
  hasInstance,
  isProvided
} from '../../packages/di/src';
import {
  Providers,
  FactoryProvider,
  ClassProvider,
  ValueProvider,
  ExistingProvider,
  Provider
} from '../../packages/di/src';
import { injector } from '../../packages/di/src/provider';

// Mock classes and services for testing
class TestService {
  constructor(public value: string = 'test') {}
}

class DependentService {
  constructor(private testService: TestService) {}
  getValue() {
    return this.testService.value;
  }
}

class AsyncService {
  constructor(public value: string = 'async') {}
  async init() {
    return new Promise(resolve => setTimeout(resolve, 10));
  }
}

// Mock provider objects
const mockProvider: ValueProvider = {
  provide: 'mockService',
  useValue: 'mock value'
};

describe('Dependency Injection System', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  describe('Context', () => {
    it('should store and retrieve values', () => {
      context.set('test', 'value');
      expect(context.get('test')).toBe('value');
    });

    it('should return undefined for non-existent keys', () => {
      expect(context.get('nonexistent')).toBeUndefined();
    });
  });

  describe('provide', () => {
    it('should store value in context and return it', () => {
      const value = 'test value';
      const result = provide(context, 'testKey', value);
      expect(inject(context, 'testKey')).toBe(value);
      expect(result).toBe(value);
    });

    it('should handle complex objects', () => {
      const obj = { nested: { value: 'test' } };
      provide(context, 'complex', obj);
      expect(inject(context, 'complex')).toEqual(obj);
    });

    it('should handle class instances', () => {
      const service = new TestService();
      provide(context, TestService, service);
      expect(inject(context, TestService)).toBe(service);
    });

    it('should store named instances when multi is enabled', () => {
      const first = new TestService('first');
      const second = new TestService('second');

      provide(context, TestService, first, { multi: true, name: 'first' });
      provide(context, TestService, second, { multi: true, name: 'second' });

      expect(hasInstance(context, TestService, { name: 'first' })).toBe(true);
      expect(hasInstance(context, TestService, { name: 'second' })).toBe(true);
      expect(inject<TestService>(context, TestService, { name: 'first' })).toBe(first);
      expect(inject<TestService>(context, TestService, { multi: true })).toEqual([first, second]);
    });
  });

  describe('inject', () => {
    it('should retrieve existing value from context', () => {
      const service = new TestService();
      provide(context, TestService, service);
      const result = inject(context, TestService);
      expect(result).toBe(service);
    });

    it('should throw error when provider not found', () => {
      expect(() => inject(context, TestService)).toThrow('Injection provider TestService not found');
    });

    it('should handle string tokens', () => {
      provide(context, 'CONFIG', { apiUrl: 'test' });
      const config = inject<{ apiUrl: string }>(context, 'CONFIG');
      expect(config).toEqual({ apiUrl: 'test' });
    });

    it('should mark service as injected after retrieval', () => {
      const service = new TestService();
      provide(context, TestService, service);
      inject(context, TestService);
      expect(isInjected(context, TestService)).toBe(true);
    });

    it('should return undefined when optional flag is set and provider is missing', () => {
      expect(inject(context, 'missing', { optional: true })).toBeUndefined();
    });

    it('should return empty array for optional multi provider when missing', () => {
      expect(inject(context, 'missingMulti', { optional: true, multi: true })).toEqual([]);
    });

    it('should resolve named instances', () => {
      const first = new TestService('first');
      const second = new TestService('second');
      provide(context, TestService, first, { multi: true, name: 'first' });
      provide(context, TestService, second, { multi: true, name: 'second' });

      const resolved = inject<TestService>(context, TestService, { name: 'second' });
      expect(resolved).toBe(second);
    });
  });

  describe('isInjected', () => {
    it('should return true if service was injected', () => {
      const service = new TestService();
      provide(context, TestService, service);
      inject(context, TestService);
      expect(isInjected(context, TestService)).toBe(true);
    });

    it('should return false if service was not injected', () => {
      expect(isInjected(context, TestService)).toBe(false);
    });

    it('should handle string tokens', () => {
      provide(context, 'CONFIG', { apiUrl: 'test' });
      inject(context, 'CONFIG');
      expect(isInjected(context, 'CONFIG')).toBe(true);
    });

    it('should track named injections independently', () => {
      const first = new TestService('first');
      const second = new TestService('second');
      provide(context, TestService, first, { multi: true, name: 'first' });
      provide(context, TestService, second, { multi: true, name: 'second' });

      inject(context, TestService, { name: 'first' });

      expect(isInjected(context, TestService, { name: 'first' })).toBe(true);
      expect(isInjected(context, TestService, { name: 'second' })).toBe(false);
    });
  });

  describe('hasInstance', () => {
    it('should return true when named instance exists', () => {
      provide(context, TestService, new TestService('first'), { multi: true, name: 'first' });
      expect(hasInstance(context, TestService, { name: 'first' })).toBe(true);
    });

    it('should return false when named instance does not exist', () => {
      provide(context, TestService, new TestService('first'), { multi: true, name: 'first' });
      expect(hasInstance(context, TestService, { name: 'second' })).toBe(false);
    });

    it('should mirror isProvided for unnamed instances', () => {
      provide(context, TestService, new TestService());
      expect(hasInstance(context, TestService)).toBe(true);
      expect(isProvided(context, TestService)).toBe(true);
    });
  });

  describe('injector', () => {
    it('should handle class providers', async () => {
      const providers: Providers = [TestService];
      await injector(context, providers);
      const service = inject(context, TestService);
      expect(service).toBeInstanceOf(TestService);
    });

    it('should handle value providers', async () => {
      const valueProvider: ValueProvider = {
        provide: 'CONFIG',
        useValue: { apiUrl: 'test' }
      };
      await injector(context, [valueProvider]);
      const config = inject<{ apiUrl: string }>(context, 'CONFIG');
      expect(config).toEqual({ apiUrl: 'test' });
    });

    it('should handle class providers with useClass', async () => {
      const classProvider: ClassProvider = {
        provide: 'CustomTest',
        useClass: TestService
      };
      await injector(context, [classProvider]);
      const service = inject<TestService>(context, 'CustomTest');
      expect(service).toBeInstanceOf(TestService);
    });

    it('should handle factory providers', async () => {
      const factoryProvider: FactoryProvider = {
        provide: 'factory',
        useFactory: () => new TestService('factory')
      };
      await injector(context, [factoryProvider]);
      const service = inject<TestService>(context, 'factory');
      expect(service.value).toBe('factory');
    });

    it('should handle async factory providers', async () => {
      const asyncProvider: FactoryProvider = {
        provide: AsyncService,
        useFactory: async () => {
          const service = new AsyncService();
          await service.init();
          return service;
        }
      };
      await injector(context, [asyncProvider]);
      const service = inject(context, AsyncService);
      expect(service).toBeInstanceOf(AsyncService);
    });

    it('should handle existing providers', async () => {
      const existingProvider: ExistingProvider = {
        provide: 'alias',
        useExisting: TestService
      };
      await injector(context, [TestService, existingProvider]);
      const original = inject(context, TestService);
      const alias = inject(context, 'alias');
      expect(alias).toBe(original);
    });

    it('should handle nested providers', async () => {
      const nestedValue: ValueProvider = { provide: 'nested', useValue: 'value' };
      const providers: Providers = [
        [TestService],
        [nestedValue as Provider]
      ];
      await injector(context, providers);
      expect(inject(context, TestService)).toBeInstanceOf(TestService);
      expect(inject(context, 'nested')).toBe('value');
    });

    it('should handle provider dependencies', async () => {
      const testService = new TestService('test-value');
      const dependentProvider: FactoryProvider = {
        provide: DependentService,
        useFactory: (ctx) => new DependentService(testService)
      };
      const providers: Providers = [
        { provide: TestService, useValue: testService },
        dependentProvider
      ];
      await injector(context, providers);
      const service = inject(context, DependentService);
      expect(service.getValue()).toBe('test-value');
    });

    it('should instantiate providers respecting dependencies', async () => {
      const first: ValueProvider = {
        provide: 'first',
        useValue: 'value'
      };
      const second: FactoryProvider = {
        provide: 'second',
        useFactory: (ctx) => 'using ' + inject<string>(ctx, 'first'),
        deps: ['first']
      };

      await injector(context, [second, first]);
      const value = inject<string>(context, 'second');
      expect(value).toBe('using value');
    });

    it('should register multiple named instances when multi is enabled', async () => {
      const first: ValueProvider = {
        provide: TestService,
        useValue: new TestService('first'),
        multi: true,
        name: 'first'
      };
      const second: ValueProvider = {
        provide: TestService,
        useValue: new TestService('second'),
        multi: true,
        name: 'second'
      };

      await injector(context, [first, second]);

      const services = inject<TestService>(context, TestService, { multi: true });
      expect(services).toHaveLength(2);
      expect(inject<TestService>(context, TestService, { name: 'first' })?.value).toBe('first');
      expect(inject<TestService>(context, TestService, { name: 'second' })?.value).toBe('second');
    });

    it('should find provider in nested arrays', () => {
      const deepProvider: ValueProvider = { provide: 'deeplyNestedService', useValue: 'deep value' };
      const nestedProvider: ValueProvider = { provide: 'nestedService', useValue: 'nested value' };
      const nestedProviders: Providers = [
        [mockProvider as Provider],
        [
          nestedProvider as Provider,
          [deepProvider as Provider]
        ]
      ];
      const result = findProvider(nestedProviders, 'deeplyNestedService');
      expect(result).toEqual(deepProvider);
    });

    it('should handle class providers when searching', () => {
      const classProvider: ClassProvider = {
        provide: TestService,
        useClass: TestService
      };
      const providers = [classProvider];
      const result = findProvider(providers, TestService.name);
      expect(result).toBe(classProvider);
    });
  });

  describe('override', () => {
    it('should replace existing provider', () => {
      const providers = [TestService];
      const newProvider: ValueProvider = { provide: 'TestService', useValue: 'new value' };
      const result = override(providers, newProvider);
      expect(result).toContainEqual(newProvider);
    });

    it('should add new provider when upsert is true', () => {
      const providers = [TestService];
      const newProvider: ValueProvider = { provide: 'NewService', useValue: 'value' };
      const result = override(providers, newProvider, { upsert: true });
      expect(result).toHaveLength(2);
      expect(result).toContainEqual(newProvider);
    });

    it('should not add provider when upsert is false', () => {
      const providers = [TestService];
      const newProvider: ValueProvider = { provide: 'NewService', useValue: 'value' };
      const result = override(providers, newProvider);
      expect(result).toHaveLength(1);
      expect(result).not.toContainEqual(newProvider);
    });

    it('should handle custom key override', () => {
      const providers = [TestService];
      const newProvider: ValueProvider = { provide: 'Custom', useValue: 'value' };
      const result = override(providers, newProvider, { key: 'TestService' });
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
      const deepProvider: ValueProvider = { provide: 'deeplyNestedService', useValue: 'deep value' };
      const nestedProvider: ValueProvider = { provide: 'nestedService', useValue: 'nested value' };
      const nestedProviders: Providers = [
        [mockProvider as Provider],
        [
          nestedProvider as Provider,
          [deepProvider as Provider]
        ]
      ];
      const result = findProvider(nestedProviders, 'deeplyNestedService');
      expect(result).toEqual(deepProvider);
    });

    it('should handle class providers', () => {
      const classProvider: ClassProvider = {
        provide: TestService,
        useClass: TestService
      };
      const providers = [classProvider];
      const result = findProvider(providers, TestService.name);
      expect(result).toBe(classProvider);
    });
  });

  describe('findProviders', () => {
    it('should find all matching providers', () => {
      const mockProvider2: ValueProvider = { provide: 'mockService2', useValue: 'another mock' };
      const providers: Provider[] = [mockProvider, mockProvider2];
      const results = findProviders(providers, /mock/);
      expect(results).toHaveLength(2);
    });

    it('should find all matching providers in nested arrays', () => {
      const mock1: ValueProvider = { provide: 'mockService1', useValue: 'value 1' };
      const mock2: ValueProvider = { provide: 'mockService2', useValue: 'value 2' };
      const mock3: ValueProvider = { provide: 'mockService3', useValue: 'value 3' };
      const nestedProviders: Providers = [
        mock1,
        [
          mock2,
          [mock3]
        ]
      ];
      const results = findProviders(nestedProviders, /mock/);
      expect(results).toHaveLength(3);
      expect(results).toContainEqual(mock1);
      expect(results).toContainEqual(mock2);
      expect(results).toContainEqual(mock3);
    });

    it('should return empty array when no matches found', () => {
      const providers = [mockProvider];
      const results = findProviders(providers, 'nonexistent');
      expect(results).toHaveLength(0);
    });

    it('should handle mixed provider types', () => {
      const testValue: ValueProvider = { provide: 'testValue', useValue: 'value' };
      const testFactory: FactoryProvider = { provide: 'testFactory', useFactory: () => 'factory' };
      const providers: Provider[] = [
        TestService,
        testValue,
        testFactory
      ];
      const results = findProviders(providers, /test/i);
      expect(results).toHaveLength(2);
      expect(results).toContainEqual(testValue);
      expect(results).toContainEqual(testFactory);
    });
  });
});
