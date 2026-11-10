// Named export for $src Function resolution test
export function myFn(_state: any) {
  return 42;
}

/** A handler that returns: only the document's use of it, never its shape, makes it a function. */
export function bump(state: { count: number }) {
  state.count += 1;
  return state.count;
}

/** Two parameters: arity no longer decides a role. */
export function pair(_state: { count: number }, _extra?: string) {
  return "pair";
}
