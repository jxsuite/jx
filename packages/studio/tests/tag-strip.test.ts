/**
 * The Inspector's bound-value strip (src/panels/tag-strip.ts, src/surfaces/tag-strip.ts; studio.md
 * §6.6, §6.9): a template drawn as literal runs and chips with resolved values, each chip opening
 * the tag popover, and the characters one press away.
 *
 * The real surface document and the real flow. The canvas frame is a double, because the values a
 * chip shows are the frame's; the command a chip runs is a record that notes what it was run with.
 */
import { flush, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createCommandRegistry } from "../src/commands/registry";
import { makeContext } from "../src/commands/context";
import { setActiveRegistry } from "../src/commands/active-registry";

import type { CommandArgValues } from "../src/commands/command-args";
import type { JxPath } from "../src/state";
import type { JsonValue, JxMutableNode } from "@jxsuite/schema/types";
import type { Tab } from "../src/tabs/tab";

/** What the frame was asked, and what it answers each template with. */
const asks: { path: JxPath | null; templates: { id: string; template: string }[] }[] = [];
const answers = new Map<string, string>();
let frameUp = true;
/** Replies held back, released by hand, when set. */
let held: (() => void)[] | null = null;

void mock.module("../src/canvas/iframe-host", () => ({
  flushCanvasEdits: () => Promise.resolve(),
  getEditBarAnchorRect: () => null,
  getEditSnapshot: () => ({ editing: false, editingProp: null, snapshot: null }),
  postApplyFormat: () => {},
  requestCanvasEval: () => Promise.resolve(null),
  requestTemplateEval: (
    _tabId: string | null,
    request: { path: JxPath | null; templates: { id: string; template: string }[] },
  ) => {
    asks.push(request);
    const reply = frameUp
      ? {
          results: request.templates.map(({ id, template }) => ({
            id,
            text: answers.get(template) ?? "",
            type: "string",
          })),
          rows: null,
        }
      : null;
    if (held) {
      const queue = held;
      return new Promise((resolve) => {
        queue.push(() => resolve(reply));
      });
    }
    return Promise.resolve(reply);
  },
  revealCanvasPath: () => Promise.resolve(null),
}));

const { paintTagStrip, resetTagStrips, stripRuns } = await import("../src/panels/tag-strip");
const { disposeDetachedTagStrips, unmountTagStrip } = await import("../src/surfaces/tag-strip");
const { boundTagsOf } = await import("../src/editor/dynamic-tags");

const HEADING: JxPath = ["children", 0];
const TEMPLATE = "By ${state.author ?? ''} on ${state.date}!";

function page(): JxMutableNode {
  return {
    children: [
      { attributes: { title: { $ref: "#/state/author" } }, tagName: "h1", textContent: TEMPLATE },
    ],
    state: { author: "Ada", date: "2026-10-29" },
    tagName: "main",
  };
}

let tab: Tab;
let host: HTMLElement;
const changes: (JsonValue | undefined)[] = [];
const ran: [string, CommandArgValues][] = [];

/** Paint the heading's text into the host, as its Inspector row does. */
async function paint(value: JxMutableNode["textContent"] = TEMPLATE): Promise<void> {
  paintTagStrip(host, {
    fieldKey: "prop|children/0|textContent",
    label: "Text Content",
    onChange: (next) => changes.push(next),
    path: HEADING,
    slot: ["textContent"],
    value,
  });
  await flush(8);
}

/** The strip's runs as text: a literal as itself, a chip as `{name=value}`. */
function drawn(): string {
  return [...host.querySelectorAll('[part="run"], [part="chip"]')]
    .map((el) =>
      el.getAttribute("part") === "run"
        ? el.textContent
        : `{${el.querySelector('[part="chip-name"]')?.textContent ?? ""}=${
            el.querySelector('[part="chip-value"]')?.textContent ?? ""
          }}`,
    )
    .join("");
}

function control(part: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(`[part="${part}"] [part="control"]`);
  if (!el) {
    throw new TypeError(`the strip draws no ${part}`);
  }
  return el;
}

beforeEach(() => {
  resetStudioState();
  tab = resetWorkspaceWithTab(page(), { documentPath: "pages/post.json" });
  host = document.createElement("div");
  document.body.append(host);
  asks.length = 0;
  answers.clear();
  frameUp = true;
  held = null;
  changes.length = 0;
  ran.length = 0;
  resetTagStrips();
  const registry = createCommandRegistry({
    getContext: () => makeContext({ document: { open: true } }),
  });
  registry.register({
    category: "View",
    id: "canvas.setTagPopover",
    level: "document",
    run: (_ctx, args: CommandArgValues) => {
      ran.push(["canvas.setTagPopover", args]);
    },
    title: "Set Tag Popover",
  });
  setActiveRegistry(registry);
});

afterEach(() => {
  unmountTagStrip(host);
  host.remove();
  setActiveRegistry(null);
});

describe("stripRuns", () => {
  test("a template is its literal runs and one chip per tag, in order", () => {
    const tags = boundTagsOf({ textContent: TEMPLATE });
    const runs = stripRuns(TEMPLATE, tags, new Map([[1, "2026-10-29"]]));
    expect(runs.map((run) => [run.kind, run.text, run.value, run.name])).toEqual([
      ["text", "By ", "", ""],
      ["chip", "Author", "", "Author"],
      ["text", " on ", "", ""],
      ["chip", "Date", "2026-10-29", "Date: 2026-10-29"],
      ["text", "!", "", ""],
    ]);
    expect(runs.filter((run) => run.kind === "chip").map((run) => run.key)).toEqual(["0", "1"]);
  });

  test("a { $ref } is one chip, and a value that is neither is nothing", () => {
    const pointer = { $ref: "#/state/author" };
    expect(stripRuns(pointer, boundTagsOf({ textContent: pointer }))).toMatchObject([
      { key: "0", kind: "chip", tagKind: "ref", text: "Author" },
    ]);
    expect(stripRuns(5, [])).toEqual([]);
    expect(stripRuns("plain", [])).toMatchObject([{ kind: "text", text: "plain" }]);
  });
});

describe("the strip in the Inspector", () => {
  test("draws runs and chips, never the template's characters, and fills in what the canvas draws", async () => {
    answers.set("${state.author ?? ''}", "Ada");
    answers.set("${state.date}", "2026-10-29");
    await paint();
    expect(drawn()).toBe("By {Author=Ada} on {Date=2026-10-29}!");
    expect(host.querySelector('[part="strip"]')?.textContent).not.toContain("${");
    expect(host.querySelector('[part="strip"]')?.getAttribute("aria-label")).toBe("Text Content");
    // Asked once, in the scope of the node the value is on.
    expect(asks).toHaveLength(1);
    expect(asks[0]?.path).toEqual(HEADING);
    expect(asks[0]?.templates).toEqual([
      { id: "0", template: "${state.author ?? ''}" },
      { id: "1", template: "${state.date}" },
    ]);
  });

  test("a repaint is an assignment, and asks the frame nothing more", async () => {
    await paint();
    const root = host.firstElementChild;
    await paint();
    await paint();
    expect(host.firstElementChild).toBe(root);
    expect(asks).toHaveLength(1);
  });

  test("with no frame to ask, the chips still say their names", async () => {
    frameUp = false;
    await paint();
    expect(drawn()).toBe("By {Author=} on {Date=}!");
  });

  test("a value the active row changes is asked for again", async () => {
    await paint();
    tab.session.ui.activeRows = { '["children",3]': 2 };
    await paint();
    expect(asks).toHaveLength(2);
  });

  test("a chip opens its own tag, by the command", async () => {
    await paint();
    const chips = [...host.querySelectorAll<HTMLElement>('[part="chip"] [part="control"]')];
    chips[1]?.click();
    await flush(4);
    expect(ran).toEqual([
      ["canvas.setTagPopover", { tag: { index: 1, path: HEADING, slot: ["textContent"] } }],
    ]);
  });

  test("the characters are one press away, and a commit there stores the template", async () => {
    await paint();
    expect(host.querySelector('[part="raw"]')).toBeNull();
    expect(control("raw-toggle").textContent.trim()).toBe("Edit as text");
    control("raw-toggle").click();
    await flush(6);
    expect(host.querySelector('[part="strip"]')).toBeNull();
    const field = host.querySelector<HTMLTextAreaElement>('[part="raw"] textarea');
    expect(field?.value).toBe(TEMPLATE);
    expect(control("raw-toggle").textContent.trim()).toBe("Show as tags");
    field!.value = "By ${state.author}";
    field!.dispatchEvent(new Event("change", { bubbles: true }));
    // The same text again is no write; emptied, the binding is cleared.
    field!.value = TEMPLATE;
    field!.dispatchEvent(new Event("change", { bubbles: true }));
    field!.value = "";
    field!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(changes).toEqual(["By ${state.author}", undefined]);
    control("raw-toggle").click();
    await flush(6);
    expect(host.querySelector('[part="strip"]')).not.toBeNull();
  });

  test("the row remembers it was showing characters until the panel lets go", async () => {
    await paint();
    control("raw-toggle").click();
    await flush(6);
    await paint();
    expect(host.querySelector('[part="raw"]')).not.toBeNull();
    resetTagStrips();
    await paint();
    expect(host.querySelector('[part="raw"]')).toBeNull();
  });

  test("a { $ref } is one chip with no characters to type", async () => {
    answers.set("${state?.author}", "Ada");
    paintTagStrip(host, {
      fieldKey: "attr|children/0|title",
      label: "title",
      onChange: (next) => changes.push(next),
      path: HEADING,
      slot: ["attributes", "title"],
      value: { $ref: "#/state/author" },
    });
    await flush(8);
    expect(drawn()).toBe("{Author=Ada}");
    expect(control("raw-toggle").hasAttribute("disabled")).toBe(true);
  });

  test("a strip whose box another control cleared is mounted again, and one that left the page is let go", async () => {
    await paint();
    host.textContent = "";
    await paint();
    expect(drawn()).toBe("By {Author=} on {Date=}!");
    host.remove();
    disposeDetachedTagStrips();
    document.body.append(host);
    await paint();
    expect(host.querySelector('[part="strip"]')).not.toBeNull();
  });
});

describe("what the strip asks the frame, and keeps", () => {
  test("a frame that could not answer is asked again at the next paint", async () => {
    frameUp = false;
    await paint();
    expect(asks).toHaveLength(1);
    frameUp = true;
    answers.set("${state.author ?? ''}", "Ada");
    await paint();
    expect(asks).toHaveLength(2);
    expect(drawn()).toBe("By {Author=Ada} on {Date=}!");
  });

  test("a value and a state value set for the canvas are each part of what was asked", async () => {
    await paint();
    await paint("By ${state.author ?? ''} on ${state.date}?");
    expect(asks).toHaveLength(2);
    tab.session.ui.stateValues = { author: "Bo" };
    await paint("By ${state.author ?? ''} on ${state.date}?");
    expect(asks).toHaveLength(3);
  });

  test("the oldest answers are dropped past the cap, so the first value is asked for again", async () => {
    await paint();
    for (let n = 0; n < 200; n += 1) {
      await paint(`N ${"${state.author}"} ${n}`);
    }
    const before = asks.length;
    await paint();
    expect(asks.length).toBe(before + 1);
    // A recent one is still held.
    await paint(`N ${"${state.author}"} 199`);
    expect(asks.length).toBe(before + 1);
  });

  test("an answer that arrives after the box left the page paints nothing", async () => {
    held = [];
    await paint();
    host.remove();
    answers.set("${state.author ?? ''}", "Ada");
    held[0]?.();
    await flush(6);
    expect(drawn()).toBe("By {Author=} on {Date=}!");
    document.body.append(host);
  });

  test("a row showing its characters shows tags for a value that is not text", async () => {
    await paint();
    control("raw-toggle").click();
    await flush(6);
    expect(host.querySelector('[part="raw"]')).not.toBeNull();
    paintTagStrip(host, {
      fieldKey: "prop|children/0|textContent",
      label: "Text Content",
      onChange: () => {},
      path: HEADING,
      slot: ["attributes", "title"],
      value: { $ref: "#/state/author" },
    });
    await flush(8);
    expect(host.querySelector('[part="raw"]')).toBeNull();
    expect(host.querySelector('[part="strip"]')).not.toBeNull();
  });

  test("showing the tags of one row leaves the others showing their characters", async () => {
    const other = document.createElement("div");
    document.body.append(other);
    const paintOther = async (): Promise<void> => {
      paintTagStrip(other, {
        fieldKey: "prop|children/0|other",
        label: "Other",
        onChange: () => {},
        path: HEADING,
        slot: ["textContent"],
        value: TEMPLATE,
      });
      await flush(8);
    };
    await paint();
    await paintOther();
    control("raw-toggle").click();
    other.querySelector<HTMLElement>('[part="raw-toggle"] [part="control"]')?.click();
    await flush(6);
    expect(host.querySelector('[part="raw"]')).not.toBeNull();
    expect(other.querySelector('[part="raw"]')).not.toBeNull();
    control("raw-toggle").click();
    await flush(6);
    expect(host.querySelector('[part="raw"]')).toBeNull();
    await paintOther();
    expect(other.querySelector('[part="raw"]')).not.toBeNull();
    unmountTagStrip(other);
    other.remove();
  });
});

describe("the strip's surface", () => {
  test("a repaint hands the press its newest actions", async () => {
    const first: (JsonValue | undefined)[] = [];
    const second: (JsonValue | undefined)[] = [];
    const draw = async (into: (JsonValue | undefined)[]): Promise<void> => {
      paintTagStrip(host, {
        fieldKey: "prop|children/0|textContent",
        label: "Text Content",
        onChange: (next) => into.push(next),
        path: HEADING,
        slot: ["textContent"],
        value: TEMPLATE,
      });
      await flush(8);
    };
    await draw(first);
    await draw(second);
    control("raw-toggle").click();
    await flush(6);
    const field = host.querySelector<HTMLTextAreaElement>('[part="raw"] textarea');
    field!.value = "Other";
    field!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(first).toEqual([]);
    expect(second).toEqual(["Other"]);
  });

  test("a box let go while its document is still arriving is left empty", async () => {
    host.append(document.createElement("hr"));
    paintTagStrip(host, {
      fieldKey: "prop|children/0|textContent",
      label: "Text Content",
      onChange: () => {},
      path: HEADING,
      slot: ["textContent"],
      value: TEMPLATE,
    });
    // The foreign content went at once; the strip is not there yet.
    expect(host.querySelector("hr")).toBeNull();
    unmountTagStrip(host);
    await flush(30);
    expect(host.querySelector('[part="strip"]')).toBeNull();
  });

  test("an answer that arrives after the box was let go does not draw the strip into it again", async () => {
    held = [];
    await paint();
    const claimed = document.createElement("p");
    unmountTagStrip(host);
    host.textContent = "";
    host.append(claimed);
    answers.set("${state.author ?? ''}", "Ada");
    held[0]?.();
    await flush(30);
    // Another control owns the box now.
    expect(host.querySelector('[part="strip"]')).toBeNull();
    expect(host.firstElementChild).toBe(claimed);
  });

  test("a strip whose box left the page is taken down by the next paint anywhere", async () => {
    await paint();
    expect(host.querySelector('[part="strip"]')).not.toBeNull();
    host.remove();
    const other = document.createElement("div");
    document.body.append(other);
    paintTagStrip(other, {
      fieldKey: "prop|children/0|other",
      label: "Other",
      onChange: () => {},
      path: HEADING,
      slot: ["textContent"],
      value: TEMPLATE,
    });
    await flush(8);
    expect(host.querySelector('[part="strip"]')).toBeNull();
    unmountTagStrip(other);
    other.remove();
    document.body.append(host);
  });
});
