import { z, type RefinementCtx, type ZodRawShape, type ZodType } from "zod";
import type { JSONSchema7, JSONSchema7Definition, JSONSchema7TypeName } from "json-schema";

/**
 * Standard JSON Schema types only
 */
type SchemaType = Exclude<JSONSchema7TypeName, "array" | "object"> | "array" | "object";
type ExtendedJSONSchema7 = JSONSchema7 & {
    dependentRequired?: Record<string, string[]>;
    dependentSchemas?: Record<string, JSONSchema7Definition>;
};

function isValidSchemaType(type: unknown): type is SchemaType {
    if (typeof type !== "string") return false;
    return ["string", "number", "boolean", "integer", "array", "object", "null"].includes(type);
}

function isJSONSchema7(schema: JSONSchema7Definition): schema is JSONSchema7 {
    return typeof schema !== "boolean";
}

function asExtendedJSONSchema7(schema: JSONSchema7): ExtendedJSONSchema7 {
    return schema as ExtendedJSONSchema7;
}

function unwrapSchemaDefinition(schema: unknown): JSONSchema7Definition | null {
    if (typeof schema === "boolean") {
        return schema;
    }

    if (!schema || typeof schema !== "object") {
        return null;
    }

    if ("schema" in schema) {
        return unwrapSchemaDefinition((schema as { schema?: unknown }).schema);
    }

    return schema as JSONSchema7Definition;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function areValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }

    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) {
            return false;
        }

        return left.every((item, index) => areValuesEqual(item, right[index]));
    }

    if (isPlainObject(left) && isPlainObject(right)) {
        const leftKeys = Object.keys(left);
        const rightKeys = Object.keys(right);

        if (leftKeys.length !== rightKeys.length) {
            return false;
        }

        return leftKeys.every((key) => areValuesEqual(left[key], right[key]));
    }

    return false;
}

/**
 * Zod schema for percentage values (0-100)
 */
const percent = z.number().min(0).max(100);

/**
 * Map of JSON Schema formats to their corresponding Zod schema creators
 */
const formatMap: Record<string, (schema: JSONSchema7) => ZodType<unknown>> = {
    "date": () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    "date-time": () => z.string().datetime(),
    "email": () => z.string().email(),
    "hostname": () => z.string(),
    "ipv4": () => z.string().ip({ version: "v4" }),
    "ipv6": () => z.string().ip({ version: "v6" }),
    "uri": () => z.string().url(),
    "uuid": () => z.string().uuid(),
    "color": () => z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/),
    "password": () => z.string(),
    "code": () => z.string(),
    "percent": () => percent,
};

function createRequiredUnknownSchema(): ZodType<unknown> {
    return z.custom<unknown>((value) => value !== undefined);
}

function inferSchemaType(schema: JSONSchema7): SchemaType | null {
    if (schema.type !== undefined && !isValidSchemaType(schema.type)) {
        throw new Error(`Unsupported type: ${schema.type}`);
    }

    if (schema.type && isValidSchemaType(schema.type)) {
        return schema.type;
    }

    if (schema.properties || schema.required || schema.if || schema.then || schema.else || schema.allOf) {
        return "object";
    }

    if (schema.items) {
        return "array";
    }

    if (
        schema.pattern ||
        schema.minLength !== undefined ||
        schema.maxLength !== undefined ||
        (schema.format && schema.format !== "percent")
    ) {
        return "string";
    }

    if (
        schema.minimum !== undefined ||
        schema.maximum !== undefined ||
        schema.format === "percent"
    ) {
        return "number";
    }

    return null;
}

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
    if (schema.type === "string" && required) {
        zodTypeWithValidators = (zodTypeWithValidators as z.ZodString).min(1);

        if (schema.minLength !== undefined) {
            zodTypeWithValidators = (zodTypeWithValidators as z.ZodString).min(schema.minLength);
        }

        if (schema.maxLength !== undefined) {
            zodTypeWithValidators = (zodTypeWithValidators as z.ZodString).max(schema.maxLength);
        }
    }

    // Array validators
    if (schema.type === "array") {
        if (schema.minItems !== undefined) {
            zodTypeWithValidators = (zodTypeWithValidators as z.ZodArray<ZodType>).min(schema.minItems);
        }
        if (schema.maxItems !== undefined) {
            zodTypeWithValidators = (zodTypeWithValidators as z.ZodArray<ZodType>).max(schema.maxItems);
        }
    }

    // Number validators
    if (schema.type === "number" || schema.type === "integer") {
        if (schema.minimum !== undefined) {
            zodTypeWithValidators = (zodTypeWithValidators as z.ZodNumber).min(schema.minimum);
        }

        if (schema.maximum !== undefined) {
            zodTypeWithValidators = (zodTypeWithValidators as z.ZodNumber).max(schema.maximum);
        }
    }

    // Pattern validators
    if (schema.pattern) {
        zodTypeWithValidators = (zodTypeWithValidators as z.ZodString).regex(new RegExp(schema.pattern));
    }

    // Const validator
    if (schema.const !== undefined) {
        zodTypeWithValidators = zodTypeWithValidators.refine(
            (value) => areValuesEqual(value, schema.const),
            {
                message: `Must be equal to: ${JSON.stringify(schema.const)}`,
            }
        );
    }

    // Enum validators
    if (schema.enum) {
        zodTypeWithValidators = zodTypeWithValidators.refine(
            (value): value is typeof schema.enum[number] =>
                schema.enum!.some((enumValue) => areValuesEqual(value, enumValue)),
            {
                message: `Must be one of: ${schema.enum.map((value) => JSON.stringify(value)).join(", ")}`,
            }
        );
    }

    return zodTypeWithValidators;
}

function applyLogicalCompositionValidators(
    zodType: ZodType<unknown>,
    schema: JSONSchema7
): ZodType<unknown> {
    let composedType = zodType;

    if (schema.anyOf && schema.anyOf.length > 0) {
        composedType = composedType.superRefine((value, context) => {
            const matchesAnySchema = schema.anyOf!.some((subSchema) => matchesSchemaDefinition(subSchema, value));

            if (!matchesAnySchema) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Must match at least one schema in anyOf",
                });
            }
        });
    }

    if (schema.not !== undefined) {
        composedType = composedType.superRefine((value, context) => {
            if (matchesSchemaDefinition(schema.not!, value)) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Must not match schema in not",
                });
            }
        });
    }

    return composedType;
}

function matchesSchemaDefinition(schema: JSONSchema7Definition, value: unknown): boolean {
    if (!isJSONSchema7(schema)) {
        return schema;
    }

    return jsonSchemaDefinitionToZod(schema).safeParse(value).success;
}

function addSchemaIssues(
    schema: JSONSchema7Definition,
    value: unknown,
    context: RefinementCtx
): void {
    if (!isJSONSchema7(schema)) {
        if (!schema) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Schema condition rejected the current value",
            });
        }
        return;
    }

    const result = jsonSchemaDefinitionToZod(schema).safeParse(value);

    if (result.success) {
        return;
    }

    for (const issue of result.error.issues) {
        context.addIssue(issue);
    }
}

function collectComposablePropertyKeys(schema: JSONSchema7): Set<string> {
    const extendedSchema = asExtendedJSONSchema7(schema);
    const keys = new Set<string>();

    const visit = (definition?: JSONSchema7Definition): void => {
        if (!definition || !isJSONSchema7(definition)) {
            return;
        }

        const extendedDefinition = asExtendedJSONSchema7(definition);

        if (extendedDefinition.properties) {
            for (const key of Object.keys(extendedDefinition.properties)) {
                keys.add(key);
            }
        }

        if (extendedDefinition.required) {
            for (const key of extendedDefinition.required) {
                keys.add(key);
            }
        }

        if (extendedDefinition.dependentRequired) {
            for (const [key, requiredKeys] of Object.entries(extendedDefinition.dependentRequired)) {
                keys.add(key);

                for (const requiredKey of requiredKeys) {
                    keys.add(requiredKey);
                }
            }
        }

        if (extendedDefinition.dependentSchemas) {
            for (const [key, dependentSchema] of Object.entries(extendedDefinition.dependentSchemas)) {
                keys.add(key);
                visit(dependentSchema);
            }
        }

        if (extendedDefinition.anyOf) {
            for (const item of extendedDefinition.anyOf) {
                visit(item);
            }
        }

        if (extendedDefinition.allOf) {
            for (const item of extendedDefinition.allOf) {
                visit(item);
            }
        }

        visit(extendedDefinition.not);
        visit(extendedDefinition.if);
        visit(extendedDefinition.then);
        visit(extendedDefinition.else);
    };

    visit(extendedSchema);

    return keys;
}

function hasComposableValidation(schema: JSONSchema7): boolean {
    const extendedSchema = asExtendedJSONSchema7(schema);
    return Boolean(
        extendedSchema.dependentRequired ||
        extendedSchema.dependentSchemas ||
        extendedSchema.if ||
        extendedSchema.then ||
        extendedSchema.else ||
        (Array.isArray(extendedSchema.allOf) && extendedSchema.allOf.length > 0)
    );
}

function createPrimitiveType(schema: JSONSchema7, type: Exclude<SchemaType, "array" | "object">): ZodType<unknown> {
    switch (type) {
        case "string":
            if (schema.format && formatMap[schema.format]) {
                return formatMap[schema.format](schema);
            }
            return z.string();
        case "number":
            if (schema.format === "percent") {
                return percent;
            }
            return z.number();
        case "integer":
            return z.number().int();
        case "boolean":
            return z.boolean();
        case "null":
            return z.null();
    }
}

function buildObjectSchema(schema: JSONSchema7): ZodType<unknown> {
    const extendedSchema = asExtendedJSONSchema7(schema);
    const shape: ZodRawShape = {};

    if (extendedSchema.properties) {
        for (const [key, propertySchema] of Object.entries(extendedSchema.properties)) {
            if (!isJSONSchema7(propertySchema)) {
                continue;
            }

            shape[key] = convertPropertyToZod(propertySchema, key, extendedSchema);
        }
    }

    if (extendedSchema.required) {
        for (const key of extendedSchema.required) {
            if (!shape[key]) {
                shape[key] = createRequiredUnknownSchema();
            }
        }
    }

    for (const key of collectComposablePropertyKeys(extendedSchema)) {
        if (!shape[key]) {
            shape[key] = z.unknown().optional();
        }
    }

    const baseObject = z.object(shape);

    if (!hasComposableValidation(extendedSchema)) {
        return baseObject;
    }

    return baseObject.superRefine((value, context) => {
        if (extendedSchema.dependentRequired) {
            for (const [triggerKey, requiredKeys] of Object.entries(extendedSchema.dependentRequired)) {
                if (!Object.prototype.hasOwnProperty.call(value, triggerKey)) {
                    continue;
                }

                for (const requiredKey of requiredKeys) {
                    if (!Object.prototype.hasOwnProperty.call(value, requiredKey)) {
                        context.addIssue({
                            code: z.ZodIssueCode.custom,
                            message: `Property "${requiredKey}" is required when "${triggerKey}" is present`,
                            path: [requiredKey],
                        });
                    }
                }
            }
        }

        if (extendedSchema.dependentSchemas) {
            for (const [triggerKey, dependentSchema] of Object.entries(extendedSchema.dependentSchemas)) {
                if (!Object.prototype.hasOwnProperty.call(value, triggerKey)) {
                    continue;
                }

                addSchemaIssues(dependentSchema, value, context);
            }
        }

        if (extendedSchema.if) {
            const matches = matchesSchemaDefinition(extendedSchema.if, value);

            if (matches && extendedSchema.then) {
                addSchemaIssues(extendedSchema.then, value, context);
            }

            if (!matches && extendedSchema.else) {
                addSchemaIssues(extendedSchema.else, value, context);
            }
        }

        if (extendedSchema.allOf) {
            for (const item of extendedSchema.allOf) {
                addSchemaIssues(item, value, context);
            }
        }
    });
}

function buildArraySchema(schema: JSONSchema7): ZodType<unknown> {
    if (!schema.items || Array.isArray(schema.items)) {
        throw new Error("Invalid array items");
    }

    return applyValidators(z.array(jsonSchemaDefinitionToZod(schema.items, true)), schema, true);
}

function jsonSchemaDefinitionToZod(schema: JSONSchema7Definition, required = true): ZodType<unknown> {
    if (!isJSONSchema7(schema)) {
        return schema ? z.any() : z.never();
    }

    const inferredType = inferSchemaType(schema);
    let zodType: ZodType<unknown>;

    if (inferredType === "object") {
        zodType = buildObjectSchema(schema);
        return applyLogicalCompositionValidators(zodType, schema);
    }

    if (inferredType === "array") {
        zodType = buildArraySchema(schema);
        return applyLogicalCompositionValidators(zodType, schema);
    }

    if (inferredType) {
        zodType = applyValidators(
            createPrimitiveType(schema, inferredType as Exclude<SchemaType, "array" | "object">),
            schema,
            required
        );
        return applyLogicalCompositionValidators(zodType, schema);
    }

    zodType = applyValidators(z.any(), schema, required);
    return applyLogicalCompositionValidators(zodType, schema);
}

/**
 * Converts a JSON Schema property to a Zod schema
 */
function convertPropertyToZod(
    schema: JSONSchema7,
    key: string,
    parentSchema: JSONSchema7
): ZodType<unknown> {
    const required = Array.isArray(parentSchema.required) && parentSchema.required.includes(key);
    const propertySchema = jsonSchemaDefinitionToZod(schema, required);

    return required ? propertySchema : propertySchema.optional();
}

/**
 * Converts a JSON Schema to a full Zod schema.
 * This export should be preferred when the schema uses allOf or if/then/else.
 */
export function jsonSchemaToZodSchema(
    schema: JSONSchema7 | JSONSchema7Definition[],
): ZodType<unknown> {
    if (Array.isArray(schema)) {
        const definitions = schema
            .map(unwrapSchemaDefinition)
            .filter((definition): definition is JSONSchema7Definition => definition !== null);

        return jsonSchemaDefinitionToZod({
            type: "object",
            allOf: definitions,
        });
    }

    return jsonSchemaDefinitionToZod(schema);
}

/**
 * Converts a JSON Schema to a Zod shape.
 * This is kept for compatibility with the previous API.
 */
export function jsonSchemaToZod(
    schema: JSONSchema7 | JSONSchema7Definition[],
): Record<string, ZodType<unknown>> {
    const zodSchema: Record<string, ZodType<unknown>> = {};

    if (Array.isArray(schema)) {
        for (const item of schema) {
            const definition = unwrapSchemaDefinition(item);

            if (!definition || !isJSONSchema7(definition)) {
                continue;
            }

            Object.assign(zodSchema, jsonSchemaToZod(definition));
        }
    } else if (schema.type === "object" && schema.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
            if (!isJSONSchema7(prop)) continue;
            zodSchema[key] = convertPropertyToZod(prop, key, schema);
        }
    }

    return zodSchema;
}
