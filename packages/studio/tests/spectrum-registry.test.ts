import "./harness";
import { describe, expect, test } from "bun:test";

// Pre-define one tag so the registration loop's "already defined" guard is exercised.
class PreexistingToast extends HTMLElement {}
customElements.define("sp-toast", PreexistingToast);

const { components } = await import("../src/ui/spectrum");

describe("spectrum component registry", () => {
  /**
   * The manifest only ever SHRINKS now, so its size is a scoreboard rather than a floor.
   *
   * It used to assert `> 100` — "the manifest is full" — which was the right shape while Spectrum
   * was the design system. Every converted surface unregisters the tags it was the last writer of,
   * so that assertion became a countdown to its own failure, and it reached one at 97. A ceiling
   * that ratchets down is the same statement the rest of this package's gates make: a number may
   * fall, and raising it needs saying why. It reaches 0 when C8 deletes Spectrum.
   */
  const CEILING = 97;

  test("exports the full tag/constructor manifest", () => {
    expect(components.length).toBeGreaterThan(0);
    expect(components.length, "lower CEILING; the manifest only ratchets down").toBeLessThanOrEqual(
      CEILING,
    );
    const tags = components.map(([tag]) => tag);
    expect(new Set(tags).size).toBe(tags.length); // No duplicate tags
    for (const [tag, ctor] of components as [string, CustomElementConstructor][]) {
      expect(typeof tag).toBe("string");
      expect(typeof ctor).toBe("function");
    }
  });

  test("registers every manifest tag on the custom element registry", () => {
    for (const [tag] of components) {
      expect(customElements.get(tag as string), tag as string).toBeDefined();
    }
  });

  test("sp-tooltip is registered, and NOT by us", () => {
    /* The one tag this file deliberately does not own.
       Registering it here from the class-only module made Studio the first definer, and Spectrum's
       own registering entry — reached later by the textfield's dynamically-imported truncated-value
       controller — then called `customElements.define` for a name already taken and threw
       `NotSupportedError` into the console during ordinary panel use. The loop's
       `customElements.get` guard could never help: the second define is Spectrum's own call inside
       node_modules. A bare side-effect import of `sp-tooltip.js` puts THEIR module in the static
       graph, so it is the single definer and the later dynamic import hits the module cache.

       Both halves are asserted, because either one alone passes on the broken arrangement. */
    expect(components.map(([tag]) => tag)).not.toContain("sp-tooltip");
    expect(customElements.get("sp-tooltip")).toBeDefined();
  });

  /**
   * The families, taken FROM the manifest rather than named here.
   *
   * This asserted eight hand-picked tags, which is the right claim — the registration loop reaches
   * widgets, icons and Studio's own elements alike — written so that it rots. Two of its icons
   * (`sp-icon-folder`, `sp-icon-chevron100`) stopped being registered when the surfaces that wrote
   * them became documents, and the test went red naming a tag nothing had asked for in months. The
   * manifest is the list; what is worth pinning is that every KIND in it survives the loop, and
   * that the loop is not silently registering nothing.
   */
  test("widgets, icons, and studio elements are all reachable by tag", () => {
    const tags = components.map(([tag]) => tag as string);
    const families = {
      icon: tags.filter((t) => t.startsWith("sp-icon-")),
      spectrum: tags.filter((t) => t.startsWith("sp-") && !t.startsWith("sp-icon-")),
      studio: tags.filter((t) => t.startsWith("jx-")),
    };
    for (const [kind, members] of Object.entries(families)) {
      expect(members.length, `no ${kind} tag left in the manifest`).toBeGreaterThan(0);
      for (const tag of members) {
        expect(customElements.get(tag), tag).toBeDefined();
      }
    }
  });

  test("pre-registered tags are left untouched instead of redefined", () => {
    expect(customElements.get("sp-toast")).toBe(PreexistingToast);
    const manifestToast = components.find(([tag]) => tag === "sp-toast");
    expect(manifestToast?.[1]).not.toBe(PreexistingToast);
  });

  test("registered constructors instantiate via createElement", () => {
    const el = document.createElement("sp-divider");
    const ctor = customElements.get("sp-divider") as CustomElementConstructor;
    expect(el).toBeInstanceOf(ctor);
  });
});
