import { Server } from '../../../src';
import type * as Party from "../../../src/types/party";
import { GameRoom } from "./game.room";

export default class MainServer extends Server {
  options: Party.ServerOptions = {
    hibernate: true
  }
  rooms = [
    GameRoom
  ]
}