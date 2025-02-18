import { ServerIo } from "./mock"
import { Server } from "./server"

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
    hibernate?: boolean
} = {}) {
    const io = new ServerIo(Room.path)
    Room.prototype.throttleSync = 0
    Room.prototype.throttleStorage = 0
    Room.prototype.options = options
    const server = new Server(io as any)
    server.rooms = [Room]
    await server.onStart()
    return {
        server,
        room: server.subRoom,
        createClient: async () => {
            const client = await io.connection(server)
            return client
        }
    }
}
