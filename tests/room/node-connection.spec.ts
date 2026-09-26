import { describe, expect, expectTypeOf, it } from "vitest";
import { NodeConnection, type NodeRoom } from "../../packages/room/src/node";
import type * as Party from "../../packages/room/src/types/party";

function createSocket() {
  return {
    readyState: 1,
    send() {},
    close() {},
    on() {},
  };
}

describe("NodeConnection state", () => {
  it("replaces the state with a value or an updater", () => {
    const connection = new NodeConnection<{ count: number }>(createSocket(), "/parties/main/room");

    expect(connection.state).toBeNull();
    expect(connection.setState({ count: 1 })).toEqual({ count: 1 });
    expect(connection.setState((previous) => ({ count: (previous?.count ?? 0) + 1 }))).toEqual({ count: 2 });
    expect(connection.state).toEqual({ count: 2 });
    expect(connection.setState(null)).toBeNull();
  });

  it("types the state like a party connection", () => {
    const connection = new NodeConnection<{ count: number }>(createSocket(), "/parties/main/room");

    expectTypeOf(connection.state).toEqualTypeOf<Party.ConnectionState<{ count: number }>>();
    expectTypeOf(connection.setState).returns.toEqualTypeOf<Party.ConnectionState<{ count: number }>>();
    expectTypeOf<NodeConnection["state"]>().toEqualTypeOf<Party.ConnectionState<unknown>>();
  });

  it("keeps the connection state type when a room is used through a typed contract", () => {
    type Contract<TState = unknown> = {
      readonly id: string;
      readonly state: Party.ConnectionState<TState>;
      send(data: string): void;
      close(code?: number, reason?: string): void;
    };
    type RoomContract = {
      getConnection<TState = unknown>(id: string): Contract<TState> | undefined;
    };

    const assertAssignable = (room: NodeRoom, connection: NodeConnection<{ count: number }>) => {
      const typedRoom: RoomContract = room;
      const typedConnection: Contract<{ count: number }> = connection;
      return [typedRoom, typedConnection];
    };

    expectTypeOf(assertAssignable).toBeFunction();
  });
});
