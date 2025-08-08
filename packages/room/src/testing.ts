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
    shard?: boolean,
    env?: Record<string, string>,
    parties?: Record<string, (io: any) => any>,
    partyFn?: (io: any) => any
} = {}) {

    const createServer = (io: any) => {
        const server = new Server(io)
        server.rooms = [Room]
        return server
    }

    const isShard = options.shard || false
    const io = new ServerIo(Room.path, isShard ? {
        parties: {
            game: createServer,
            ...(options.parties || {})
        },
        partyFn: options.partyFn,
        env: options.env
    } : {
        parties: options.parties,
        partyFn: options.partyFn,
        env: options.env
    })
    Room.prototype.throttleSync = 0
    Room.prototype.throttleStorage = 0
    Room.prototype.options = options
    
    let server: Server | Shard;
    if (options.shard) {
        const shardServer = new Shard(io as any);
        // Add subRoom property to Shard for compatibility with Server
        (shardServer as any).subRoom = null;
        server = shardServer;
        // In shard mode, parties.main is a Map of lobbies; ensure their servers are started
        if (io.context.parties.main instanceof Map) {
            for (const lobby of io.context.parties.main.values()) {
                await lobby.server.onStart();
            }
        }
    } else {
        server = await createServer(io as any);
        // If extra parties are provided in non-shard mode, start them too
        if (io.context.parties.main instanceof Map) {
            for (const lobby of io.context.parties.main.values()) {
                if (lobby.server && lobby.server !== server) {
                    await lobby.server.onStart();
                }
            }
        }
    }
    
    await server.onStart()
    
    return {
        server,
        room: (server as any).subRoom,
        createClient: async (id?: string, opts?: { query?: Record<string, string>, headers?: Record<string, string> }) => {
            const client = await io.connection(server as Server, id, opts)
            return client
        }
    }
}

export async function request(room: Server | Shard, path: string, options: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    body?: any,
    headers?: Record<string, string>
} = {
    method: 'GET',
}) {
    const url = new URL('http://localhost' + path)
    const request = new Request(url.toString(), options)
    const response = await room.onRequest(request as any)
    return response
}