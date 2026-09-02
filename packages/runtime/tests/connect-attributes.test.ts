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
