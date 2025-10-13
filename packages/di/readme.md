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
- Optional injection resolution helpers
- Support for multiple named instances per token

## Usage

### Basic Usage

```typescript
import { provide, inject, Context, Providers, injector } from '@signe/di';

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

// Register the services
await injector(context, providers);

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

### Optional injection

```typescript
import { inject } from '@signe/di';

const maybeService = inject(context, 'UNKNOWN_SERVICE', { optional: true });
if (!maybeService) {
  // Handle missing service without throwing an exception
}
```

### Multiple named instances

```typescript
import { provide, inject } from '@signe/di';

provide(context, UserService, new UserService('primary'), {
  multi: true,
  name: 'primary'
});

provide(context, UserService, new UserService('secondary'), {
  multi: true,
  name: 'secondary'
});

const allInstances = inject<UserService>(context, UserService, { multi: true });
const secondary = inject<UserService>(context, UserService, { name: 'secondary' });
```

### Check Injection Status

```typescript
import { isInjected } from '@signe/di';

if (isInjected(context, UserService)) {
  // Service is already injected
}
```

### Dependency Declaration

You can declare dependencies using the `deps` property. The injector will automatically sort providers to ensure dependencies are instantiated before the services that need them.

```typescript
import { provide, inject, Context, Providers, injector } from '@signe/di';

const context = new Context();

class DatabaseService {
  connect() {
    return 'Connected to database';
  }
}

class UserRepository {
  constructor(context: Context) {
    this.db = inject(context, DatabaseService);
  }
  
  static deps = [DatabaseService];
}

class UserService {
  constructor(context: Context) {
    this.repository = inject(context, UserRepository);
  }
  
  static deps = [UserRepository];
}

const providers: Providers = [
  UserService,
  UserRepository,
  DatabaseService
];

// The injector will automatically sort: DatabaseService -> UserRepository -> UserService
await injector(context, providers);
```

You can also declare dependencies on provider objects:

```typescript
const providers: Providers = [
  {
    provide: 'API_CLIENT',
    useFactory: (context) => {
      const config = inject(context, 'CONFIG');
      return new ApiClient(config);
    },
    deps: ['CONFIG']
  },
  {
    provide: 'CONFIG',
    useValue: { apiUrl: 'https://api.example.com' }
  }
];
```

**Note:** The injector will detect and throw an error if circular dependencies are found.

### Find Providers

```typescript
import { findProvider, findProviders } from '@signe/di';

// Find single provider
const userProvider = findProvider(providers, UserService);

// Find multiple providers by regex
const allServices = findProviders(providers, /Service$/);
```

## API Reference

### `provide(context, token, value, options?)`
Stores a value in the context for dependency injection.

- `options.multi` — When `true`, allows multiple instances for the same token
- `options.name` — Registers the instance under a specific name

### `inject(context, token, options?)`
Retrieves an injected value from the context.

- `options.optional` — Returns `undefined`/`[]` instead of throwing when missing
- `options.multi` — Returns all registered instances as an array
- `options.name` — Retrieves a specific named instance

### `isInjected(context, token, options?)`
Checks if a value has been injected. Supports named lookups via the `name` option.

### `isProvided(context, token, options?)`
Checks if a value has been registered in the context.

### `hasInstance(context, token, options?)`
Alias of `isProvided`, kept for readability when checking for instance existence.

### `override(providers, newProvider, options?)`
Overrides or adds new providers to the existing provider array.

### `findProvider(providers, query)`
Finds a single provider by name or regex.

### `findProviders(providers, query)`
Finds all providers matching the query.

## License

MIT © Samuel Ronce
