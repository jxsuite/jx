// Named export for onMount test
export function onMount(/** @type {any} */ _state) {
  /** @type {any} */ (globalThis)._testMounted = true;
}
