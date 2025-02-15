import { z, ZodType, ZodTypeDef } from "zod";
import type { JSONSchema7, JSONSchema7Definition, JSONSchema7TypeName } from "json-schema";

/**
 * Standard JSON Schema types only
 */
type SchemaType = Exclude<JSONSchema7TypeName, 'array' | 'object'> | 'array' | 'object';

function isValidSchemaType(type: unknown): type is SchemaType {
    if (typeof type !== 'string') return false;
    return ['string', 'number', 'boolean', 'integer', 'array', 'object', 'null'].includes(type);
}

function isJSONSchema7(schema: JSONSchema7Definition): schema is JSONSchema7 {
    return typeof schema !== 'boolean';
}

/**
 * Zod schema for percentage values (0-100)
 */
const percent = z.number().min(0).max(100);

/**
 * Map of JSON Schema formats to their corresponding Zod schema creators
 */
const formatMap: Record<string, (schema: JSONSchema7) => ZodType<unknown>> = {
    'date': () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    'date-time': () => z.string().datetime(),
    'email': () => z.string().email(),
    'hostname': () => z.string(),
    'ipv4': () => z.string().ip({ version: 'v4' }),
    'ipv6': () => z.string().ip({ version: 'v6' }),
    'uri': () => z.string().url(),
    'uuid': () => z.string().uuid(),
    'color': () => z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/),
    'password': () => z.string(),
    'code': () => z.string(),
    'percent': () => percent,
};

/**
 * Map of JSON Schema types to their corresponding Zod schema creators
 */
const typeMap: Record<SchemaType, (schema: JSONSchema7) => ZodType<unknown, ZodTypeDef, unknown>> = {
    'string': (schema) => {
        if (schema.format && formatMap[schema.format]) {
            return formatMap[schema.format](schema);
        }
        return z.string();
    },
    'number': (schema) => {
        if (schema.format === 'percent') {
            return percent;
        }
        return z.number();
    },
    'integer': () => z.number().int(),
    'boolean': () => z.boolean(),
    'null': () => z.null(),
    'array': (schema: JSONSchema7) => {
        if (!schema.items || Array.isArray(schema.items)) {
            throw new Error('Invalid array items');
        }

        if (!isJSONSchema7(schema.items)) {
            throw new Error('Boolean schema is not supported for array items');
        }

        if (schema.items.type === 'object') {
            return z.array(z.object(jsonSchemaToZod(schema.items)));
        }

        const itemType = schema.items.type;
        if (!itemType || !isValidSchemaType(itemType)) {
            throw new Error(`Unsupported array item type: ${itemType}`);
        }

        return z.array(typeMap[itemType](schema.items));
    },
    'object': (schema: JSONSchema7) => {
        if (!schema.properties) {
            throw new Error('Invalid object schema: missing properties');
        }
        return z.object(jsonSchemaToZod(schema));
    }
};

/**
 * Applies validators to a Zod schema based on JSON Schema property constraints
 */
function applyValidators(
    zodType: ZodType<unknown>,
    schema: JSONSchema7,
    required: boolean
): ZodType<unknown> {
    let zodTypeWithValidators = zodType;

    // String validators
    if (schema.type === 'string' && required) {
        zodTypeWithValidators = (zodTypeWithValidators as z.ZodString).min(1);

        if (schema.minLength !== undefined) {
            zodTypeWithValidators = (zodTypeWithValidators as z.ZodString).min(schema.minLength);
        }

        if (schema.maxLength !== undefined) {
            zodTypeWithValidators = (zodTypeWithValidators as z.ZodString).max(schema.maxLength);
        }
    }

    // Array validators
    if (schema.type === 'array') {
        if (schema.minItems !== undefined) {
            zodTypeWithValidators = (zodTypeWithValidators as z.ZodArray<ZodType>).min(schema.minItems);
        }
        if (schema.maxItems !== undefined) {
            zodTypeWithValidators = (zodTypeWithValidators as z.ZodArray<ZodType>).max(schema.maxItems);
        }
    }

    // Number validators
    if (schema.type === 'number' || schema.type === 'integer') {
        if (schema.minimum !== undefined) {
            zodTypeWithValidators = (zodTypeWithValidators as z.ZodNumber).min(schema.minimum);
        }

        if (schema.maximum !== undefined) {
            zodTypeWithValidators = (zodTypeWithValidators as z.ZodNumber).max(schema.maximum);
        }
    }

    // Enum validators
    if (schema.enum) {
        zodTypeWithValidators = zodTypeWithValidators.refine(
            (value): value is typeof schema.enum[number] => schema.enum!.includes(value as string),
            {
                message: `Must be one of: ${schema.enum.join(", ")}`,
            }
        );
    }

    // Pattern validators
    if (schema.pattern) {
        zodTypeWithValidators = (zodTypeWithValidators as z.ZodString).regex(new RegExp(schema.pattern));
    }

    return zodTypeWithValidators;
}

function getTypeFunction(schema: JSONSchema7): ZodType<unknown> {
    if (!schema.type || !isValidSchemaType(schema.type as string)) {
        throw new Error(`Unsupported type: ${schema.type}`);
    }
    return typeMap[schema.type as SchemaType](schema);
}

/**
 * Converts a JSON Schema property to a Zod schema
 */
function convertPropertyToZod(
    schema: JSONSchema7,
    key: string,
    parentSchema: JSONSchema7
): ZodType<unknown> {
    if (schema.$ref) {
        return z.array(
            z.object({
                value: z.object({
                    id: z.string()
                })
            })
        );
    }

    if (schema.type === 'object') {
        return z.object(jsonSchemaToZod(schema));
    }

    const required = Array.isArray(parentSchema.required) && parentSchema.required.includes(key);
    const typeValidator = applyValidators(getTypeFunction(schema), schema, required);
    return required ? typeValidator : typeValidator.optional();
}

/**
 * Converts a JSON Schema to a Zod schema
 */
export function jsonSchemaToZod(
    schema: JSONSchema7 | JSONSchema7Definition[],
): Record<string, ZodType<unknown>> {
    const zodSchema: Record<string, ZodType<unknown>> = {};

    if (Array.isArray(schema)) {
        // Handle array of schemas (merge all schemas)
        for (const item of schema) {
            if (!isJSONSchema7(item)) continue;
            Object.assign(zodSchema, jsonSchemaToZod(item));
        }
    } else if (schema.type === 'object' && schema.properties) {
        // Handle object schema
        for (const [key, prop] of Object.entries(schema.properties)) {
            if (!isJSONSchema7(prop)) continue;
            zodSchema[key] = convertPropertyToZod(prop, key, schema);
        }
    }

    return zodSchema;
}