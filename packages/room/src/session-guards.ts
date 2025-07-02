import type * as Party from "./types/party";
import { SessionTransferService } from "./session-transfer";

export interface SessionGuardOptions {
  /**
   * Whether to allow connections with transfer tokens
   * @default true
   */
  allowTransfers?: boolean;
  
  /**
   * Custom validation function for session data
   */
  validateSession?: (sessionData: any) => boolean | Promise<boolean>;
  
  /**
   * Whether to automatically create a session if none exists
   * @default false
   */
  autoCreateSession?: boolean;
}

/**
 * Guard that requires a valid session to connect to the room
 * @param options Configuration options for the session guard
 * @returns Guard function
 */
export function requireSession(options: SessionGuardOptions = {}) {
  return async (
    conn: Party.Connection, 
    ctx: Party.ConnectionContext,
    room: Party.Room
  ): Promise<boolean> => {
    const {
      allowTransfers = true,
      validateSession,
      autoCreateSession = false
    } = options;

    // Ensure room and room.storage exist before creating service
    if (!room || !room.storage) {
      // If no room or storage available, allow auto-creation if enabled, deny otherwise
      return autoCreateSession;
    }

    const sessionService = new SessionTransferService(room.storage, room.id);
    
    // Check for existing session
    const existingSession = await sessionService.getSessionForValidation(conn.id);
    
    if (existingSession) {
      // Validate session if custom validator is provided
      if (validateSession) {
        const isValid = await validateSession(existingSession);
        if (!isValid) {
          return false;
        }
      }
      return true;
    }

    // If no existing session, check for transfer token
    if (allowTransfers && ctx.request?.url) {
      try {
        const url = new URL(ctx.request.url);
        const transferToken = url.searchParams.get('transfer_token');
        
        if (transferToken) {
          const transferResult = await sessionService.validateTransferToken(
            transferToken, 
            room.id
          );
          
          if (transferResult) {
            // Complete the transfer
            await sessionService.completeSessionTransfer(
              transferResult.privateId, 
              transferResult.sessionData
            );
            
            // Validate transferred session if custom validator is provided
            if (validateSession) {
              const isValid = await validateSession(transferResult.sessionData);
              if (!isValid) {
                return false;
              }
            }
            
            return true;
          }
        }
      } catch (error) {
        // Invalid URL format, continue without transfer token
        console.warn('Invalid URL format in session guard:', error);
      }
    }

    // If auto-create is enabled, create a new session
    if (autoCreateSession) {
      return true; // Let the regular session creation flow handle this
    }

    // No valid session found and no auto-creation
    return false;
  };
}

/**
 * Guard that requires a session with specific properties
 * @param requiredProperties Properties that must exist in the session
 * @returns Guard function
 */
export function requireSessionWithProperties(requiredProperties: string[]) {
  return requireSession({
    validateSession: (sessionData) => {
      if (!sessionData.state) return false;
      
      return requiredProperties.every(prop => 
        sessionData.state.hasOwnProperty(prop)
      );
    }
  });
}

/**
 * Guard that requires a session from a specific source room
 * @param allowedSourceRooms Array of room patterns that sessions can be transferred from
 *                          Supports: exact strings, RegExp objects, and "*" for all rooms
 * @returns Guard function
 * 
 * @example
 * ```typescript
 * // Exact room names
 * requireSessionFromRoom(["lobby", "tutorial"])
 * 
 * // With regex patterns
 * requireSessionFromRoom([/^game-\d+$/, "lobby"])
 * 
 * // Accept any room
 * requireSessionFromRoom(["*"])
 * 
 * // Mixed patterns
 * requireSessionFromRoom(["lobby", /^tutorial-/, "*-special"])
 * ```
 */
export function requireSessionFromRoom(allowedSourceRooms: (string | RegExp)[]) {
  return requireSession({
    validateSession: (sessionData) => {
      if (!sessionData.lastRoomId) return false;
      
      const lastRoomId = sessionData.lastRoomId;
      
      // Check each allowed pattern
      for (const pattern of allowedSourceRooms) {
        // Wildcard - accept all rooms
        if (pattern === "*") {
          return true;
        }
        
        // RegExp pattern
        if (pattern instanceof RegExp) {
          if (pattern.test(lastRoomId)) {
            return true;
          }
        }
        
        // String pattern (exact match or wildcard)
        if (typeof pattern === "string") {
          // Check for simple wildcards in string
          if (pattern.includes("*")) {
            const regexPattern = pattern
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
              .replace(/\\\*/g, '.*'); // Convert * to .*
            const regex = new RegExp(`^${regexPattern}$`);
            if (regex.test(lastRoomId)) {
              return true;
            }
          } else {
            // Exact string match
            if (pattern === lastRoomId) {
              return true;
            }
          }
        }
      }
      
      return false;
    }
  });
}

/**
 * Guard that requires a fresh session (not transferred)
 * @returns Guard function
 */
export function requireFreshSession() {
  return requireSession({
    allowTransfers: false,
    autoCreateSession: true
  });
}

/**
 * Composite guard that combines multiple session requirements
 * @param guards Array of guard functions to combine
 * @returns Guard function that requires ALL guards to pass
 */
export function combineSessionGuards(guards: Array<(conn: Party.Connection, ctx: Party.ConnectionContext, room: Party.Room) => boolean | Promise<boolean>>) {
  return async (
    conn: Party.Connection, 
    ctx: Party.ConnectionContext,
    room: Party.Room
  ): Promise<boolean> => {
    for (const guard of guards) {
      const result = await guard(conn, ctx, room);
      if (!result) {
        return false;
      }
    }
    return true;
  };
}