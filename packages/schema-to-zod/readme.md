# Schema to Zod

Convert JSON Schema to Zod validation schemas.

## Installation

```bash
npm install @signe/schema-to-zod
```

## Usage

```typescript
import { jsonSchemaToZod } from '@signe/schema-to-zod';
import { z } from 'zod';

// Define your JSON Schema
const schema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 3 },
    email: { type: 'string', format: 'email' },
    age: { type: 'integer', minimum: 18 },
    tags: { 
      type: 'array',
      items: { type: 'string' },
      minItems: 1
    }
  },
  required: ['name', 'email']
};

// Convert to Zod schema
const zodSchema = z.object(jsonSchemaToZod(schema));

// Use the schema for validation
const result = zodSchema.safeParse({
  name: 'John',
  email: 'john@example.com',
  age: 25,
  tags: ['developer']
});

if (result.success) {
  console.log('Valid data:', result.data);
} else {
  console.log('Validation errors:', result.error);
}
```

## Features

- Supports common JSON Schema types:
  - string
  - number
  - integer
  - boolean
  - array
  - object
  - null

- Handles JSON Schema formats:
  - date
  - date-time
  - email
  - hostname
  - ipv4
  - ipv6
  - uri
  - uuid
  - color
  - password
  - code
  - percent

- Supports validation rules:
  - required fields
  - string: minLength, maxLength, pattern
  - number: minimum, maximum
  - array: minItems, maxItems
  - enum values

## API

### `jsonSchemaToZod(schema: JSONSchema7 | JSONSchema7Definition[]): Record<string, ZodType<unknown>>`

Converts a JSON Schema to a Zod schema object.

Parameters:
- `schema`: A JSON Schema object or array of schema objects

Returns:
- A record of Zod type definitions that can be used with `z.object()`

## Examples

### Nested Objects

```typescript
const schema = {
  type: 'object',
  properties: {
    user: {
      type: 'object',
      properties: {
        profile: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'integer' }
          },
          required: ['name']
        }
      }
    }
  }
};

const zodSchema = z.object(jsonSchemaToZod(schema));
```

### Array Validation

```typescript
const schema = {
  type: 'object',
  properties: {
    users: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'integer' }
        },
        required: ['name']
      },
      minItems: 1,
      maxItems: 3
    }
  },
  required: ['users']
};

const zodSchema = z.object(jsonSchemaToZod(schema));
```

## License

MIT
