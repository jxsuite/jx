/**
 * Happy-dom implements no ARIA reflection, so `ariaLabel` is not on its `HTMLElement.prototype` the
 * way it is in every browser Studio runs in. A test that needs the kebab spelling of a camelCase
 * DOM property (`aria-label` for `ariaLabel`) defines the accessor for its duration and calls the
 * returned function to take it away again. Where the property already exists nothing is changed.
 */
export function stubAriaLabel(): () => void {
  if ("ariaLabel" in HTMLElement.prototype) {
    return () => {};
  }
  Object.defineProperty(HTMLElement.prototype, "ariaLabel", {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute("aria-label");
    },
    set(this: HTMLElement, value: string) {
      this.setAttribute("aria-label", value);
    },
  });
  return () => {
    Reflect.deleteProperty(HTMLElement.prototype, "ariaLabel");
  };
}
