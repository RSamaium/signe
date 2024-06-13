import { Server } from '../../../src';
import { GameRoom } from "./game.room";

export default class MainServer extends Server {
  rooms = [
    GameRoom
  ]
}