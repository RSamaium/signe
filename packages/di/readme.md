# @signe/di

A lightweight and flexible dependency injection system for JavaScript/TypeScript applications.

## Installation

```bash
npm install @signe/di
# or
yarn add @signe/di
# or
pnpm add @signe/di
```

## Features

- Simple and intuitive API
- Type-safe dependency injection
- Provider system with multiple configuration options
- Context-based injection
- Override capabilities for testing and customization
- Support for nested providers

## Usage

### Basic Usage

```typescript
import { provide, inject, Context, Providers } from '@signe/di';

const context = new Context();

class UserService {
  getUser(id: string) {
    return { id, name: 'John Doe' };
  }
}

class AuthService {
  constructor(private config: any) {}
}

const providers: Providers = [
  UserService,
  {
    provide: 'CONFIG',
    useValue: {
      apiUrl: 'https://api.example.com'
    }
  },
  {
    provide: AuthService,
    useFactory: (context) => {
      const config = inject(context, 'CONFIG');
      return new AuthService(config);
    }
  }
];

// Provide the service
provide(context, providers);

// Inject and use the service
const userService = inject(context, UserService);
const user = userService.getUser('123');
```

### Override Providers

```typescript
import { override } from '@signe/di';

// Override existing provider
const newProviders = override(providers, {
  provide: UserService,
  useValue: new MockUserService()
});

// Add new provider with upsert option
const updatedProviders = override(providers, {
  provide: 'NEW_SERVICE',
  useValue: service
}, { upsert: true });
```

### Check Injection Status

```typescript
import { isInjected } from '@signe/di';

if (isInjected(context, UserService)) {
  // Service is already injected
}
```

### Find Providers

```typescript
import { findProvider, findProviders } from '@signe/di';

// Find single provider
const userProvider = findProvider(providers, UserService);

// Find multiple providers by regex
const allServices = findProviders(providers, /Service$/);
```

## API Reference

### `provide(context, key, value)`
Stores a value in the context for dependency injection.

### `inject(context, key)`
Retrieves an injected value from the context.

### `isInjected(context, key)`
Checks if a value has been injected.

### `override(providers, newProvider, options?)`
Overrides or adds new providers to the existing provider array.

### `findProvider(providers, query)`
Finds a single provider by name or regex.

### `findProviders(providers, query)`
Finds all providers matching the query.

## License

MIT © Samuel Ronce
