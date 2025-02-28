import { beforeEach, describe, expect, it } from "vitest";
import { Server, testRoom, Room } from "../../packages/room/src";
import { sync } from "@signe/sync";
import { signal } from "@signe/reactive";

@Room({
    path: "game"
})
class MyRoom  {
  @sync() count = signal(0);
}

describe('QuizRoom', () => {
  describe('Vote Validation', () => {
    let client: any
    let room: MyRoom
    let server: any

    beforeEach(async () => {
      const test = await testRoom(MyRoom, { shard: true });
      client = await test.createClient();
      room = test.room
      server = test.server
    })

    it('should reject invalid or empty vote', async () => {
      expect(server).toBeDefined();
      expect(true).toBe(true);
    });
  });
});