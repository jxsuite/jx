// Named export for onMount test
export function onMount(/** @type {any} */ state) {
  /** @type {any} */ (globalThis)._testMounted = true;
}
