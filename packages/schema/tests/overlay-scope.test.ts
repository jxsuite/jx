import { describe, expect, test } from "bun:test";
import { declaresPopover, isPopover, overlayScopeFor } from "../src/overlays";
import type { JxElement } from "../types";

/**
 * `overlayScopeFor` — the one definition of what makes a tag a popover or an invoker.
 *
 * It had no test in this package, and the coverage gate said so in the only way it can: the schema
 * workspace's own run never loaded the file's last third, because every CALLER is in another
 * workspace (`packages/ui/src/documents.ts` and the compiler's `jx validate`). A function nobody
 * here exercises is one this package cannot refactor safely, whatever the other suites happen to
 * cover — so the tests belong beside the function.
 */
const def = (tag: string, extra: Record<string, unknown> = {}): JxElement =>
  ({ tagName: tag, ...extra }) as JxElement;

const INVOKER = ["popovertarget", "popovertargetaction", "command", "commandfor"];

describe("overlayScopeFor", () => {
  test("a definition whose own root declares popover names a popover tag", () => {
    const scope = overlayScopeFor([def("jx-menu", { attributes: { popover: "auto" } })]);
    expect([...(scope.popoverTags ?? [])]).toEqual(["jx-menu"]);
    expect(scope.invokerTags?.size).toBe(0);
  });

  test("popover written as a top-level key counts the same as an attribute", () => {
    // `declaresPopover` reads the attribute bag however it was spelled; this holds the two together.
    expect(declaresPopover(def("jx-menu", { popover: "auto" }))).toBe(
      declaresPopover(def("jx-menu", { attributes: { popover: "auto" } })),
    );
  });

  test("a definition observing all four invoker attributes forwards them", () => {
    const scope = overlayScopeFor([def("jx-button", { observedAttributes: INVOKER })]);
    expect([...(scope.invokerTags ?? [])]).toEqual(["jx-button"]);
  });

  test("observing three of the four is not forwarding", () => {
    /* All four or none: the rule this feeds exists because those attributes come from an IDL mixin
       that only a button and an input have, so a partial forwarder still drops the invocation. */
    const scope = overlayScopeFor([def("jx-button", { observedAttributes: INVOKER.slice(1) })]);
    expect(scope.invokerTags?.size).toBe(0);
  });

  test("a tag with no dash is no definition, whatever it declares", () => {
    const scope = overlayScopeFor([
      def("div", { attributes: { popover: "auto" }, observedAttributes: INVOKER }),
    ]);
    expect(scope.popoverTags?.size).toBe(0);
    expect(scope.invokerTags?.size).toBe(0);
  });

  test("a missing or non-string tagName is skipped rather than thrown over", () => {
    const scope = overlayScopeFor([
      {} as JxElement,
      { tagName: 42 } as unknown as JxElement,
      def("jx-menu", { attributes: { popover: "auto" } }),
    ]);
    expect([...(scope.popoverTags ?? [])]).toEqual(["jx-menu"]);
  });

  test("observedAttributes that is not an array names no invoker", () => {
    const scope = overlayScopeFor([def("jx-button", { observedAttributes: "popovertarget" })]);
    expect(scope.invokerTags?.size).toBe(0);
  });

  test("one definition can be both, and several are collected", () => {
    const scope = overlayScopeFor([
      def("jx-dialog", { attributes: { popover: "manual" }, observedAttributes: INVOKER }),
      def("jx-tooltip", { attributes: { popover: "hint" } }),
    ]);
    expect([...(scope.popoverTags ?? [])].toSorted()).toEqual(["jx-dialog", "jx-tooltip"]);
    expect([...(scope.invokerTags ?? [])]).toEqual(["jx-dialog"]);
  });

  test("the scope is what makes a consumer's bare tag a popover", () => {
    /* The whole point: `<jx-menu>` at a call site carries no `popover` of its own — the definition
       does — so the structural question can only be answered against the scope. */
    const consumer = def("jx-menu");
    expect(isPopover(consumer)).toBe(false);
    const scope = overlayScopeFor([def("jx-menu", { popover: "auto" })]);
    expect(isPopover(consumer, scope)).toBe(true);
  });
});
