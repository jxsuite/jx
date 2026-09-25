import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { describe, expect, test } from "bun:test";
import { defineElement } from "../src/runtime";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

describe("observed attributes present at connection", () => {
  test("are read into state, coerced, before the element renders", async () => {
    const tag = "ca-badge";
    await defineElement({
      tagName: tag,
      observedAttributes: ["label", "count", "active"],
      state: { label: "none", count: 0, active: false },
      textContent: "${state.label}:${state.count}:${state.active}",
    });
    const el = document.createElement(tag);
    el.setAttribute("label", "Inbox");
    el.setAttribute("count", "3");
    el.setAttribute("active", "");
    document.body.append(el);
    await tick();
    expect(el.textContent).toBe("Inbox:3:true");

    el.setAttribute("count", "4");
    el.setAttribute("active", "false");
    await tick();
    expect(el.textContent).toBe("Inbox:4:false");
    el.remove();
  });

  test("removing one restores the DECLARED DEFAULT, not the absence", async () => {
    // `attributeChangedCallback` reports a removal as `null`. Writing that through left a string
    // Prop holding `null` and coerced a number prop to `Number(null)`, which is 0 — so a numeric
    // Prop could never say "unset" and every `${state.x}` printed "null". The default is what the
    // Entry held before anyone set the attribute, which is what the removal asks to go back to.
    const tag = "ca-removed";
    await defineElement({
      tagName: tag,
      observedAttributes: ["label", "count", "active", "size"],
      state: {
        label: "none",
        count: { type: "number", default: 1, attribute: "count" },
        active: false,
        size: { type: "string", default: "md", attribute: "size" },
      },
      textContent: "${state.label}:${state.count}:${state.active}:${state.size}",
    });
    const el = document.createElement(tag);
    el.setAttribute("label", "Inbox");
    el.setAttribute("count", "3");
    el.setAttribute("active", "");
    el.setAttribute("size", "lg");
    document.body.append(el);
    await tick();
    expect(el.textContent).toBe("Inbox:3:true:lg");

    el.removeAttribute("label");
    el.removeAttribute("count");
    el.removeAttribute("active");
    el.removeAttribute("size");
    await tick();
    expect(el.textContent).toBe("none:1:false:md");
    el.remove();
  });

  test("an observed attribute with no declared default falls back by type, never to null", async () => {
    const tag = "ca-no-default";
    await defineElement({
      tagName: tag,
      observedAttributes: ["note"],
      // A computed entry is produced, so it declares no default and a removal must not invent one.
      state: { note: "", shout: { $expression: { operator: "+", target: "!", value: "!" } } },
      textContent: "[${state.note}]",
    });
    const el = document.createElement(tag);
    el.setAttribute("note", "hi");
    document.body.append(el);
    await tick();
    expect(el.textContent).toBe("[hi]");
    el.removeAttribute("note");
    await tick();
    expect(el.textContent).toBe("[]");
    el.remove();
  });

  test("removing one whose declared value is a plain object restores THAT object", async () => {
    // A state entry written as a plain object — no `default`, no computed marker — is its own
    // Default, the same shorthand as a bare string, and `buildScope` reads it that way. The defaults
    // Walk must fall through to record it rather than treat every object without a `default` as
    // Produced: a removal would otherwise erase the object to "" and every `${state.meta.kind}`
    // Under it would print "undefined".
    const tag = "ca-object-default";
    await defineElement({
      tagName: tag,
      observedAttributes: ["meta"],
      state: { meta: { kind: "none" } },
      textContent: "${JSON.stringify(state.meta)}",
    });
    const el = document.createElement(tag);
    document.body.append(el);
    await tick();
    expect(el.textContent).toBe('{"kind":"none"}');

    el.setAttribute("meta", "custom");
    await tick();
    expect(el.textContent).toBe('"custom"');

    el.removeAttribute("meta");
    await tick();
    expect(el.textContent).toBe('{"kind":"none"}');
    el.remove();
  });

  test("a property a parent set before connection still wins over the attribute", async () => {
    const tag = "ca-prop-wins";
    await defineElement({
      tagName: tag,
      observedAttributes: ["label"],
      state: { label: "none" },
      textContent: "${state.label}",
    });
    const el = document.createElement(tag) as HTMLElement & { label?: string };
    el.setAttribute("label", "from attribute");
    el.label = "from property";
    document.body.append(el);
    await tick();
    expect(el.textContent).toBe("from property");
    el.remove();
  });
});
