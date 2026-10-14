// Named export for onMount test
import type { JxScope } from "../src/types";

export function onMount(_state: JxScope) {
  Object.assign(globalThis, { _testMounted: true });
}
