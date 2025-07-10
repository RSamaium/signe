import { Server, WorldRoom } from '../../../src';
import type * as Party from "../../../src/types/party";
import { GameRoom, ProtectedRoom } from "./game.room";

export default class MainServer extends Server {
  rooms = [
    GameRoom ,
    ProtectedRoom
  ]
}