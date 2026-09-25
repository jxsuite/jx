import "./with-dom.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import {
  focusSwatch,
  onSwatchGroupKeydown,
  onSwatchGroupMount,
  onSwatchGroupSelect,
} from "../src/behaviors/swatch-group.ts";
import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxSwatch = HTMLElement & { value: string; color: string; checked: string; tabindex: string };
type JxSwatchGroup = HTMLElement & { value: string; label: string; columns: number };

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
});

/**
 * A group of swatches inside a plain ancestor. `colours` are the swatch values, and a value ending
 * in `!` marks that swatch disabled.
 */
async function group(
  value: string,
  colours: string[] = ["red", "green", "blue"],
): Promise<JxSwatchGroup> {
  const outer = document.createElement("div");
  const el = document.createElement("jx-swatch-group") as JxSwatchGroup;
  el.setAttribute("label", "Palette");
  el.setAttribute("value", value);
  for (const colour of colours) {
    const swatch = document.createElement("jx-swatch") as JxSwatch;
    swatch.setAttribute("value", colour.replace("!", ""));
    swatch.setAttribute("color", `#00000${colour.length % 10}`);
    swatch.setAttribute("label", colour.replace("!", ""));
    if (colour.endsWith("!")) {
      swatch.setAttribute("disabled", "");
    }
    el.append(swatch);
  }
  outer.append(el);
  document.body.append(outer);
  await tick();
  await tick();
  return el;
}

const swatches = (el: Element) => [...el.querySelectorAll<JxSwatch>("jx-swatch")];
const controls = (el: Element) => [...el.querySelectorAll<HTMLElement>('[part="control"]')];
/** The checked state of each member, in order. */
const checked = (el: Element) => swatches(el).map((s) => s.checked);
/** Each member's forwarded tabindex, in order. */
const carets = (el: Element) => controls(el).map((c) => c.getAttribute("tabindex"));

function key(name: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: name });
}

describe("jx-swatch-group", () => {
  test("is a named radiogroup whose members are radios", async () => {
    const el = await group("green");
    expect(el.getAttribute("role")).toBe("radiogroup");
    expect(el.getAttribute("aria-label")).toBe("Palette");
    for (const control of controls(el)) {
      expect(control.getAttribute("role")).toBe("radio");
    }
    expect(checked(el)).toEqual(["false", "true", "false"]);
  });

  test("has exactly one tab stop, on the chosen member", async () => {
    const el = await group("blue");
    expect(carets(el)).toEqual(["-1", "-1", "0"]);
  });

  test("puts the caret on the first member that can be chosen when nothing is", async () => {
    const el = await group("", ["red!", "green", "blue"]);
    expect(carets(el)).toEqual(["-1", "0", "-1"]);
    expect(checked(el)).toEqual(["false", "false", "false"]);
  });

  test("either arrow pair moves the caret and chooses, wrapping at both ends", async () => {
    const el = await group("red");
    const heard: unknown[] = [];
    el.parentElement!.addEventListener("change", (e) => {
      heard.push((e as CustomEvent<unknown>).detail);
    });
    controls(el)[0]!.dispatchEvent(key("ArrowRight"));
    /* Synchronously, before anything re-renders: moving focus and moving the caret are ONE step,
       so the group never has two tab stops or none, even for a microtask. */
    expect(swatches(el).map((swatch) => swatch.tabindex)).toEqual(["-1", "0", "-1"]);
    expect(document.activeElement).toBe(controls(el)[1]!);
    await tick();
    expect(el.value).toBe("green");
    /* Down means "the next one" too, because a palette wraps into rows. */
    controls(el)[1]!.dispatchEvent(key("ArrowDown"));
    await tick();
    expect(el.value).toBe("blue");
    controls(el)[2]!.dispatchEvent(key("ArrowRight"));
    await tick();
    expect(el.value).toBe("red");
    controls(el)[0]!.dispatchEvent(key("ArrowUp"));
    await tick();
    expect(el.value).toBe("blue");
    expect(heard).toEqual(["green", "blue", "red", "blue"]);
    expect(carets(el)).toEqual(["-1", "-1", "0"]);
  });

  test("Home and End go to the ends", async () => {
    const el = await group("green");
    controls(el)[1]!.dispatchEvent(key("End"));
    await tick();
    expect(el.value).toBe("blue");
    controls(el)[2]!.dispatchEvent(key("Home"));
    await tick();
    expect(el.value).toBe("red");
  });

  test("a key the pattern does not claim is left alone", async () => {
    const el = await group("green");
    const event = key("PageDown");
    controls(el)[1]!.dispatchEvent(event);
    await tick();
    expect(event.defaultPrevented).toBe(false);
    expect(el.value).toBe("green");
  });

  test("a member that cannot be chosen is stepped over", async () => {
    const el = await group("red", ["red", "green!", "blue"]);
    controls(el)[0]!.dispatchEvent(key("ArrowRight"));
    await tick();
    expect(el.value).toBe("blue");
    expect(carets(el)).toEqual(["-1", "-1", "0"]);
  });

  test("a swatch's select stops at the group, which answers with one change", async () => {
    const el = await group("red");
    const selects: unknown[] = [];
    const changes: unknown[] = [];
    el.parentElement!.addEventListener("select", (e) => {
      selects.push((e as CustomEvent<unknown>).detail);
    });
    el.parentElement!.addEventListener("change", (e) => {
      const target = e.target as JxSwatchGroup;
      changes.push(`${target.localName}=${target.value}`);
    });
    controls(el)[2]!.click();
    await tick();
    /* `select` is the group's internal protocol; `change` is the whole public surface, and the
       value is written before it is dispatched so `e.target.value` is the new one. */
    expect(selects).toEqual([]);
    expect(changes).toEqual(["jx-swatch-group=blue"]);
    expect(checked(el)).toEqual(["false", "false", "true"]);
  });

  test("re-choosing what is already chosen says nothing", async () => {
    const el = await group("green");
    const changes: unknown[] = [];
    el.parentElement!.addEventListener("change", () => {
      changes.push(1);
    });
    controls(el)[1]!.click();
    await tick();
    expect(changes).toEqual([]);
    expect(el.value).toBe("green");
  });

  test("a host write of value moves the whole group with no method call", async () => {
    const el = await group("red");
    el.value = "blue";
    await tick();
    expect(checked(el)).toEqual(["false", "false", "true"]);
    expect(carets(el)).toEqual(["-1", "-1", "0"]);
    expect(el.dataset["selection"]).toBe("blue");
  });

  test("the one tab stop survives the swatch set changing underneath it", async () => {
    const el = await group("blue");
    expect(carets(el)).toEqual(["-1", "-1", "0"]);
    /* Removing the caret-holder leaves ZERO tab stops without the observer, so a group of
       operable swatches drops out of the tab order entirely. */
    swatches(el)[2]!.remove();
    await tick();
    expect(carets(el)).toEqual(["0", "-1"]);
    /* And a swatch appended afterwards arrives with no tabindex at all, which is a SECOND one. */
    const extra = document.createElement("jx-swatch") as JxSwatch;
    extra.setAttribute("value", "amber");
    extra.setAttribute("color", "#f5d90a");
    extra.setAttribute("label", "Amber");
    el.append(extra);
    await tick();
    await tick();
    expect(carets(el).filter((t) => t === "0").length).toBe(1);
  });

  test("a nested group's keys and clicks are its own", async () => {
    const el = await group("red");
    const inner = await group("green");
    swatches(el)[0]!.append(inner);
    await tick();
    controls(inner)[1]!.dispatchEvent(key("ArrowRight"));
    await tick();
    /* The inner group moved and the outer one did not, even though the key bubbled through it. */
    expect(inner.value).toBe("blue");
    expect(el.value).toBe("red");

    /* And a key NEITHER group claims reaches the outer one still bubbling, where it is refused
       for a second reason: the swatch it came from belongs to the inner group. */
    const stray = key("PageDown");
    controls(inner)[0]!.dispatchEvent(stray);
    await tick();
    expect(stray.defaultPrevented).toBe(false);
    expect(el.value).toBe("red");
    expect(inner.value).toBe("blue");
  });

  test("a group in which nothing can be chosen has no tab stop and answers no key", async () => {
    const el = await group("red", ["red!", "green!"]);
    /* Zero tab stops is the right answer here and one is not: a group where every member refuses
       is not a control a reader should be able to Tab into and then be unable to leave. */
    expect(carets(el)).toEqual(["-1", "-1"]);
    expect(focusSwatch(el, 0)).toBeNull();
    const event = key("ArrowRight");
    controls(el)[0]!.dispatchEvent(event);
    await tick();
    expect(el.value).toBe("red");
  });

  test("a second announcement watches nothing twice", async () => {
    const el = await group("red");
    /* The element announces itself once, but a host may re-announce it and an observer installed
       twice would answer every mutation twice for the life of the group. */
    el.dispatchEvent(new CustomEvent("jx-ready", { bubbles: true }));
    await tick();
    swatches(el)[0]!.remove();
    await tick();
    expect(carets(el).filter((t) => t === "0").length).toBe(1);
  });

  test("a handler bound to something that is not a group does nothing at all", async () => {
    /* The sidecar reads its element off `currentTarget`, and a surface that bound one of these to
       the wrong node must get silence rather than a write into a scope that is not a group's. */
    const stray = document.createElement("div");
    document.body.append(stray);
    const scope = { value: "red" };
    const fired: string[] = [];
    stray.addEventListener("keydown", (e) => {
      onSwatchGroupKeydown(scope, e as KeyboardEvent);
      fired.push("keydown");
    });
    stray.addEventListener("select", (e) => {
      onSwatchGroupSelect(scope, e);
      fired.push("select");
    });
    stray.addEventListener("jx-ready", (e) => {
      onSwatchGroupMount(scope, e);
      fired.push("ready");
    });
    stray.dispatchEvent(new CustomEvent("jx-ready"));
    stray.dispatchEvent(key("ArrowRight"));
    stray.dispatchEvent(new CustomEvent("select", { detail: "blue" }));
    expect(fired).toEqual(["ready", "keydown", "select"]);
    expect(scope.value).toBe("red");
  });

  test("a group with no swatches at all writes nothing and does not throw", async () => {
    const el = await group("red", []);
    expect(el.dataset["selection"]).toBe("red");
    el.dispatchEvent(key("ArrowRight"));
    expect(el.value).toBe("red");
  });

  test("columns turns the row into a grid, and zero means unset", async () => {
    const el = await group("red");
    expect(el.matches("[data-columns]")).toBe(false);
    el.setAttribute("columns", "4");
    await tick();
    expect(el.dataset["columns"]).toBe("");
  });
});
