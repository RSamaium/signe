import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { jsonSchemaToZod } from '../src'
import { z } from 'zod'

describe('jsonSchemaToZod', () => {

    test('Should convert basic types correctly', async () => {
        const schema = {
            type: 'object',
            properties: {
                name: { type: 'string' },
                email: { type: 'string', format: 'email' },
                age: { type: 'integer' },
                isActive: { type: 'boolean' },
                scores: { type: 'array', items: { type: 'number' } },
            },
            required: ['name', 'email']
        }

        const zodSchema = jsonSchemaToZod(schema)

        expect(Object.keys(zodSchema)).toEqual(['name', 'email', 'age', 'isActive', 'scores'])
    })

    test('Should throw an error for unsupported types', async () => {
        const schema = {
            type: 'object',
            properties: {
                unsupportedProp: { type: 'unsupported' }
            }
        }

        expect(() => jsonSchemaToZod(schema)).toThrow('Unsupported type: unsupported')
    })

    test('Should apply validators correctly', async () => {
        const schema = {
            type: 'object',
            properties: {
                name: { type: 'string', minLength: 3, maxLength: 50 },
                age: { type: 'integer', minimum: 18, maximum: 100 },
            },
            required: ['name']
        }

        const zodSchema = z.object(jsonSchemaToZod(schema))

        // Name is required
        let result = zodSchema.safeParse({ age: 30 })
        expect(result.success).toBeFalsy()

        // Name is too short
        result = zodSchema.safeParse({ name: 'Jo', age: 30 })
        expect(result.success).toBeFalsy()

        // Name is too long
        result = zodSchema.safeParse({ name: 'J'.repeat(51), age: 30 })
        expect(result.success).toBeFalsy()

        // Age is too low
        result = zodSchema.safeParse({ name: 'John', age: 17 })
        expect(result.success).toBeFalsy()

        // Age is too high
        result = zodSchema.safeParse({ name: 'John', age: 101 })
        expect(result.success).toBeFalsy()

        // All validations pass
        result = zodSchema.safeParse({ name: 'John', age: 30 })
        expect(result.success).toBeTruthy()
    })

    test('Should handle string type correctly', async () => {
        const schema = {
            type: 'object',
            properties: {
                name: { type: 'string' },
            },
        }

        const zodSchema = z.object(jsonSchemaToZod(schema))

        // Name is not a string
        let result = zodSchema.safeParse({ name: 123 })
        expect(result.success).toBeFalsy()

        // Name is a string
        result = zodSchema.safeParse({ name: 'John' })
        expect(result.success).toBeTruthy()
    })

    test('Should handle special types correctly', async () => {
        const schema = {
            type: 'object',
            properties: {
                colorCode: { type: 'string', format: 'color' },
                secretCode: { type: 'string', format: 'code' },
                userPassword: { type: 'string', format: 'password' },
                percentage: { type: 'number', format: 'percent' },
                createdAt: { type: 'string', format: 'date' },
                description: { type: 'string' }
            }
        }

        const zodSchema = z.object(jsonSchemaToZod(schema))

        // Test color validation
        expect(zodSchema.safeParse({ colorCode: '#123456' }).success).toBeTruthy()
        expect(zodSchema.safeParse({ colorCode: '#abc' }).success).toBeTruthy()
        expect(zodSchema.safeParse({ colorCode: 'invalid' }).success).toBeFalsy()

        // Test percent validation
        expect(zodSchema.safeParse({ percentage: 50 }).success).toBeTruthy()
        expect(zodSchema.safeParse({ percentage: 101 }).success).toBeFalsy()
        expect(zodSchema.safeParse({ percentage: -1 }).success).toBeFalsy()
    })

    test('Should handle nested objects correctly', async () => {
        const schema = {
            type: 'object' as const,
            properties: {
                user: {
                    type: 'object' as const,
                    properties: {
                        profile: {
                            type: 'object' as const,
                            properties: {
                                name: { type: 'string' as const },
                                age: { type: 'integer' as const }
                            },
                            required: ['name']
                        }
                    }
                }
            }
        }

        const zodSchema = z.object(jsonSchemaToZod(schema))

        expect(zodSchema.safeParse({
            user: {
                profile: {
                    name: 'John',
                    age: 30
                }
            }
        }).success).toBeTruthy()

        expect(zodSchema.safeParse({
            user: {
                profile: {
                    age: 30
                }
            }
        }).success).toBeFalsy()
    })

    test('Should handle array of schemas correctly', async () => {
        const schemas = [
            {
                schema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' }
                    }
                }
            },
            {
                schema: {
                    type: 'object',
                    properties: {
                        age: { type: 'integer' }
                    }
                }
            }
        ]

        const zodSchema = z.object(jsonSchemaToZod(schemas))

        expect(zodSchema.safeParse({
            name: 'John',
            age: 30
        }).success).toBeTruthy()
    })

    test('Should handle $ref correctly', async () => {
        const schema = {
            type: 'object',
            properties: {
                categories: {
                    type: 'string',
                    $ref: '#/definitions/CategoryList'
                }
            }
        }

        const zodSchema = z.object(jsonSchemaToZod(schema))

        expect(zodSchema.safeParse({
            categories: '123'
        }).success).toBeTruthy()

        expect(zodSchema.safeParse({
            categories: [
                { value: { wrong: '123' } }
            ]
        }).success).toBeFalsy()
    })

    test('Should handle pattern and enum validations', async () => {
        const schema = {
            type: 'object',
            properties: {
                code: { 
                    type: 'string',
                    pattern: '^[A-Z]{3}[0-9]{3}$'
                },
                status: {
                    type: 'string',
                    enum: ['active', 'inactive', 'pending']
                }
            }
        }

        const zodSchema = z.object(jsonSchemaToZod(schema))

        // Test pattern validation
        expect(zodSchema.safeParse({ code: 'ABC123' }).success).toBeTruthy()
        expect(zodSchema.safeParse({ code: 'invalid' }).success).toBeFalsy()

        // Test enum validation
        expect(zodSchema.safeParse({ status: 'active' }).success).toBeTruthy()
        expect(zodSchema.safeParse({ status: 'invalid' }).success).toBeFalsy()
    })

    test('Should handle array items with complex validation', async () => {
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
        }

        const zodSchema = z.object(jsonSchemaToZod(schema))

        // Valid case
        let result = zodSchema.safeParse({
            users: [
                { name: 'John', age: 30 },
                { name: 'Jane', age: 25 }
            ]
        })
        expect(result.success).toBeTruthy()

        // Too many items
        result = zodSchema.safeParse({
            users: [
                { name: 'John', age: 30 },
                { name: 'Jane', age: 25 },
                { name: 'Bob', age: 35 },
                { name: 'Alice', age: 28 }
            ]
        })
        expect(result.success).toBeFalsy()

        // Missing required field in array item
        result = zodSchema.safeParse({
            users: [
                { age: 30 }
            ]
        })
        expect(result.success).toBeFalsy()

        // Wrong type in array item
        result = zodSchema.safeParse({
            users: [
                { name: 'John', age: 'thirty' }
            ]
        })
        expect(result.success).toBeFalsy()

        // Empty array (violates minItems)
        result = zodSchema.safeParse({
            users: []
        })
        expect(result.success).toBeFalsy()
    })

    test('Should handle object with nested keyboardControls and validate only name', async () => {
        const keyEnum = ['up', 'down', 'left', 'right', 'space', 'backspace', 'enter', 'escape']
        
        const schema = {
            type: 'object' as const,
            properties: {
                name: {
                    type: 'string' as const,
                    title: 'Name',
                    description: 'Name of the project',
                },
                keyboardControls: {
                    type: 'object' as const,
                    title: 'Keyboard Controls',
                    properties: {
                        down: {
                            type: 'string' as const,
                            title: 'Down',
                            enum: keyEnum,
                            default: 'down',
                        },
                        up: {
                            type: 'string' as const,
                            title: 'Up',
                            enum: keyEnum,
                            default: 'up',
                        },
                        left: {
                            type: 'string' as const,
                            title: 'Left',
                            enum: keyEnum,
                            default: 'left',
                        },
                        right: {
                            type: 'string' as const,
                            title: 'Right',
                            enum: keyEnum,
                            default: 'right',
                        },
                        action: {
                            type: 'string' as const,
                            title: 'Action',
                            enum: keyEnum,
                            default: 'space',
                        },
                        back: {
                            type: 'string' as const,
                            title: 'Back',
                            enum: keyEnum,
                            default: 'backspace',
                        },
                    },
                },
            },
        }

        const zodSchema = z.object(jsonSchemaToZod(schema))

        // Test with only name
        let result = zodSchema.safeParse({ name: 'My Project' })

        expect(result.success).toBeTruthy()

        // Test with name and keyboardControls
        result = zodSchema.safeParse({
            name: 'My Project',
            keyboardControls: {
                down: 'down',
                up: 'up',
                left: 'left',
                right: 'right',
                action: 'space',
                back: 'backspace',
            },
        })
        expect(result.success).toBeTruthy()

        // Test with invalid enum value in keyboardControls
        result = zodSchema.safeParse({
            name: 'My Project',
            keyboardControls: {
                down: 'invalid',
            },
        })
        expect(result.success).toBeFalsy()
    })
})