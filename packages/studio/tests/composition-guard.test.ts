import "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import { installCompositionGuard, isCompositionKey } from "../src/editor/composition-guard";

/** A keydown; `ime229` gives it the key code an engine sends for a composition's first key. */
function key(init: KeyboardEventInit, ime229 = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  if (ime229) {
    Object.defineProperty(event, "keyCode", { value: 229 });
  }
  return event;
}

describe("the composition guard", () => {
  let remove: (() => void) | undefined;
  /** The keys an application handler on the document was handed. */
  let heard: string[] = [];
  const listen = (event: KeyboardEvent): void => {
    heard.push(event.key);
  };

  afterEach(() => {
    remove?.();
    remove = undefined;
    document.removeEventListener("keydown", listen);
    document.body.replaceChildren();
    heard = [];
  });

  function field(markup: string): HTMLInputElement {
    document.body.innerHTML = markup;
    document.addEventListener("keydown", listen);
    return document.querySelector("input")!;
  }

  test("a key is the input method's while composing, and on the 229 that precedes compositionstart", () => {
    expect(isCompositionKey(key({ isComposing: true, key: "Enter" }))).toBe(true);
    expect(isCompositionKey(key({ key: "Process" }, true))).toBe(true);
    expect(isCompositionKey(key({ key: "Enter" }))).toBe(false);
  });

  test("a composing Enter or Escape reaches no application handler, and keeps its default action", () => {
    remove = installCompositionGuard();
    const input = field("<input />");
    const enter = key({ isComposing: true, key: "Enter" });
    input.dispatchEvent(enter);
    input.dispatchEvent(key({ key: "Escape" }, true));
    expect(heard).toEqual([]);
    expect(enter.defaultPrevented).toBe(false);
  });

  test("an ordinary key is delivered", () => {
    remove = installCompositionGuard();
    field("<input />").dispatchEvent(key({ key: "Enter" }));
    expect(heard).toEqual(["Enter"]);
  });

  test("Monaco keeps its composition keys: it tracks composition itself", () => {
    remove = installCompositionGuard();
    field('<div class="monaco-editor"><input /></div>').dispatchEvent(
      key({ isComposing: true, key: "a" }),
    );
    expect(heard).toEqual(["a"]);
  });

  test("a key aimed at the window itself is stopped without a target to inspect", () => {
    remove = installCompositionGuard();
    window.addEventListener("keydown", listen);
    window.dispatchEvent(key({ isComposing: true, key: "Enter" }));
    window.dispatchEvent(key({ key: "Tab" }));
    window.removeEventListener("keydown", listen);
    expect(heard).toEqual(["Tab"]);
  });

  test("removing the guard restores delivery", () => {
    installCompositionGuard()();
    field("<input />").dispatchEvent(key({ isComposing: true, key: "Escape" }));
    expect(heard).toEqual(["Escape"]);
  });
});
