/**
 * Context class for managing dependency injection state
 * @module @signe/di/context
 */

/**
 * Stores and manages the state of injected dependencies
 */
export class Context {
    /** Internal storage for injected values */
    private values: { [key: string]: any } = {}

    /**
     * Sets a value in the context
     * @param key - Unique identifier for the value
     * @param value - Value to store
     */
    set(key: string, value: any) {
        this.values[key] = value
    }

    /**
     * Retrieves a value from the context
     * @param key - Unique identifier for the value
     * @returns The stored value or undefined if not found
     */
    get(key: string) {
        return this.values[key]
    }
}