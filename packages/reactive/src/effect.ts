import { computed } from "./computed";
import { Effect } from "./types";

export function effect(fn: () => void): Effect {
    fn['isEffect'] = true
    return computed(fn);
}
