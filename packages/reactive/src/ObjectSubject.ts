import { BehaviorSubject } from 'rxjs';

export interface ObjectChange<T> {
  type: 'add' | 'remove' | 'update' | 'init' | 'reset';
  key?: keyof T;
  value?: any;
}

export class ObjectSubject<T extends Record<string, any>> extends BehaviorSubject<ObjectChange<T>> {
  private _obj: T;

  constructor(obj: T = {} as T) {
    super({ type: 'init', value: obj });
    this.createProxy(obj);
  }

  private createProxy(obj: T) {
    this._obj = new Proxy(obj, {
      get: (target, prop, receiver) => {
        return Reflect.get(target, prop, receiver);
      },
      set: (target, prop, value, receiver) => {
        const key = prop as keyof T;
        const changeType = key in target ? 'update' : 'add';

        target[key] = value;
        this.next({ type: changeType, key, value });
        return true; 
      },
      deleteProperty: (target, prop) => {
        const key = prop as keyof T;
        if (key in target) {
          const value = target[key];
          delete target[key];
          this.next({ type: 'remove', key, value });
          return true;
        }
        return false; 
      }
    });
  }

  get obj(): T {
    return this._obj;
  }

  set obj(newObj: T) {
    this.createProxy(newObj);
    this.next({ type: 'reset', value: newObj });
  }
}
