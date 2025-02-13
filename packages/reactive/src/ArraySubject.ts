import { BehaviorSubject } from 'rxjs';

export type ArrayChange<T> = {
  type: 'add' | 'remove' | 'update' | 'init' | 'reset';
  index?: number;
  items: T[];
};

/**
 * ArraySubject extends BehaviorSubject to monitor and notify about specific array modifications.
 * It distinguishes between additions, removals, and updates to array elements.
 */
export class ArraySubject<T> extends BehaviorSubject<ArrayChange<T>> {
  private _items: T[] = [];

  constructor(items: T[] = []) {
    super({ type: 'init', items }); // Initial dummy emission
    this.createProxy(items);
  }

  private createProxy(items) {
    this._items = new Proxy(items, {
      get: (target, prop, receiver) => {
        const origMethod = target[prop];
        if (typeof origMethod === 'function') {
          return (...args) => {
            let changeType: 'add' | 'remove' | 'update' = 'update';
            let index: number | undefined = undefined;
            let isMutateFn = false;
            let itemsToEmit: T[] = [];
            let changeSplice = true;

            switch (prop) {
              case 'push':
                index = target.length;
                changeType = 'add';
                isMutateFn = true
                break;
              case 'pop':
                index = target.length - 1;
                changeType = 'remove';
                isMutateFn = true
                break;
              case 'unshift':
                index = 0;
                changeType = 'add';
                isMutateFn = true
                break;
              case 'shift':
                index = 0;
                changeType = 'remove';
                isMutateFn = true
                break;
              case 'splice':
                index = args[0];
                const deleteCount = args[1];
                const newItems = args.slice(2);
                itemsToEmit = newItems;
                if (deleteCount > 0 && newItems.length === 0) {
                  changeType = 'remove';
                } else if (deleteCount === 0 && newItems.length > 0) {
                  changeType = 'add';
                } else if (deleteCount === 0 && newItems.length === 0) {
                  changeSplice = false
                } else {
                  changeType = 'update';
                }
                isMutateFn = true;
                break;
            }

            const result = origMethod.apply(target, args);
            
            if (isMutateFn  && changeSplice) {
              if (prop === 'splice') {
                this.next({ type: changeType, index, items: itemsToEmit });
              } else {
                this.next({ type: changeType, index, items: args });
              }
            }

            return result;
          };
        }
        // Return property value for direct access
        return Reflect.get(target, prop, receiver);
      },
      set: (target, prop, value) => {
        const index = !isNaN(Number(prop)) ? Number(prop) : undefined;
        target[prop] = value;
        this.next({ type: 'update', index, items: [value] });
        return true; // Indicate success
      }
    });
  }


  get items(): T[] {
    return this._items;
  }

  set items(newItems: T[]) {
    this.createProxy(newItems);
    this.next({ type: 'reset', items: newItems });
  }
}

export const isArraySubject = (value: any): boolean => {
  return '_items' in value;
}