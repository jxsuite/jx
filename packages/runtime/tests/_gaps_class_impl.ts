// Fixture classes for runtime-gaps-resolve.test.ts (external class resolution)

import type { JsonObject, JsonValue } from "@jxsuite/schema/types";

/** Instance exposes a `value` property — exercises the `"value" in instance` branch. */
export class ValueBox {
  value: JsonValue;
  constructor(config: JsonObject) {
    this.value = config.initial ?? "boxed";
  }
}

/** Instance with resolve() + subscribe() — exercises async resolution and subscription. */
export class Resolvable {
  _label: string;
  _subs: ((v: JsonValue) => void)[] = [];
  constructor(config: JsonObject) {
    this._label = String(config.label ?? "");
    Object.assign(globalThis, { __gapsResolvable: this });
  }
  resolve() {
    return Promise.resolve(`resolved:${this._label}`);
  }
  subscribe(cb: (v: JsonValue) => void) {
    this._subs.push(cb);
  }
  push(v: JsonValue) {
    for (const cb of this._subs) {
      cb(v);
    }
  }
}

/** Not a class — exercises the TypeError branch in importAndInstantiate. */
export const notAClass = 42;
