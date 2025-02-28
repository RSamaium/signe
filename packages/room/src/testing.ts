import { ServerIo } from "./mock"
import { Server } from "./server"
import { Shard } from "./shard"

/**
 * @description Test the room with a mock server and client
 * @param Room - The room class to test
 * @param options - The options for the room
 * @param options.hibernate - Whether to hibernate the server. If hybernate, room is null
 * @example
 * ```ts
 * const { createClient, room, server } = await testRoom(GameRoom)
 * const client1 = await createClient()
 * const client2 = await createClient()
 * 
 * client1.addEventListener('message', (data) => {
 *     console.log(data)
 * })
 * client2.addEventListener('message', (data) => {
 *     console.log(data)
 * })
 * 
 * await client1.send({
 *     action: 'increment'
 * })
 * 
 * ```
 * @returns The server, room, and createClient function
 */
export async function testRoom(Room, options: {
    hibernate?: boolean,
    shard?: boolean
} = {}) {

    const createServer = (io: any) => {
        const server = new Server(io)
        server.rooms = [Room]
        return server
    }

    const isShard = options.shard || false
    const io = new ServerIo(Room.path, isShard ? {
        parties: {
            game: createServer
        }
    } : {})
    Room.prototype.throttleSync = 0
    Room.prototype.throttleStorage = 0
    Room.prototype.options = options
    
    let server: Server | Shard;
    if (options.shard) {
        const shardServer = new Shard(io as any);
        // Add subRoom property to Shard for compatibility with Server
        (shardServer as any).subRoom = null;
        server = shardServer;
    } else {
        server = await createServer(io as any);
    }
    
    await server.onStart()
    
    return {
        server,
        room: (server as any).subRoom,
        createClient: async () => {
            const client = await io.connection(server as Server)
            return client
        }
    }
}
