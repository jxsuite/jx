/**
 * Pretend the engine does, or does not, position by anchor — for a test that drives one of the two
 * placements the kit's overlays have (specs/ui.md §6).
 *
 * The kit asks `CSS.supports("position-area", "block-end")` (`supportsAnchorPositioning` in
 * `behaviors/popover.ts`) to decide whether the platform is placing a panel or the clamp is, and a
 * DOM shim answers that question however it likes — happy-dom says yes to everything — so a test
 * that means one path or the other has to say which. Redefinition rather than assignment, because
 * the shim exposes `CSS` through a read-only accessor.
 *
 * @param answer What `CSS.supports` should say.
 * @returns The undo, to run in `finally`.
 */
export function withAnchorSupport(answer: boolean): () => void {
  const before = Object.getOwnPropertyDescriptor(globalThis, "CSS");
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: { supports: () => answer },
  });
  return () => {
    /* Put back what was there — or, on an engine that had no `CSS` at all, nothing. */
    Object.defineProperty(
      globalThis,
      "CSS",
      before ?? { configurable: true, value: undefined, writable: true },
    );
  };
}
