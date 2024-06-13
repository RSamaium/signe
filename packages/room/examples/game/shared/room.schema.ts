import { signal } from '../../../../reactive';
import { sync } from '../../../../sync';

export class RoomSchema {
    @sync() count = signal(0)
}