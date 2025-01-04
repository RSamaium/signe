/**
 * @signe/di - A lightweight dependency injection system
 * @module @signe/di
 * 
 * @description
 * This package provides a complete dependency injection system with the following features:
 * - Type-safe dependency injection
 * - Provider system with multiple configuration options
 * - Context-based injection
 * - Override capabilities for testing
 * - Support for nested providers
 * 
 * @example
 * ```typescript
 * import { Context, provide, inject } from '@signe/di';
 * 
 * const context = new Context();
 * provide(context, 'config', { apiUrl: 'http://api.example.com' });
 * const config = inject(context, 'config');
 * ```
 */

export * from "./inject";
export * from "./types";
export * from "./merge-config";
export * from "./provider";
export * from "./context";