/* Decoding `fetchPluginSchema`'s answer in the suites that read it as a StudioSchema. The handler
   answers `StudioSchema | JsonValue`, because a module export's static `schema` is whatever the
   plugin declared; a `.class.json` source goes through extractStudioSchema, which always writes
   `properties` and `required`. Checking those two members is what lets a test read them typed. */
import { isJsonObject } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";
import type { StudioSchema } from "./_session";

/** Fail the test unless `value` carries the two members extractStudioSchema always writes. */
export function expectStudioSchema(value: StudioSchema | JsonValue): asserts value is StudioSchema {
  if (!isJsonObject(value) || !isJsonObject(value.properties) || !Array.isArray(value.required)) {
    throw new TypeError(`Not an extracted StudioSchema: ${JSON.stringify(value)}`);
  }
}
