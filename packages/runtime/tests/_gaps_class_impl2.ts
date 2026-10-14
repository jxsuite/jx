// Fixture class for runtime-gaps-resolve.test.ts (external class resolution)

import type { JsonObject } from "@jxsuite/schema/types";

/** Plain instance: no resolve(), no value — falls through to `value = instance`. */
export class PlainInstance {
  label: string;
  constructor(config: JsonObject) {
    this.label = String(config.label ?? "plain");
  }
}
