// Fixture for the `$lazy` tests: evaluating this module is the observable, so each evaluation counts.
declare global {
  // oxlint-disable-next-line no-var -- a global declaration can only be `var`
  var __jxLazyLoads: number | undefined;
}

globalThis.__jxLazyLoads = (globalThis.__jxLazyLoads ?? 0) + 1;

/** Writes to state so a test can see the call ran against the scope it was given. */
export function lazyBump(state: { count: number }, by = 1) {
  state.count += by;
  return state.count;
}
