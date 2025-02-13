import { id, users } from '../../../../sync/src/decorators';
import { signal } from '../../../../reactive';
import { sync } from '../../../../sync';

class User {
    @id() id = signal('')
    @sync() name = signal('')
    @sync() score = signal(0)
}

export class RoomSchema {
    @users(User) users = signal({})
    @sync() count = signal(0) 
}