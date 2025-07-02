import * as Party from "./types/party";

export interface RoomInterceptorPacket {
  interceptorPacket(user: any, obj: any, conn: Party.Connection): Promise<any> | null | any;
}

export interface RoomOnJoin {
  onJoin(user: any, conn: Party.Connection, ctx: Party.ConnectionContext): Promise<any> | null | any;
}

export interface RoomOnLeave {
  onLeave(user: any, conn: Party.Connection, ctx: Party.ConnectionContext): Promise<any> | null | any;
}

export interface RoomOnSessionTransfer {
  onSessionTransfer?(user: any, conn: Party.Connection, transferData: any): Promise<any> | null | any;
}

export interface RoomOnSessionPrepareTransfer {
  onSessionPrepareTransfer?(user: any, conn: Party.Connection, targetRoomId: string): Promise<any> | null | any;
}

export interface RoomMethods {
  $send: (conn: Party.Connection, obj: any) => void;
  $broadcast: (obj: any) => void;
}