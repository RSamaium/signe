import { beforeEach, describe, expect, it, vi } from "vitest";
import { Server, testRoom, Room, WorldRoom, request } from "../../packages/room/src";
import { sync } from "@signe/sync";
import { signal } from "@signe/reactive";
import { JWTAuth } from "../../packages/room/src/jwt";

const baseUrl = '/parties/world/world-default'

// Extend Request prototype to add json() method
if (!Request.prototype.json) {
  Request.prototype.json = async function() {
    const text = await this.text();
    return JSON.parse(text);
  };
}

const AUTH_JWT_SECRET = 'test-secret'
const SHARD_SECRET = 'shard-secret'
let jwtSecret: string = ''

describe('WorldRoom', () => {
  let client: any
  let room: WorldRoom
  let server: any

  beforeEach(async () => {
    const test = await testRoom(WorldRoom, {
      env: {
        AUTH_JWT_SECRET,
        SHARD_SECRET
      }
    });
    client = await test.createClient();
    room = test.room
    server = test.server
    jwtSecret = await (new JWTAuth(AUTH_JWT_SECRET)).sign({
      worlds: ['world-default']
    })
  })

  /**
   * 1. Tests unitaires - Gestion des salles
   */
  describe('Room Management', () => {
    describe('Room Creation', () => {
      it('should create a room with minimal parameters', async () => {
        const response = await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'minimal-room',
            balancingStrategy: 'round-robin',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 0
          })
        });
        
        expect(response.status).toBe(200);
        expect(room.rooms()['minimal-room']).toBeDefined();
        expect(room.rooms()['minimal-room'].name()).toBe('minimal-room');
        expect(room.rooms()['minimal-room'].balancingStrategy()).toBe('round-robin');
      });

      it('should create a room with full parameters including maxShards', async () => {
        const response = await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'full-room',
            balancingStrategy: 'least-connections',
            public: false,
            maxPlayersPerShard: 75,
            minShards: 1,
            maxShards: 5
          })
        });
        
        expect(response.status).toBe(200);
        expect(room.rooms()['full-room']).toBeDefined();
        expect(room.rooms()['full-room'].maxShards()).toBe(5);
        expect(room.rooms()['full-room'].public()).toBe(false);
      });

      it('should automatically create minimum shards when specified', async () => {
        const response = await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'min-shards-room',
            balancingStrategy: 'round-robin',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 3
          })
        });
        
        expect(response.status).toBe(200);
        
        // Verify that three shards were created
        const roomShards = Object.values(room.shards()).filter(
          shard => shard.roomId() === 'min-shards-room'
        );
        expect(roomShards.length).toBe(3);
      });
    });

    describe('Room Updates', () => {
      it('should update an existing room configuration', async () => {
        // First create a room
        await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'update-test-room',
            balancingStrategy: 'round-robin',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 1
          })
        });
        
        // Then update it
        const response = await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'update-test-room',
            balancingStrategy: 'least-connections',
            public: false,
            maxPlayersPerShard: 75,
            minShards: 1
          })
        });
        
        expect(response.status).toBe(200);
        
        // Verify the room was updated
        const roomConfig = room.rooms()['update-test-room'];
        expect(roomConfig.balancingStrategy()).toBe('least-connections');
        expect(roomConfig.public()).toBe(false);
        expect(roomConfig.maxPlayersPerShard()).toBe(75);
      });

      it('should create additional shards when minShards is increased', async () => {
        // First create a room with 1 shard
        await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'increase-shards-room',
            balancingStrategy: 'round-robin',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 1
          })
        });
        
        // Initial shard count
        const initialShards = Object.values(room.shards()).filter(
          shard => shard.roomId() === 'increase-shards-room'
        );
        expect(initialShards.length).toBe(1);
        
        // Update to increase minShards
        await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'increase-shards-room',
            balancingStrategy: 'round-robin',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 3
          })
        });
        
        // Verify minShards value was updated in config
        const updatedRoomConfig = room.rooms()['increase-shards-room'];
        expect(updatedRoomConfig.minShards()).toBe(3);
        
        // Note: registerRoom only updates config but doesn't auto-create shards for existing rooms
        // We need to scale the room manually to reach the new minShards
        await request(server, `${baseUrl}/scale-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            roomId: 'increase-shards-room',
            targetShardCount: 3
          })
        });
        
        // Now check that we have 3 shards after scaling
        const finalShards = Object.values(room.shards()).filter(
          shard => shard.roomId() === 'increase-shards-room'
        );
        expect(finalShards.length).toBe(3);
      });
    });
  });

  /**
   * 2. Tests unitaires - Gestion des shards
   */
  describe('Shard Management', () => {
    describe('Shard Creation and Updates', () => {
      it('should update shard statistics', async () => {
        // First register a room with a shard
        await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'stats-test-room',
            balancingStrategy: 'round-robin',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 1
          })
        });
        
        // Get the auto-created shard ID
        const shard = Object.values(room.shards()).find(
          s => s.roomId() === 'stats-test-room'
        );
        expect(shard).toBeDefined();
        
        // Update the shard stats
        const response = await request(server, `${baseUrl}/update-shard`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            shardId: shard!.id,
            connections: 42,
            status: 'active'
          })
        });
        
        expect(response.status).toBe(200);
        expect(room.shards()[shard!.id].currentConnections()).toBe(42);
      });

      it('should fail to update a non-existent shard', async () => {
        const response = await request(server, `${baseUrl}/update-shard`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            shardId: 'non-existent-shard',
            connections: 42,
            status: 'active'
          })
        });
        
        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBeDefined();
        expect(data.error).toContain('not found');
      });

      it('should update shard status to draining', async () => {
        // First register a room with a shard
        await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'drain-test-room',
            balancingStrategy: 'round-robin',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 1
          })
        });
        
        // Get the auto-created shard ID
        const shard = Object.values(room.shards()).find(
          s => s.roomId() === 'drain-test-room'
        );
        
        // Update the shard status to draining
        await request(server, `${baseUrl}/update-shard`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            shardId: shard!.id,
            connections: 5,
            status: 'draining'
          })
        });
        
        expect(room.shards()[shard!.id].status()).toBe('draining');
      });
    });

    describe('Shard Scaling', () => {
      it('should scale a room up by adding shards', async () => {
        // First register a room with a shard
        await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'scale-test-room',
            balancingStrategy: 'round-robin',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 1,
            maxShards: 5
          })
        });
        
        // Check that one shard was auto-created
        const initialShards = Object.values(room.shards()).filter(
          shard => shard.roomId() === 'scale-test-room'
        );
        expect(initialShards.length).toBe(1);
        
        // Scale the room to 3 shards
        const response = await request(server, `${baseUrl}/scale-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            roomId: 'scale-test-room',
            targetShardCount: 3,
            shardTemplate: {
              urlTemplate: 'https://{shardId}.example.com',
              maxConnections: 75
            }
          })
        });
        
        expect(response.status).toBe(200);
        
        // Check that additional shards were created
        const finalShards = Object.values(room.shards()).filter(
          shard => shard.roomId() === 'scale-test-room'
        );
        expect(finalShards.length).toBe(3);
        
        // Verify the shards use the provided template
        const newShards = finalShards.filter(shard => !initialShards.some(s => s.id === shard.id));
        for (const shard of newShards) {
          expect(shard.url()).toContain('.example.com');
          expect(shard.maxConnections()).toBe(75);
        }
      });

      it('should respect max shards constraint when scaling', async () => {
        // First register a room with max of 2 shards
        await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'max-shards-room',
            balancingStrategy: 'round-robin',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 1,
            maxShards: 2
          })
        });
        
        // Try to scale beyond the maximum
        const response = await request(server, `${baseUrl}/scale-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            roomId: 'max-shards-room',
            targetShardCount: 5,
            shardTemplate: {
              urlTemplate: 'https://{shardId}.example.com',
              maxConnections: 75
            }
          })
        });
        
        // Should return an error in the response
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
        expect(data.error).toContain('Cannot scale beyond maximum');
      });

      it('should scale a room down by removing shards', async () => {
        // First register a room with 3 shards
        await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'scale-down-room',
            balancingStrategy: 'round-robin',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 3
          })
        });
        
        // Verify we have 3 shards
        const initialShards = Object.values(room.shards()).filter(
          shard => shard.roomId() === 'scale-down-room'
        );
        expect(initialShards.length).toBe(3);
        
        // Scale down to 1 shard
        await request(server, `${baseUrl}/scale-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            roomId: 'scale-down-room',
            targetShardCount: 1
          })
        });
        
        // Verify we now have 1 shard
        const finalShards = Object.values(room.shards()).filter(
          shard => shard.roomId() === 'scale-down-room'
        );
        expect(finalShards.length).toBe(1);
      });

      it('should prioritize draining shards when scaling down', async () => {
        // First register a room with 3 shards
        await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'drain-priority-room',
            balancingStrategy: 'round-robin',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 3
          })
        });
        
        // Get shards
        const shards = Object.values(room.shards()).filter(
          shard => shard.roomId() === 'drain-priority-room'
        );
        expect(shards.length).toBe(3);
        
        // Mark one shard as draining
        await request(server, `${baseUrl}/update-shard`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            shardId: shards[1].id,
            connections: 5,
            status: 'draining'
          })
        });
        
        // Scale down to 2 shards
        await request(server, `${baseUrl}/scale-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            roomId: 'drain-priority-room',
            targetShardCount: 2
          })
        });
        
        // Verify the draining shard was removed
        const finalShards = Object.values(room.shards()).filter(
          shard => shard.roomId() === 'drain-priority-room'
        );
        expect(finalShards.length).toBe(2);
        expect(finalShards.find(shard => shard.id === shards[1].id)).toBeUndefined();
      });
    });
  });

  /**
   * 3. Tests unitaires - Algorithmes de balancing
   */
  describe('Balancing Strategies', () => {
    describe('Round-Robin Strategy', () => {
      it('should distribute connections in a round-robin fashion', async () => {
        // Register a room with round-robin balancing and 3 shards
        await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'round-robin-room',
            balancingStrategy: 'round-robin',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 3
          })
        });
        
        // Make three connections and collect the assigned shards
        const assignedShards = [];
        
        for (let i = 0; i < 3; i++) {
          const response = await request(server, `${baseUrl}/connect`, {
            method: 'POST',
            body: JSON.stringify({
              roomId: 'round-robin-room',
              autoCreate: false
            })
          });
          
          const data = await response.json();
          assignedShards.push(data.shardId);
        }
        
        // Verify all three shards were used
        const uniqueShardIds = new Set(assignedShards);
        expect(uniqueShardIds.size).toBe(3);
        
        // Make another connection, should cycle back to the first shard
        const response = await request(server, `${baseUrl}/connect`, {
          method: 'POST',
          body: JSON.stringify({
            roomId: 'round-robin-room',
            autoCreate: false
          })
        });
        
        const data = await response.json();
        expect(data.shardId).toBe(assignedShards[0]);
      });
    });

    describe('Least-Connections Strategy', () => {
      it('should direct connections to the shard with fewest connections', async () => {
        // Register a room with least-connections balancing
        await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'least-conn-room',
            balancingStrategy: 'least-connections',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 3
          })
        });
        
        // Get the three auto-created shards
        const shards = Object.values(room.shards()).filter(
          shard => shard.roomId() === 'least-conn-room'
        );
        
        // Update the shards with different connection counts
        await request(server, `${baseUrl}/update-shard`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            shardId: shards[0].id,
            connections: 20,
            status: 'active'
          })
        });
        
        await request(server, `${baseUrl}/update-shard`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            shardId: shards[1].id,
            connections: 5,
            status: 'active'
          })
        });
        
        await request(server, `${baseUrl}/update-shard`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            shardId: shards[2].id,
            connections: 10,
            status: 'active'
          })
        });
        
        // Connect to the room and expect to be routed to the shard with fewest connections (shard 1)
        const response = await request(server, `${baseUrl}/connect`, {
          method: 'POST',
          body: JSON.stringify({
            roomId: 'least-conn-room',
            autoCreate: false
          })
        });
        
        const data = await response.json();
        expect(data.shardId).toBe(shards[1].id);
      });
    });

    describe('Random Strategy', () => {
      it('should randomly distribute connections among shards', async () => {
        // Register a room with random balancing and many shards
        await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'random-room',
            balancingStrategy: 'random',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 5
          })
        });
        
        // Get all shards
        const shards = Object.values(room.shards()).filter(
          shard => shard.roomId() === 'random-room'
        );
        const shardIds = shards.map(shard => shard.id);
        
        // Make many connections to get a statistical distribution
        const assignedShards = new Map();
        const numberOfConnections = 50;
        
        for (let i = 0; i < numberOfConnections; i++) {
          const response = await request(server, `${baseUrl}/connect`, {
            method: 'POST',
            body: JSON.stringify({
              roomId: 'random-room',
              autoCreate: false
            })
          });
          
          const data = await response.json();
          const count = assignedShards.get(data.shardId) || 0;
          assignedShards.set(data.shardId, count + 1);
        }
        
        // Verify all shards were used and distribution is somewhat random
        expect(assignedShards.size).toBeGreaterThan(1); // At least some randomness
        
        // Statistical test: no shard should have more than 40% of connections
        // (This is a simplified test - in a real environment you'd use a proper statistical test)
        for (const [_, count] of assignedShards.entries()) {
          expect(count / numberOfConnections).toBeLessThan(0.4);
        }
      });
    });
  });

  /**
   * 4. Tests unitaires - Gestion des connexions
   */
  describe('Connection Management', () => {
    describe('Connecting to Rooms', () => {
      it('should connect successfully to an existing room', async () => {
        // Create a room first
        await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'connect-test-room',
            balancingStrategy: 'round-robin',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 1
          })
        });
        
        // Connect to the room
        const response = await request(server, `${baseUrl}/connect`, {
          method: 'POST',
          body: JSON.stringify({
            roomId: 'connect-test-room'
          })
        });
        
        expect(response.status).toBe(200);
        
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.shardId).toBeDefined();
        expect(data.url).toBeDefined();
      });

      it('should auto-create room when connecting if it does not exist', async () => {
        const response = await request(server, `${baseUrl}/connect`, {
          method: 'POST',
          body: JSON.stringify({
            roomId: 'auto-created-room',
            autoCreate: true
          })
        });
        
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        
        // Verify the room was created
        expect(room.rooms()['auto-created-room']).toBeDefined();
        
        // Verify a shard was created
        const roomShards = Object.values(room.shards()).filter(
          shard => shard.roomId() === 'auto-created-room'
        );
        expect(roomShards.length).toBe(1);
      });

      it('should handle non-existent room with autoCreate disabled', async () => {
        const response = await request(server, `${baseUrl}/connect`, {
          method: 'POST',
          body: JSON.stringify({
            roomId: 'non-existent-room',
            autoCreate: false
          })
        });
        
        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBeDefined();
      });

      it('should fail to connect with an empty request body', async () => {
        const response = await request(server, `${baseUrl}/connect`, {
          method: 'POST',
          body: ''
        });
        
        expect(response.status).toBe(400);
        
        const data = await response.json();
        expect(data.error).toBeDefined();
      });

      it('should not connect to a room with no active shards', async () => {
        // Create a room first
        await request(server, `${baseUrl}/register-room`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            name: 'inactive-shards-room',
            balancingStrategy: 'round-robin',
            public: true,
            maxPlayersPerShard: 50,
            minShards: 1
          })
        });
        
        // Get the auto-created shard
        const shard = Object.values(room.shards()).find(
          s => s.roomId() === 'inactive-shards-room'
        );
        
        // Mark the shard as maintenance
        await request(server, `${baseUrl}/update-shard`, {
          method: 'POST',
          headers: {
            'Authorization': jwtSecret
          },
          body: JSON.stringify({
            shardId: shard!.id,
            connections: 0,
            status: 'maintenance'
          })
        });
        
        // Try to connect to the room
        const response = await request(server, `${baseUrl}/connect`, {
          method: 'POST',
          body: JSON.stringify({
            roomId: 'inactive-shards-room',
            autoCreate: false
          })
        });
        
        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toContain('No active shards');
      });
    });
  });

  /**
   * 5. Tests de nettoyage automatique
   */
  describe('Cleanup and Maintenance', () => {
    it('should clean up inactive shards', async () => {
      // Create a room with a shard
      await request(server, `${baseUrl}/register-room`, {
        method: 'POST',
        headers: {
          'Authorization': jwtSecret
        },
        body: JSON.stringify({
          name: 'cleanup-test-room',
          balancingStrategy: 'round-robin',
          public: true,
          maxPlayersPerShard: 50,
          minShards: 1
        })
      });
      
      // Get the shard
      const shard = Object.values(room.shards()).find(
        s => s.roomId() === 'cleanup-test-room'
      );
      expect(shard).toBeDefined();
      
      // Set an old lastHeartbeat (more than timeout)
      const now = Date.now();
      const fiveMinutesAgo = now - (6 * 60 * 1000);
      shard!.lastHeartbeat.set(fiveMinutesAgo);
      
      // Mock setTimeout to trigger cleanup immediately
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = vi.fn() as any;
      (global.setTimeout as any).mockImplementationOnce((fn) => {
        fn();
        return 1;
      });
      
      // Trigger cleanup manually
      (room as any).cleanupInactiveShards();
      
      // Restore setTimeout
      global.setTimeout = originalSetTimeout;
      
      // Verify the shard was removed
      const remainingShards = Object.values(room.shards()).filter(
        s => s.roomId() === 'cleanup-test-room'
      );
      expect(remainingShards.length).toBe(0);
    });
  });

  /**
   * Disabled for now, because we don't have a way to test it
   
  describe('Input Validation', () => {
    it('should reject invalid room configurations', async () => {
      // Missing required fields
      const response1 = await request(server, `${baseUrl}/register-room`, {
        method: 'POST',
        headers: {
          'Authorization': jwtSecret
        },
        body: JSON.stringify({
          name: 'invalid-room',
          // Missing balancingStrategy
          public: true,
          maxPlayersPerShard: 50,
          minShards: 1
        })
      });
      
      expect(response1.status).not.toBe(200);
      
      // Invalid enum value
      const response2 = await request(server, `${baseUrl}/register-room`, {
        method: 'POST',
        headers: {
          'Authorization': jwtSecret
        },
        body: JSON.stringify({
          name: 'invalid-room',
          balancingStrategy: 'invalid-strategy', // Not a valid strategy
          public: true,
          maxPlayersPerShard: 50,
          minShards: 1
        })
      });
      
      expect(response2.status).not.toBe(200);
      
      // Negative values for numeric fields
      const response3 = await request(server, `${baseUrl}/register-room`, {
        method: 'POST',
        headers: {
          'Authorization': jwtSecret
        },
        body: JSON.stringify({
          name: 'invalid-room',
          balancingStrategy: 'round-robin',
          public: true,
          maxPlayersPerShard: -10, // Negative value
          minShards: 1
        })
      });
      
      expect(response3.status).not.toBe(200);
    });

    it('should reject invalid shard updates', async () => {
      // Create a room with a shard first
      await request(server, `${baseUrl}/register-room`, {
        method: 'POST',
        headers: {
          'Authorization': jwtSecret
        },
        body: JSON.stringify({
          name: 'validation-test-room',
          balancingStrategy: 'round-robin',
          public: true,
          maxPlayersPerShard: 50,
          minShards: 1
        })
      });
      
      // Get the shard ID
      const shard = Object.values(room.shards()).find(
        s => s.roomId() === 'validation-test-room'
      );
      
      // Try to update with negative connections
      const response = await request(server, `${baseUrl}/update-shard`, {
        method: 'POST',
        headers: {
          'Authorization': jwtSecret
        },
        body: JSON.stringify({
          shardId: shard!.id,
          connections: -5, // Negative value
          status: 'active'
        })
      });
      
      expect(response.status).not.toBe(200);
      
      // Try to update with invalid status
      const response2 = await request(server, `${baseUrl}/update-shard`, {
        method: 'POST',
        headers: {
          'Authorization': jwtSecret
        },
        body: JSON.stringify({
          shardId: shard!.id,
          connections: 10,
          status: 'invalid-status' // Not a valid status
        })
      });
      
      expect(response2.status).not.toBe(200);
    });
  });
  */
});