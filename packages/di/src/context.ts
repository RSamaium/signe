/**
 * Context class for managing dependency injection state
 * @module @signe/di/context
 */

/**
 * Stores and manages the state of injected dependencies
 * @template TState - Type for the state
 * @template TActions - Type for the actions
 * @template TValues - Type for additional values
 */
export class Context<
    TState = any,
    TActions = any,
    TValues extends Record<string, any> = Record<string, any>
> {
    /** Internal storage for injected values */
    private values: TValues = {} as TValues

    /**
     * Sets a value in the context
     * @param key - Unique identifier for the value
     * @param value - Value to store
     */
    set<K extends keyof TValues>(key: K, value: TValues[K]) {
        this.values[key] = value
    }

    /**
     * Retrieves a value from the context
     * @param key - Unique identifier for the value
     * @returns The stored value or undefined if not found
     */
    get<K extends keyof TValues>(key: K): TValues[K] {
        return this.values[key]
    }
}