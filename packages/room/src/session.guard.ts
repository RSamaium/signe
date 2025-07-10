import type * as Party from "./types/party";

/**
 * @description Factory function that creates a session guard with access to room storage
 * @param {Party.Storage} storage - The room storage instance
 * @returns {Function} - The guard function
 * 
 * @example
 * ```typescript
 * import { createRequireSessionGuard } from "./session.guard";
 * 
 * export class GameRoom {
 *   constructor(private room: Party.Room) {}
 *   
 *   @Action("sendMessage")
 *   @Guard([createRequireSessionGuard(this.room.storage)])
 *   async sendMessage(user: User, message: string, conn: Party.Connection) {
 *     // This action will only execute if the user has a valid session
 *     this.$broadcast({ type: "message", user, message });
 *   }
 * }
 * ```
 */
export function createRequireSessionGuard(storage: Party.Storage) {
    return async (sender: Party.Connection, value: any): Promise<boolean> => {
        if (!sender || !sender.id) {
            return false;
        }

        try {
            // Check if session exists in storage
            const session = await storage.get(`session:${sender.id}`);
            
            // Return false if no session found
            if (!session) {
                return false;
            }

            // Verify session has required properties
            const typedSession = session as { publicId: string, created?: number, connected?: boolean };
            if (!typedSession.publicId) {
                return false;
            }

            // Session exists and is valid
            return true;
        } catch (error) {
            // If there's an error accessing storage, deny access
            console.error('Error checking session in requireSession guard:', error);
            return false;
        }
    };
}

/**
 * @description Guard function that verifies if a user session exists (for room and request guards)
 * @param {Party.Connection} sender - The connection object of the sender
 * @param {any} value - The value/payload sent with the action or request
 * @param {Party.Room} room - The room instance
 * @returns {Promise<boolean>} - Returns true if session exists, false otherwise
 * 
 * @example
 * ```typescript
 * import { requireSession } from "./session.guard";
 * 
 * // For room guards
 * @Room({
 *   path: "game-{id}",
 *   guards: [requireSession]
 * })
 * export class GameRoom {
 *   // Room implementation
 * }
 * 
 * // For request guards
 * @Request({ path: '/api/data', method: 'GET' })
 * @Guard([requireSession])
 * async getData(req: Party.Request, res: ServerResponse) {
 *   // This request will only execute if the user has a valid session
 *   return res.success({ data: "protected data" });
 * }
 * ```
 */
export const requireSession = async (sender: Party.Connection, value: any, room: Party.Room): Promise<boolean> => {
    if (!sender || !sender.id) {
        return false;
    }

    try {
        // Check if session exists in storage
        const session = await room.storage.get(`session:${sender.id}`);
        
        // Return false if no session found
        if (!session) {
            return false;
        }

        // Verify session has required properties
        const typedSession = session as { publicId: string, created?: number, connected?: boolean };
        if (!typedSession.publicId) {
            return false;
        }

        // Session exists and is valid
        return true;
    } catch (error) {
        // If there's an error accessing storage, deny access
        console.error('Error checking session in requireSession guard:', error);
        return false;
    }
};
