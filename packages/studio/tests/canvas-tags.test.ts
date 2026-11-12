/**
 * Dynamic tags through the real canvas frame (`startCanvasIframe` over a fake channel; studio.md
 * §6.9, §4.5): the frame says which chip was pressed, evaluates a template in the scope a tag is
 * drawn in, counts a repeater's rows, puts a chip at the caret, and names chips by schema titles.
 *
 * The frame is the one under test here, with the runtime that draws the page. The host side of each
 * message is `tests/iframe-host.test.ts`.
 */
import "./with-dom.js";
import { afterEach, describe, expect, test } from "bun:test";
import { caretAt, flush } from "./harness";
import { fakeChannelPair } from "../src/canvas/iframe-channel";
import { startCanvasIframe } from "../src/canvas/iframe-entry";
import { prepareForEditMode } from "../src/utils/edit-display";
import { stripEventHandlers } from "../src/utils/strip-events";
import { catalog } from "@jxsuite/formulas";

import type {
  CanvasMode,
  IframeToParent,
  ParentToIframe,
  WireMapperCtx,
} from "../src/canvas/iframe-protocol";
import type { JxPath } from "../src/state";
import type { JxMutableNode, JxStateDefinition } from "@jxsuite/schema/types";

type Posted<K extends IframeToParent["kind"]> = Extract<IframeToParent, { kind: K }>;
type RenderMsg = Extract<ParentToIframe, { kind: "render" }>;

const POSTS: JxPath = ["children", 1];
const POST: JxPath = [...POSTS, "map"];
const HEADING: JxPath = [...POST, "children", 0];
const BYLINE: JxPath = [...POST, "children", 1];
const INTRO: JxPath = ["children", 0];
const TITLES = { "item.date": "Post date" };

function page(): JxMutableNode {
  return {
    children: [
      { tagName: "p", textContent: "Welcome to ${state.site}." },
      {
        $prototype: "Array",
        items: { $ref: "#/state/posts" },
        map: {
          children: [
            { tagName: "h3", textContent: "${$map.item.title ?? ''}" },
            { tagName: "p", textContent: "On ${item.date} by ${item.author}" },
          ],
          tagName: "article",
        },
      },
    ],
    state: {
      posts: [
        { author: "Ada", date: "2026-10-29T16:03:00Z", title: "One" },
        { author: "Bo", date: "2026-10-22T16:03:00Z", title: "Two" },
        { author: "Cy", date: "2026-10-15T16:03:00Z", title: "Three" },
      ],
      site: "the blog",
    },
    tagName: "main",
  };
}

/** The mapper context of a page drawn alone, in `mode`. */
function wireCtx(mode: CanvasMode): WireMapperCtx {
  return {
    canvasMode: mode,
    layoutWrapped: false,
    pageContentOffset: null,
    pageContentPrefix: null,
  };
}

interface Frame {
  container: HTMLElement;
  of: <K extends IframeToParent["kind"]>(kind: K) => Posted<K>[];
  send: (msg: ParentToIframe) => Promise<void>;
  settle: () => Promise<void>;
  gen: () => number;
}

let teardown: (() => void) | undefined;
afterEach(() => {
  teardown?.();
  teardown = undefined;
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

/** Boot a frame and draw `doc` in it, prepared as `resolveCanvasDocument` prepares a document. */
async function frameWith(
  doc: JxMutableNode,
  extra: Partial<RenderMsg> = {},
  mode: CanvasMode = "edit",
): Promise<Frame> {
  const pair = fakeChannelPair<ParentToIframe, IframeToParent>();
  const posted: IframeToParent[] = [];
  pair.parent.onMessage((m) => posted.push(m));
  const container = document.createElement("div");
  document.body.append(container);
  const stop = startCanvasIframe({ channel: pair.iframe, container });
  const earlier = teardown;
  teardown = () => {
    stop();
    earlier?.();
  };
  const settle = async (): Promise<void> => {
    pair.flush();
    await flush();
    pair.flush();
  };
  const send = (msg: ParentToIframe): Promise<void> => {
    pair.parent.post(msg);
    return settle();
  };
  pair.flush();
  const raw = structuredClone(doc);
  const drawn = prepareForEditMode(stripEventHandlers(raw), extra.tagTitles ?? null);
  await send({
    colorScheme: null,
    doc: structuredClone(drawn),
    docBase: "http://localhost:3000/",
    gen: 1,
    kind: "render",
    mapperCtx: wireCtx(mode),
    mode,
    shadowDoc: structuredClone(raw),
    siteStyle: null,
    ...extra,
  });
  return {
    container,
    gen: () => 1,
    of: (kind) => posted.filter((m): m is Posted<typeof kind> => m.kind === kind),
    send,
    settle,
  };
}

/** The one element that carries `path` as `data-jx-path`. */
function addressable(root: ParentNode, path: JxPath): HTMLElement {
  const key = JSON.stringify(path);
  const found = [...root.querySelectorAll<HTMLElement>("[data-jx-path]")].find(
    (el) => el.dataset.jxPath === key,
  );
  if (!found) {
    throw new Error(`no element at ${key}`);
  }
  return found;
}

/** One animation frame: the hover report is posted on the next one. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/** A press and the click that follows it, as a pointer makes them. */
function press(el: Element): void {
  el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** Ask the frame what templates resolve to at `path`, and answer with its reply. */
async function evaluate(
  frame: Frame,
  request: Partial<Extract<ParentToIframe, { kind: "evalTemplate" }>>,
): Promise<Posted<"templateResult">> {
  const reqId = frame.of("templateResult").length + 1;
  await frame.send({
    gen: frame.gen(),
    kind: "evalTemplate",
    path: null,
    reqId,
    templates: [],
    ...request,
  });
  const reply = frame.of("templateResult").find((message) => message.reqId === reqId);
  if (!reply) {
    throw new Error("the frame did not answer");
  }
  return reply;
}

/** The state entry a packaged formula is vendored as. */
function packaged(name: string): JxStateDefinition {
  const formula = catalog.find((entry) => entry.name === name);
  if (!formula) {
    throw new TypeError(`no packaged formula ${name}`);
  }
  return { $expression: formula.expression, parameters: formula.parameters };
}

describe("the frame announces what it understands", () => {
  test("`tags` is among its capabilities", async () => {
    const frame = await frameWith(page());
    expect(frame.of("ready")[0]?.capabilities).toContain("tags");
  });
});

describe("evalTemplate", () => {
  test("resolves in the scope the node at the path is drawn with: the active row's", async () => {
    const frame = await frameWith(page());
    const first = await evaluate(frame, {
      path: HEADING,
      templates: [
        { id: "title", template: "${$map.item.title ?? ''}" },
        { id: "site", template: "${state.site}" },
      ],
    });
    expect(first.results).toEqual([
      { id: "title", text: "One", type: "string" },
      { id: "site", text: "the blog", type: "string" },
    ]);
    expect(first.gen).toBe(1);
    await frame.send({ kind: "setActiveRows", rows: { [JSON.stringify(POSTS)]: 2 } });
    const third = await evaluate(frame, {
      path: HEADING,
      templates: [{ id: "title", template: "${item.title}" }],
    });
    expect(third.results).toEqual([{ id: "title", text: "Three", type: "string" }]);
  });

  test("outside a row, and with no path at all, it is the page's scope", async () => {
    const frame = await frameWith(page());
    const templates = [
      { id: "site", template: "${state.site}" },
      { id: "row", template: "${item.title}" },
    ];
    for (const path of [INTRO, null, ["children", 9, "nowhere"]]) {
      const reply = await evaluate(frame, { path, templates });
      expect(reply.results[0]).toEqual({ id: "site", text: "the blog", type: "string" });
      // No row to read: the expression throws, and says so.
      expect(reply.results[1]?.error).toBeString();
    }
  });

  test("a formula the document does not hold is defined for the one evaluation", async () => {
    const frame = await frameWith(page());
    const reply = await evaluate(frame, {
      formulas: { formatDate: packaged("formatDate") },
      path: BYLINE,
      templates: [{ id: "long", template: '${state.formatDate(item.date, {"dateStyle":"long"})}' }],
    });
    expect(reply.results).toEqual([{ id: "long", text: "October 29, 2026", type: "string" }]);
    const without = await evaluate(frame, {
      path: BYLINE,
      templates: [{ id: "long", template: "${state.formatDate(item.date)}" }],
    });
    expect(without.results[0]?.error).toBeString();
  });

  test("a request about another render is answered with nothing", async () => {
    const frame = await frameWith(page());
    const reply = await evaluate(frame, {
      gen: 9,
      path: HEADING,
      repeater: POSTS,
      templates: [{ id: "title", template: "${item.title}" }],
    });
    expect(reply.results).toEqual([]);
    expect(reply.rows).toBeNull();
  });

  test("says how many rows a repeater draws, when asked", async () => {
    const frame = await frameWith(page());
    const all = await evaluate(frame, { repeater: POSTS });
    expect(all.rows).toEqual({ active: 0, drawn: 3, total: 3 });
    const none = await evaluate(frame, {});
    expect(none.rows).toBeUndefined();
    const missing = await evaluate(frame, { repeater: ["children", 7] });
    expect(missing.rows).toBeNull();
  });

  test("a list the row cap cut short says how many items it has", async () => {
    const frame = await frameWith(page(), { rowLimit: 2 });
    const reply = await evaluate(frame, { repeater: POSTS });
    expect(reply.rows).toEqual({ active: 0, drawn: 2, total: 3 });
  });
});

describe("evalTemplate in nested repeaters", () => {
  function nested(): JxMutableNode {
    return {
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/groups" },
          map: {
            children: [
              { tagName: "h4", textContent: "${item.name}" },
              {
                $prototype: "Array",
                items: { $ref: "$map/item/members" },
                map: { tagName: "li", textContent: "${$map.item} of ${item.name}" },
              },
            ],
            tagName: "section",
          },
        },
      ],
      state: {
        groups: [
          { members: ["a", "b"], name: "G1" },
          { members: ["c"], name: "G2" },
        ],
      },
      tagName: "main",
    };
  }

  test("a tag in the inner repeater reads the inner row, and one beside it the outer", async () => {
    const frame = await frameWith(nested());
    const inner: JxPath = ["children", 0, "map", "children", 1, "map"];
    const outer: JxPath = ["children", 0, "map", "children", 0];
    const reply = await evaluate(frame, {
      path: inner,
      templates: [{ id: "x", template: "${$map.item}" }],
    });
    expect(reply.results[0]?.text).toBe("a");
    const above = await evaluate(frame, {
      path: outer,
      templates: [{ id: "x", template: "${$map.item.name}" }],
    });
    expect(above.results[0]?.text).toBe("G1");
    // Another outer row, by the active rows: the inner scope is that row's own.
    await frame.send({
      kind: "setActiveRows",
      rows: { [JSON.stringify(["children", 0])]: 1 },
    });
    const second = await evaluate(frame, {
      path: inner,
      templates: [{ id: "x", template: "${$map.item}" }],
    });
    expect(second.results[0]?.text).toBe("c");
  });
});

describe("tagClick", () => {
  test("a click on a chip says which chip of which block, after the hit", async () => {
    const frame = await frameWith(page());
    const byline = addressable(frame.container, BYLINE);
    const chips = [...byline.querySelectorAll("data[data-jx-tag]")];
    press(chips[1]!);
    await frame.settle();
    const [click] = frame.of("tagClick");
    expect(click).toMatchObject({
      active: false,
      occurrence: 0,
      path: BYLINE,
      ref: null,
      source: "${item.author}",
    });
    expect([frame.of("hit").length, frame.of("tagClick").length]).toEqual([1, 1]);
  });

  test("a chip in a block that already held the caret says so", async () => {
    const frame = await frameWith(page());
    const intro = addressable(frame.container, INTRO);
    caretAt(intro.firstChild!, 3);
    await frame.settle();
    expect(intro.dataset.jxActiveBlock).toBe("");
    press(intro.querySelector("data[data-jx-tag]")!);
    await frame.settle();
    expect(frame.of("tagClick")[0]).toMatchObject({
      active: true,
      path: INTRO,
      source: "${state.site}",
    });
  });

  test("a click off a chip posts none", async () => {
    const frame = await frameWith(page());
    press(addressable(frame.container, POST));
    await frame.settle();
    expect(frame.of("tagClick")).toEqual([]);
  });

  test("a press in an echo row makes the row active, and its chip is then that block's", async () => {
    const frame = await frameWith(page());
    const echo = [...frame.container.querySelectorAll<HTMLElement>("[data-jx-echo-path]")].find(
      (el) => el.dataset.jxEchoPath === JSON.stringify(HEADING) && el.textContent === "Two",
    );
    press(echo!.querySelector("data[data-jx-tag]")!);
    await frame.settle();
    expect(frame.of("rowActivated")).toEqual([{ kind: "rowActivated", path: POSTS, row: 1 }]);
    expect(frame.of("tagClick")[0]).toMatchObject({ active: false, path: HEADING });
  });
});

describe("the hover label", () => {
  test("a hover over a bound block carries what it draws from data, and a plain block nothing", async () => {
    const plain: JxMutableNode = {
      children: [
        { tagName: "h2", textContent: "${state.title} by ${state.author}" },
        { tagName: "p", textContent: "Plain" },
      ],
      state: { author: "Ada", title: "One" },
      tagName: "main",
    };
    const frame = await frameWith(plain);
    addressable(frame.container, ["children", 0]).dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true }),
    );
    await nextFrame();
    await frame.settle();
    addressable(frame.container, ["children", 1]).dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true }),
    );
    await nextFrame();
    await frame.settle();
    expect(frame.of("hover").map((message) => message.hit?.bound)).toEqual([
      "Title · Author",
      undefined,
    ]);
  });

  test("no rule of the frame's own draws a label on a bound block", async () => {
    const frame = await frameWith(page());
    const sheet = [...document.head.querySelectorAll("style")]
      .map((style) => style.textContent)
      .join("\n");
    expect(addressable(frame.container, HEADING).dataset.jxBoundField).toBe("Title");
    expect(sheet).not.toContain("content: attr(data-jx-bound-field)");
  });
});

describe("a chip placed at the caret", () => {
  test("Insert puts a chip in the block, and the commit that stores it is drawn again", async () => {
    const frame = await frameWith(page());
    const intro = addressable(frame.container, INTRO);
    caretAt(intro.firstChild!, 7);
    await frame.settle();
    await frame.send({
      intent: { command: "insertData", token: "state.site" },
      kind: "applyFormat",
    });
    const chips = [
      ...addressable(frame.container, INTRO).querySelectorAll<HTMLElement>("data[data-jx-tag]"),
    ];
    expect(chips.map((chip) => chip.dataset.jxTag)).toEqual(["${state.site}", "${state.site}"]);
    // What the caret holds is committed (a save does this): the chip is written as its expression.
    await frame.send({ kind: "flushEdits", reqId: 1 });
    const commit = frame.of("editCommit").at(-1);
    expect(commit?.textContent).toBe("Welcome${state.site} to ${state.site}.");
    // Not left in place: the chip is empty until the runtime draws it.
    expect(commit?.inPlace).toBeUndefined();
  });

  test("the keyboard goes back to the text, with the caret after the chip", async () => {
    const frame = await frameWith(page());
    const intro = addressable(frame.container, INTRO);
    caretAt(intro.firstChild!, 7);
    await frame.settle();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    await frame.send({
      intent: { command: "insertData", token: "state.site" },
      kind: "applyFormat",
    });
    const block = addressable(frame.container, INTRO);
    expect(document.activeElement).toBe(block);
    const caret = document.getSelection();
    const chip = block.querySelector("data[data-jx-tag]");
    expect(caret?.anchorNode).toBe(chip?.nextSibling);
  });
});

describe("a chip placed at the caret, then typing", () => {
  test("only the commit that stores the chip draws the block again; the next one does not", async () => {
    const frame = await frameWith(page());
    const intro = addressable(frame.container, INTRO);
    caretAt(intro.firstChild!, 7);
    await frame.settle();
    await frame.send({
      intent: { command: "insertData", token: "state.site" },
      kind: "applyFormat",
    });
    await frame.send({ kind: "flushEdits", reqId: 1 });
    expect(frame.of("editCommit").at(-1)?.inPlace).toBeUndefined();
    // The author types after it: that commit leaves the block in place, as typing always does.
    const block = addressable(frame.container, INTRO);
    const text = block.lastChild!;
    text.nodeValue = `${text.nodeValue ?? ""} More`;
    caretAt(text, text.nodeValue.length);
    block.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    await frame.settle();
    await frame.send({ kind: "flushEdits", reqId: 2 });
    expect(frame.of("editCommit").at(-1)?.inPlace).toBe(true);
  });
});

describe("schema titles", () => {
  test("a chip a block draws again as a string member is named the same", async () => {
    const doc = page();
    // A bare `item` is the state's here: no row is drawn around this block.
    doc.state = { ...doc.state, item: { date: "2026-10-29" } };
    const [intro, repeater] = Array.isArray(doc.children) ? doc.children : [];
    doc.children = [{ children: [{ tagName: "b" }], tagName: "div" }, intro ?? "", repeater ?? ""];
    const frame = await frameWith(doc, { tagTitles: TITLES });
    const holder: JxPath = ["children", 0];
    await frame.send({
      forwardOps: [{ index: 1, node: "At ${item.date}", op: "insert-child", parentPath: holder }],
      gen: 1,
      kind: "patch",
    });
    expect(frame.of("patchError")).toEqual([]);
    const chip = addressable(frame.container, holder).querySelector<HTMLElement>(
      'data[data-jx-tag="${item.date}"]',
    );
    expect(chip?.dataset.jxTagLabel).toBe("Post date");
  });

  test("Insert names its chip by the field's title", async () => {
    const frame = await frameWith(page(), { tagTitles: TITLES });
    const byline = addressable(frame.container, BYLINE);
    caretAt(byline.firstChild!, 1);
    await frame.settle();
    await frame.send({
      intent: { command: "insertData", token: "item.date" },
      kind: "applyFormat",
    });
    const labels = [
      ...addressable(frame.container, BYLINE).querySelectorAll<HTMLElement>("data"),
    ].flatMap((chip) => (chip.dataset.jxTag === "${item.date}" ? [chip.dataset.jxTagLabel] : []));
    expect(labels).toContain("Post date");
    expect(labels.every((label) => label === "Post date")).toBe(true);
  });

  test("a chip is named by its field's title, and still is after its block is drawn again", async () => {
    const frame = await frameWith(page(), { tagTitles: TITLES });
    const labels = (): (string | null)[] =>
      [
        ...addressable(frame.container, BYLINE).querySelectorAll<HTMLElement>("data[data-jx-tag]"),
      ].map((chip) => chip.dataset.jxTagLabel ?? null);
    expect(labels()).toEqual(["Post date", "Author"]);
    // A text edit to a bound node draws the node again, in the frame, from the document.
    await frame.send({
      forwardOps: [
        {
          key: "textContent",
          op: "set-key",
          path: BYLINE,
          value: "Posted ${item.date} by ${item.author}",
        },
      ],
      gen: 1,
      kind: "patch",
    });
    expect(addressable(frame.container, BYLINE).textContent).toContain("Posted ");
    expect(labels()).toEqual(["Post date", "Author"]);
  });
});
