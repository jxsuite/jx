/**
 * A repeater draws its rows (studio.md §4.5), end to end through the canvas frame: the runtime
 * renders one instance of the template per item, exactly one row is addressable, a patch reaches
 * every row with that row's own scope, and a press in another row makes it the addressable one.
 *
 * The fixture is the repeater of the converted Anabaptist Perspectives site's
 * `pages/dev-episodes.json`, as the converter wrote it: lambdas, an object-literal argument, a
 * row-bound `hidden`, a row-bound image. Nothing in it was simplified for the test.
 */
import "./with-dom.js";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { flush, resetWorkspaceWithTab, stubRect } from "./harness";
import { fakeChannelPair } from "../src/canvas/iframe-channel";
import { startCanvasIframe } from "../src/canvas/iframe-entry";
import { DEFAULT_ROW_LIMIT } from "../src/canvas/iframe-protocol";
import { rowsOf } from "../src/canvas/path-mapping";
import { getNodeAtPath } from "../src/state";
import { defineElement } from "@jxsuite/runtime";
import { applyInlineCommit } from "../src/editor/inline-edit-apply";
import { getActiveElement, isEditing } from "../src/editor/inline-edit";
import { prepareForEditMode } from "../src/utils/edit-display";
import { stripEventHandlers } from "../src/utils/strip-events";
import { isNodeObject, isString } from "@jxsuite/schema/guards";
import REPEATER from "./fixtures/dev-episodes-repeater.json" with { type: "json" };
import type { CommitRefused } from "../src/editor/inline-edit-apply";
import type {
  CanvasMode,
  IframeToParent,
  ParentToIframe,
  WireMapperCtx,
} from "../src/canvas/iframe-protocol";
import type { JxDocOp } from "../src/tabs/patch-ops";
import type { JxPath } from "../src/state";
import type { JsonValue, JxMutableNode } from "@jxsuite/schema/types";

type RenderMsg = Extract<ParentToIframe, { kind: "render" }>;
type Posted<K extends IframeToParent["kind"]> = Extract<IframeToParent, { kind: K }>;

/** One entry of the `episode` collection, as the content loader hands it to the page. */
interface Episode {
  data: {
    author?: string;
    date?: string;
    featuredImage?: { alt?: string; src: string };
    id?: string;
    premium?: boolean;
    title: string;
    url: string;
  };
}

const EPISODES: Episode[] = [
  {
    data: {
      author: "Reagan Schrock",
      date: "2023-08-22T18:58:54.000Z",
      featuredImage: { alt: "Two chairs", src: "/media/2023/08/chairs.jpeg" },
      id: "212",
      premium: true,
      title: "How Do We Read the Sermon on the Mount?",
      url: "/episode/sermon-on-the-mount/",
    },
  },
  {
    data: {
      author: "Marlin Sommers",
      date: "2022-01-11T12:00:00.000Z",
      id: "147",
      title: "Church History for Ordinary People",
      url: "/episode/church-history/",
    },
  },
  {
    data: {
      author: "Kyle Stoltzfus",
      date: "2021-02-03T12:00:00.000Z",
      featuredImage: { src: "/media/2021/02/brotherhood.jpeg" },
      title: "Covid-19 and Brotherhood",
      url: "/episode/covid-19-and-brotherhood/",
    },
  },
];

/** Where the repeater sits in {@link pageOf}'s document, and the paths of what the tests address. */
const LIST: JxPath = ["children", 1, "children", 0];
const ROW: JxPath = [...LIST, "map"];
const BODY: JxPath = [...ROW, "children", 0, "children", 0, "children", 1];
const HEADING: JxPath = [...BODY, "children", 1];
const DATE: JxPath = [...BODY, "children", 2, "children", 1, "children", 1];
const AUTHOR: JxPath = [...BODY, "children", 2, "children", 2, "children", 1];
const LINK: JxPath = [...ROW, "children", 0];
const IMAGE: JxPath = [...ROW, "children", 0, "children", 0, "children", 0, "children", 0];

/** A page holding the site's repeater over `episodes`, between a heading and a footer. */
function pageOf(episodes: readonly Episode[] | null): JxMutableNode {
  /* SAFETY: the fixture is the Array node of a Jx page, read off disk as JSON: a document value in
     all but the type the JSON import infers for it. */
  const repeater = structuredClone(REPEATER) as JxMutableNode;
  return {
    children: [
      { tagName: "h1", textContent: "Episodes" },
      { children: [repeater], className: "query", tagName: "div" },
      { tagName: "footer", textContent: "End" },
    ],
    /* SAFETY: a state entry is a JSON value; the episodes are plain data. */
    state: { episode_q1: episodes as JsonValue },
    tagName: "main",
  };
}

const WIRE_CTX: WireMapperCtx = {
  canvasMode: "edit",
  layoutWrapped: false,
  pageContentOffset: null,
  pageContentPrefix: null,
};

/** A frame under test: its container, what it posted, and the verbs a host has. */
interface Frame {
  container: HTMLElement;
  posted: IframeToParent[];
  shadow: JxMutableNode;
  /** Every message of `kind` the frame has posted. */
  of: <K extends IframeToParent["kind"]>(kind: K) => Posted<K>[];
  /** Post a message into the frame and let it settle. */
  send: (msg: ParentToIframe) => Promise<void>;
  /** Deliver what the frame has posted since, and let anything it started finish. */
  settle: () => Promise<void>;
  /** Apply forward ops as a patch against the live render. */
  patch: (forwardOps: JxDocOp[], echoPaths?: JxPath[]) => Promise<void>;
  /** Draw `doc` as a new render. */
  render: (doc: JxMutableNode, extra?: Partial<RenderMsg>) => Promise<void>;
}

let teardown: (() => void) | undefined;
afterEach(() => {
  teardown?.();
  teardown = undefined;
  document.body.innerHTML = "";
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
  /* Every frame a test boots is stopped, not only the last: a frame left running keeps its
     listeners on the shared document and answers the next test's presses as well. */
  const stop = startCanvasIframe({ channel: pair.iframe, container });
  const earlier = teardown;
  teardown = () => {
    stop();
    earlier?.();
  };
  let gen = 0;
  const settle = async (): Promise<void> => {
    pair.flush();
    await flush();
    pair.flush();
  };
  const send = (msg: ParentToIframe): Promise<void> => {
    pair.parent.post(msg);
    return settle();
  };
  const frame: Frame = {
    container,
    of: (kind) => posted.filter((m): m is Posted<typeof kind> => m.kind === kind),
    patch: (forwardOps, echoPaths) => {
      const msg: Extract<ParentToIframe, { kind: "patch" }> = { forwardOps, gen, kind: "patch" };
      if (echoPaths) {
        msg.echoPaths = echoPaths;
      }
      return send(msg);
    },
    posted,
    render: async (next, more = {}) => {
      gen += 1;
      const raw = structuredClone(next);
      frame.shadow = raw;
      const drawn = prepareForEditMode(stripEventHandlers(raw));
      await send({
        colorScheme: null,
        doc: structuredClone(drawn),
        docBase: "http://localhost:3000/",
        gen,
        kind: "render",
        mapperCtx: { ...WIRE_CTX, canvasMode: mode },
        mode,
        shadowDoc: structuredClone(raw),
        siteStyle: null,
        ...more,
      });
    },
    send,
    settle,
    shadow: doc,
  };
  pair.flush();
  await frame.render(doc, extra);
  return frame;
}

/** Every element drawn for `path`, addressable or echo, in document order. */
function instances(root: ParentNode, path: JxPath): HTMLElement[] {
  const key = JSON.stringify(path);
  return [...root.querySelectorAll<HTMLElement>("[data-jx-path],[data-jx-echo-path]")].filter(
    (el) => (el.dataset.jxPath ?? el.dataset.jxEchoPath) === key,
  );
}

/** The one element that carries `path` as `data-jx-path`. Throws when there is not exactly one. */
function addressable(root: ParentNode, path: JxPath): HTMLElement {
  const key = JSON.stringify(path);
  const found = [...root.querySelectorAll<HTMLElement>("[data-jx-path]")].filter(
    (el) => el.dataset.jxPath === key,
  );
  if (found.length !== 1) {
    throw new Error(`expected one element at ${key}, found ${found.length}`);
  }
  return found[0]!;
}

/** Every `data-jx-path` value held by more than one element. Empty is the invariant. */
function duplicatePaths(root: ParentNode): string[] {
  const seen = new Map<string, number>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-jx-path]")) {
    const key = el.dataset.jxPath ?? "";
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen].flatMap(([key, count]) => (count > 1 ? [key] : []));
}

/** The row each stamped element under `root` says it was drawn in, by its first coordinate. */
function rowOf(el: HTMLElement): number {
  return rowsOf(el)[0] ?? -1;
}

/** Dispatch the press and the click a pointer makes on `el`, as the frame's listeners hear them. */
function press(el: Element): void {
  el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("the dev-episodes repeater draws its rows", () => {
  test("three rows resolve, each against its own item", async () => {
    const { container } = await frameWith(pageOf(EPISODES));
    expect(instances(container, ROW)).toHaveLength(3);
    expect(instances(container, HEADING).map((el) => el.textContent)).toEqual(
      EPISODES.map((episode) => episode.data.title),
    );
    expect(instances(container, AUTHOR).map((el) => el.textContent)).toEqual([
      "Reagan Schrock",
      "Marlin Sommers",
      "Kyle Stoltzfus",
    ]);
    // The canvas de-links an anchor in every row, the echo rows' as much as the active one's.
    expect(instances(container, LINK).map((el) => el.dataset.jxHref)).toEqual(
      EPISODES.map((episode) => episode.data.url),
    );
    expect(instances(container, LINK).some((el) => el.hasAttribute("href"))).toBe(false);
    // A row-bound image is the row's picture, and the row without one falls back as the page does.
    expect(instances(container, IMAGE).map((el) => el.getAttribute("src"))).toEqual([
      "/media/2023/08/chairs.jpeg",
      "/media/2021/02/Covid19-and-Brotherhood.jpeg",
      "/media/2021/02/brotherhood.jpeg",
    ]);
    // The premium badge follows its own row: shown for the first, hidden for the other two.
    expect(
      [...container.querySelectorAll(".pill")].map((pill) => pill.hasAttribute("hidden")),
    ).toEqual([false, true, true]);
    // No expression text reaches the page.
    expect(container.textContent).not.toContain("${");
    expect(container.textContent).not.toContain("$map");
  });

  test("the date tag with an object-literal argument renders intact", async () => {
    const { container } = await frameWith(pageOf(EPISODES));
    /* SAFETY: the template's nodes are plain JSON objects; the walk reads the one date node. */
    const template = (REPEATER as { map: JxMutableNode }).map;
    let source = "";
    (function find(node: JxMutableNode | string): void {
      if (!isNodeObject(node)) {
        return;
      }
      if (isString(node.textContent) && node.textContent.includes("DateTimeFormat")) {
        source = node.textContent;
      }
      for (const child of Array.isArray(node.children) ? node.children : []) {
        find(child);
      }
    })(template);
    // The expression holds `{timeZone:'America/New_York',…}`: a brace a naive splitter cut at.
    expect(source).toContain("{timeZone:'America/New_York'");
    const dates = instances(container, DATE);
    expect(dates.map((el) => el.textContent)).toEqual([
      "August 22, 2023",
      "January 11, 2022",
      "February 3, 2021",
    ]);
    for (const el of dates) {
      const chip = el.querySelector<HTMLElement>("data[data-jx-tag]");
      // One chip, carrying the whole expression verbatim, named as code the grammar does not read.
      expect(el.querySelectorAll("data[data-jx-tag]")).toHaveLength(1);
      expect(chip?.dataset.jxTag).toBe(source);
      expect(chip?.dataset.jxTagKind).toBe("custom");
      expect(chip?.getAttribute("contenteditable")).toBe("false");
    }
  });

  test("one addressable element per document path, and every other row an echo closed to the caret", async () => {
    const { container } = await frameWith(pageOf(EPISODES));
    expect(duplicatePaths(container)).toEqual([]);
    // Each node of the template is drawn three times and addressable once: in the first row.
    for (const path of [ROW, LINK, HEADING, DATE, AUTHOR, IMAGE]) {
      const drawn = instances(container, path);
      expect(drawn.map((el) => rowOf(el))).toEqual([0, 1, 2]);
      expect(drawn.map((el) => el.dataset.jxPath !== undefined)).toEqual([true, false, false]);
      expect(addressable(container, path)).toBe(drawn[0]!);
    }
    const rows = instances(container, ROW);
    expect(rows.map((row) => row.getAttribute("contenteditable"))).toEqual([
      null,
      "false",
      "false",
    ]);
    // Outside the repeater nothing carries a row at all.
    expect(addressable(container, ["children", 0]).dataset.jxRow).toBeUndefined();
  });

  test("a set-key on a map path updates every row with its own row's values", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    await frame.patch([
      {
        key: "textContent",
        op: "set-key",
        path: HEADING,
        value: "Episode: ${$map.item.data.title ?? ''}",
      },
    ]);
    expect(frame.of("patchError")).toEqual([]);
    // Every row was drawn again, and each with ITS item: not the page's scope, not the first row's.
    expect(instances(frame.container, HEADING).map((el) => el.textContent)).toEqual(
      EPISODES.map((episode) => `Episode: ${episode.data.title}`),
    );
    expect(duplicatePaths(frame.container)).toEqual([]);
    expect(instances(frame.container, HEADING).map((el) => rowOf(el))).toEqual([0, 1, 2]);

    // An attribute op re-renders the node; a style op re-emits in place. Both reach every row.
    await frame.patch([
      {
        key: "attributes",
        op: "set-key",
        path: AUTHOR,
        value: { title: "By ${$map.item.data.author}" },
      },
      { key: "style", op: "set-key", path: HEADING, value: { order: "${$map.index + 1}" } },
    ]);
    expect(frame.of("patchError")).toEqual([]);
    expect(instances(frame.container, AUTHOR).map((el) => el.getAttribute("title"))).toEqual([
      "By Reagan Schrock",
      "By Marlin Sommers",
      "By Kyle Stoltzfus",
    ]);
    expect(
      instances(frame.container, HEADING).map((el) => el.style.getPropertyValue("--jx-s0")),
    ).toEqual(["1", "2", "3"]);

    // Literal text is the same text in every row.
    await frame.patch([{ key: "textContent", op: "set-key", path: HEADING, value: "Listen" }]);
    expect(instances(frame.container, HEADING).map((el) => el.textContent)).toEqual([
      "Listen",
      "Listen",
      "Listen",
    ]);
    expect(duplicatePaths(frame.container)).toEqual([]);
  });

  test("a commit of a row's resolved text to a bound node is refused", () => {
    const tab = resetWorkspaceWithTab(pageOf(EPISODES));
    const refused = mock<CommitRefused>();
    // What row 3's heading SHOWS, offered as its source: the write the whole design exists to stop.
    applyInlineCommit(tab, HEADING, null, "Covid-19 and Brotherhood", { onRefused: refused });
    expect(refused.mock.calls).toEqual([[HEADING, "lost"]]);
    const stored = (path: JxPath) => getNodeAtPath(tab.doc.document, path);
    expect(stored(HEADING)?.textContent).toBe("${$map.item.data.title ?? ''}");
    // Text typed BESIDE the binding keeps it, and is written to the template.
    applyInlineCommit(tab, HEADING, null, "New: ${$map.item.data.title ?? ''}", {
      onRefused: refused,
    });
    expect(refused).toHaveBeenCalledTimes(1);
    expect(stored(HEADING)?.textContent).toBe("New: ${$map.item.data.title ?? ''}");
  });
});

describe("a press in an echo row makes it the active row", () => {
  test("the stamps are renamed, the host is told, and the press lands on the pressed element", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    const { container } = frame;
    const third = instances(container, HEADING)[2]!;
    expect(third.dataset.jxPath).toBeUndefined();

    press(third);
    await frame.settle();

    // No node was drawn again: the pressed element is the same one, now addressable.
    expect(addressable(container, HEADING)).toBe(third);
    expect(third.dataset.jxEchoPath).toBeUndefined();
    expect(duplicatePaths(container)).toEqual([]);
    // The whole row moved with it, and the row that was active is an echo, closed to the caret.
    for (const path of [ROW, LINK, HEADING, DATE, AUTHOR, IMAGE]) {
      expect(instances(container, path).map((el) => el.dataset.jxPath !== undefined)).toEqual([
        false,
        false,
        true,
      ]);
    }
    expect(instances(container, ROW).map((row) => row.getAttribute("contenteditable"))).toEqual([
      "false",
      "false",
      null,
    ]);
    // The host hears the row before the hit, and the hit is an ordinary one, by document path.
    const kinds = frame.posted
      .map((m) => m.kind)
      .filter((k) => k === "rowActivated" || k === "hit");
    expect(kinds).toEqual(["rowActivated", "hit"]);
    expect(frame.of("rowActivated")).toEqual([{ kind: "rowActivated", path: LIST, row: 2 }]);
    expect(frame.of("hit")[0]?.hit.path).toEqual(HEADING);
  });

  test("a press in the active row, or outside any row, promotes nothing", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    press(instances(frame.container, HEADING)[0]!);
    press(addressable(frame.container, ["children", 0]));
    await frame.settle();
    expect(frame.of("rowActivated")).toEqual([]);
    expect(instances(frame.container, ROW).map((el) => el.dataset.jxPath !== undefined)).toEqual([
      true,
      false,
      false,
    ]);
  });

  test("the active row survives a render, and a patch after a promotion keeps paths unique", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    press(instances(frame.container, AUTHOR)[1]!);
    await frame.settle();
    // The host records the row on the tab and sends it with the next render.
    await frame.render(pageOf(EPISODES), { activeRows: { [JSON.stringify(LIST)]: 1 } });
    expect(instances(frame.container, ROW).map((el) => el.dataset.jxPath !== undefined)).toEqual([
      false,
      true,
      false,
    ]);
    await frame.patch([
      { key: "textContent", op: "set-key", path: AUTHOR, value: "by ${$map.item.data.author}" },
    ]);
    expect(frame.of("patchError")).toEqual([]);
    expect(duplicatePaths(frame.container)).toEqual([]);
    expect(rowOf(addressable(frame.container, AUTHOR))).toBe(1);
    expect(instances(frame.container, AUTHOR).map((el) => el.textContent)).toEqual([
      "by Reagan Schrock",
      "by Marlin Sommers",
      "by Kyle Stoltzfus",
    ]);
  });

  test("setActiveRows applies the host's map in place, and saying it twice changes nothing", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    const before = instances(frame.container, HEADING);
    await frame.send({ kind: "setActiveRows", rows: { [JSON.stringify(LIST)]: 2 } });
    // Renamed, not rendered: the same three elements, the third now the addressable one.
    expect(instances(frame.container, HEADING).every((el, i) => el === before[i])).toBe(true);
    expect(addressable(frame.container, HEADING)).toBe(before[2]!);
    expect(frame.of("renderComplete")).toHaveLength(1);
    await frame.send({ kind: "setActiveRows", rows: { [JSON.stringify(LIST)]: 2 } });
    expect(addressable(frame.container, HEADING)).toBe(before[2]!);
    // A row the list does not have is clamped to its last, so the path stays addressable.
    await frame.send({ kind: "setActiveRows", rows: { [JSON.stringify(LIST)]: 40 } });
    expect(addressable(frame.container, HEADING)).toBe(before[2]!);
    // And an empty map is every repeater back on its first row.
    await frame.send({ kind: "setActiveRows", rows: {} });
    expect(addressable(frame.container, HEADING)).toBe(before[0]!);
    expect(duplicatePaths(frame.container)).toEqual([]);
  });

  test("a caret session ends when its row stops being the active one", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    const [first, , third] = instances(frame.container, AUTHOR);
    // A caret in the first row's author line opens a session on it.
    const range = document.createRange();
    range.selectNodeContents(first!);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    expect(isEditing()).toBe(true);
    expect(getActiveElement()).toBe(first!);

    press(third!);
    await frame.settle();
    expect(isEditing()).toBe(false);
    expect(frame.of("editEnd").length).toBeGreaterThan(0);
    expect(addressable(frame.container, AUTHOR)).toBe(third!);
  });

  test("and so it does when the host names another row", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    const [first, second] = instances(frame.container, AUTHOR);
    const range = document.createRange();
    range.selectNodeContents(first!);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    expect(getActiveElement()).toBe(first!);
    // The same map leaves the caret where it is: nothing changed.
    await frame.send({ kind: "setActiveRows", rows: {} });
    expect(isEditing()).toBe(true);
    await frame.send({ kind: "setActiveRows", rows: { [JSON.stringify(LIST)]: 1 } });
    expect(isEditing()).toBe(false);
    expect(addressable(frame.container, AUTHOR)).toBe(second!);
  });
});

describe("the caret's own edit reaches the other rows", () => {
  /** Put a caret in `el`, as a click there does. */
  function caretIn(el: HTMLElement): void {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }

  /** The op a commit of `text` to the heading comes back as. */
  const headingOp = (text: string): JxDocOp => ({
    key: "textContent",
    op: "set-key",
    path: HEADING,
    value: text,
  });

  test("an echoed commit leaves the caret's element alone and redraws every echo row", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    const [active, second, third] = instances(frame.container, HEADING);
    caretIn(active!);
    expect(getActiveElement()).toBe(active!);
    // The author typed before the chip; the frame's DOM already shows it, in the active row only.
    active!.prepend("New: ");

    await frame.patch([headingOp("New: ${$map.item.data.title ?? ''}")], [HEADING]);
    expect(frame.of("patchError")).toEqual([]);
    const after = instances(frame.container, HEADING);
    // The element under the caret is the same node, untouched; the session is still on it.
    expect(after[0]).toBe(active!);
    expect(getActiveElement()).toBe(active!);
    // The other rows are new elements, drawn from the template with their own titles.
    expect(after[1]).not.toBe(second!);
    expect(after[2]).not.toBe(third!);
    expect(after.map((el) => el.textContent)).toEqual(
      EPISODES.map((episode) => `New: ${episode.data.title}`),
    );
    expect(duplicatePaths(frame.container)).toEqual([]);
  });

  test("an echo that arrives after another row was made active is drawn there too", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    const [first, , third] = instances(frame.container, HEADING);
    caretIn(first!);
    first!.prepend("New: ");
    /* The press commits the first row's heading on its way out and makes the third row active.
       The commit's echo is still to come, and the element at the heading's path is now the third
       row's, which never held the edit. */
    press(third!);
    await frame.settle();
    expect(frame.of("editCommit")).toHaveLength(1);
    expect(addressable(frame.container, HEADING)).toBe(third!);
    expect(third!.textContent).toBe("Covid-19 and Brotherhood");

    await frame.patch([headingOp("New: ${$map.item.data.title ?? ''}")], [HEADING]);
    expect(frame.of("patchError")).toEqual([]);
    // Skipped as an echo, the now-active row would still read the old template.
    expect(instances(frame.container, HEADING).map((el) => el.textContent)).toEqual(
      EPISODES.map((episode) => `New: ${episode.data.title}`),
    );
    expect(rowOf(addressable(frame.container, HEADING))).toBe(2);
    expect(duplicatePaths(frame.container)).toEqual([]);
  });
});

describe("what a repeater refuses to patch in place", () => {
  test("a structural op beside a repeater escalates instead of splicing by index", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    const parentPath = LIST.slice(0, -2);
    const node: JxMutableNode = { tagName: "p", textContent: "after the list" };
    // In the document the new node is child 1. In the DOM, child 1 is the SECOND ROW.
    await frame.patch([{ index: 1, node, op: "insert-child", parentPath }]);
    expect(frame.of("patchError").map((m) => m.message)).toEqual([
      "iframe-patch-structure-beside-repeater",
    ]);
    // Nothing was spliced between two rows.
    const host = addressable(frame.container, parentPath);
    expect([...host.children].map((child) => child.tagName)).toEqual(["DIV", "DIV", "DIV"]);
  });

  test("a structural op inside a template and the repeater itself each escalate", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    const attempts: JxDocOp[] = [
      { index: 0, node: { tagName: "hr" }, op: "insert-child", parentPath: BODY },
      { key: "items", op: "set-key", path: LIST, value: [] },
    ];
    const messages: string[] = [];
    for (const op of attempts) {
      /* Each is its own render: a failed patch leaves the frame's shadow document ahead of what
         is drawn, which is exactly what the escalation it asks for repairs. */
      const fresh = await frameWith(pageOf(EPISODES));
      await fresh.patch([op]);
      messages.push(...fresh.of("patchError").map((m) => m.message));
      teardown?.();
      teardown = undefined;
      document.body.innerHTML = "";
    }
    expect(messages).toEqual(["iframe-patch-structure-on-map-path", "iframe-patch-repeater-node"]);
    expect(frame.of("patchError")).toEqual([]);
  });

  test("a row's root is drawn again in every row, each still its own item's", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    await frame.patch([
      { key: "className", op: "set-key", path: ROW, value: "cc-query-item wide" },
    ]);
    expect(frame.of("patchError")).toEqual([]);
    const rows = instances(frame.container, ROW);
    expect(rows.map((row) => row.className)).toEqual(
      Array.from({ length: 3 }, () => "cc-query-item wide"),
    );
    expect(rows.map((row) => rowOf(row))).toEqual([0, 1, 2]);
    expect(instances(frame.container, HEADING).map((el) => el.textContent)).toEqual(
      EPISODES.map((e) => e.data.title),
    );
    expect(duplicatePaths(frame.container)).toEqual([]);
  });

  test("an insert above the repeater's container shifts every row's path, echo rows included", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    await frame.patch([
      {
        index: 0,
        node: { tagName: "p", textContent: "intro" },
        op: "insert-child",
        parentPath: [],
      },
    ]);
    expect(frame.of("patchError")).toEqual([]);
    const shifted: JxPath = ["children", 2, ...HEADING.slice(2)];
    const drawn = instances(frame.container, shifted);
    // All three rows moved to the new path, each in the attribute it already carried.
    expect(drawn.map((el) => el.textContent)).toEqual(EPISODES.map((e) => e.data.title));
    expect(drawn.map((el) => el.dataset.jxPath !== undefined)).toEqual([true, false, false]);
    expect(instances(frame.container, HEADING)).toEqual([]);
    expect(duplicatePaths(frame.container)).toEqual([]);
  });
});

describe("the repeater's own box", () => {
  test("its path is answered with the union of its rows' rects", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    const rows = instances(frame.container, ROW);
    stubRect(rows[0]!, { height: 100, left: 20, top: 40, width: 300 });
    stubRect(rows[1]!, { height: 120, left: 20, top: 150, width: 340 });
    stubRect(rows[2]!, { height: 90, left: 10, top: 280, width: 300 });
    await frame.send({ kind: "measure", paths: [LIST, ROW, ["children", 9]], reqId: 7 });
    const [geometry] = frame.of("geometry");
    // The repeater has no element: its box runs from the first row's top to the last row's bottom.
    expect(geometry?.hits).toEqual([
      { path: LIST, rect: { height: 330, width: 350, x: 10, y: 40 } },
      // A row's root is measured as the ACTIVE row's element, like any other node.
      { path: ROW, rect: { height: 100, width: 300, x: 20, y: 40 } },
    ]);
    expect(geometry?.hidden).toEqual([]);
  });

  test("with no row rendered it is hidden, and a path that draws nothing is omitted", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    for (const row of instances(frame.container, ROW)) {
      row.style.display = "none";
    }
    await frame.send({ kind: "measure", paths: [LIST, ["children", 9]], reqId: 8 });
    const [geometry] = frame.of("geometry");
    expect(geometry?.hits).toEqual([]);
    expect(geometry?.hidden).toEqual([LIST]);
  });
});

describe("a list with nothing to draw still shows its template", () => {
  /** The sample the parent deduces from the `episode` content type, in part. */
  const SAMPLE = {
    data: {
      author: "",
      date: "",
      featuredImage: { alt: "", src: "" },
      id: "",
      premium: false,
      title: "",
      url: "",
    },
  };

  test("an empty list draws one template row from the sample item, marked as such", async () => {
    const frame = await frameWith(pageOf([]), { rowSamples: { [JSON.stringify(LIST)]: SAMPLE } });
    const rows = instances(frame.container, ROW);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.dataset.jxTemplateRow).toBe("");
    // It is the addressable row: the template can be selected and edited through it.
    expect(addressable(frame.container, HEADING).closest("[data-jx-template-row]")).toBe(row!);
    // Every chip is empty, so each draws its name; none spells `undefined`.
    const chip = addressable(frame.container, HEADING).querySelector<HTMLElement>("data");
    expect(chip?.textContent).toBe("");
    expect(chip?.dataset.jxTagLabel).toBe("Title");
    expect(row?.textContent).not.toContain("undefined");
    /* An attribute that reads the row is not evaluated against a made-up item: the badge's
       `hidden` is `!premium`, true of the sample, and would hide part of the template. */
    expect([...frame.container.querySelectorAll("[hidden]")]).toEqual([]);
    expect(instances(frame.container, LINK)[0]?.dataset.jxHref).toBeUndefined();
  });

  test("an unresolvable list, and one with no sample, draw the template with no item at all", async () => {
    // `null` is what a collection that could not be resolved reads as.
    const frame = await frameWith(pageOf(null));
    const rows = instances(frame.container, ROW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dataset.jxTemplateRow).toBe("");
    // Every binding that reads the item throws, is survived, and draws nothing.
    expect(addressable(frame.container, HEADING).textContent).toBe("");
    expect(addressable(frame.container, DATE).textContent).toBe("");
    expect(rows[0]?.textContent).not.toContain("undefined");
    expect(frame.of("renderError")).toEqual([]);
  });

  test("the mark goes when the list fills, and a list with items never carries it", async () => {
    const frame = await frameWith(pageOf([]));
    expect(frame.container.querySelector("[data-jx-template-row]")).not.toBeNull();
    await frame.render(pageOf(EPISODES));
    expect(frame.container.querySelector("[data-jx-template-row]")).toBeNull();
    expect(instances(frame.container, ROW)).toHaveLength(3);
  });
});

describe("the row cap", () => {
  const MANY: Episode[] = Array.from({ length: 30 }, (_, i) => ({
    data: { title: `Episode ${i + 1}`, url: `/episode/${i + 1}/` },
  }));

  test("at most 24 rows are drawn until the host asks for more, and the last says so", async () => {
    const frame = await frameWith(pageOf(MANY));
    const rows = instances(frame.container, ROW);
    expect(DEFAULT_ROW_LIMIT).toBe(24);
    expect(rows).toHaveLength(24);
    expect(rows.map((row) => row.dataset.jxRowsMore ?? null)).toEqual([
      ...Array.from({ length: 23 }, () => null),
      "24 of 30 rows",
    ]);
    expect(instances(frame.container, HEADING).at(-1)?.textContent).toBe("Episode 24");
  });

  test("the render names the cap, and a list within it carries no mark", async () => {
    const frame = await frameWith(pageOf(MANY), { rowLimit: 5 });
    expect(instances(frame.container, ROW)).toHaveLength(5);
    expect(instances(frame.container, ROW).at(-1)?.dataset.jxRowsMore).toBe("5 of 30 rows");
    await frame.render(pageOf(MANY), { rowLimit: 100 });
    expect(instances(frame.container, ROW)).toHaveLength(30);
    expect(frame.container.querySelector("[data-jx-rows-more]")).toBeNull();
    // A cap that is not a whole number of rows is the default, never zero rows.
    await frame.render(pageOf(MANY), { rowLimit: 0 });
    expect(instances(frame.container, ROW)).toHaveLength(24);
  });
});

/** Put a collapsed caret in `el`, at its start or its end, as a click there does. */
function caretAt(el: HTMLElement, atEnd = false): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

/** Drop the frame under test, so the next one in the same test starts clean. */
function dropFrame(): void {
  teardown?.();
  teardown = undefined;
  document.body.innerHTML = "";
}

/** One animation frame, which is what the hover report waits for. */
const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

/** `count` episodes that differ in title alone. */
const manyEpisodes = (count: number): Episode[] =>
  Array.from({ length: count }, (_, i) => ({ data: { title: `T${i}`, url: `/e/${i}/` } }));

/** A list whose row holds a paragraph with a link in it, and a popover. */
const INLINE_ROWS = (): JxMutableNode => ({
  children: [
    {
      $prototype: "Array",
      items: { $ref: "#/state/rows" },
      map: {
        children: [
          {
            children: [
              "See ",
              {
                attributes: { href: "/x", rel: "nofollow" },
                children: ["here"],
                className: "cta",
                tagName: "a",
              },
              " now",
            ],
            tagName: "p",
          },
          {
            attributes: { id: "pop", popover: "auto" },
            children: [{ tagName: "span", textContent: "panel" }],
            tagName: "div",
          },
        ],
        tagName: "li",
      },
    },
  ],
  state: { rows: [{ n: 1 }, { n: 2 }, { n: 3 }] },
  tagName: "ul",
});
const INLINE_BLOCK: JxPath = ["children", 0, "map", "children", 0];
const INLINE_LINK: JxPath = [...INLINE_BLOCK, "children", 1];
const INLINE_POPOVER: JxPath = ["children", 0, "map", "children", 1];

describe("what a change of active row carries with it", () => {
  /** What each row's link carries of its node, by row. */
  const kept = (frame: Frame) =>
    instances(frame.container, INLINE_LINK).map((el) => el.dataset.jxKeep !== undefined);

  test("a press stamps the new active row's inline elements with what their nodes hold", async () => {
    const frame = await frameWith(INLINE_ROWS());
    expect(kept(frame)).toEqual([true, false, false]);
    press(instances(frame.container, INLINE_BLOCK)[2]!);
    await frame.settle();
    // Without the stamp a commit of row 3's paragraph would rebuild its link with no href.
    expect(kept(frame)[2]).toBe(true);
    expect(instances(frame.container, INLINE_LINK)[2]!.dataset.jxKeep).toContain("nofollow");
  });

  test("and so does a row the host names", async () => {
    const frame = await frameWith(INLINE_ROWS());
    await frame.send({ kind: "setActiveRows", rows: { '["children",0]': 2 } });
    expect(kept(frame)[2]).toBe(true);
  });

  test("an open popover is drawn on the row its path now names", async () => {
    const frame = await frameWith(INLINE_ROWS());
    await frame.send({ kind: "setPopoverOpen", path: INLINE_POPOVER });
    const open = () =>
      instances(frame.container, INLINE_POPOVER).map(
        (el) => el.dataset.jxPopoverOpen !== undefined,
      );
    expect(open()).toEqual([true, false, false]);
    press(instances(frame.container, INLINE_BLOCK)[1]!);
    await frame.settle();
    expect(open()).toEqual([false, true, false]);
  });

  test("a press inside the block being edited leaves the caret session alone", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    const [first] = instances(frame.container, AUTHOR);
    caretAt(first!);
    expect(isEditing()).toBe(true);
    const ended = frame.of("editEnd").length;
    first!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await frame.settle();
    expect(isEditing()).toBe(true);
    expect(frame.of("editEnd").length).toBe(ended);
  });

  test("a session that changed nothing strands no echo for the row that takes over", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    const [first, , third] = instances(frame.container, AUTHOR);
    caretAt(first!);
    press(third!);
    await frame.settle();
    /* Row 3's own commit comes back as an echo. Row 1 posted nothing, so nothing is on its way
       for this path, and the echo must leave the element the caret is in alone. */
    await frame.patch(
      [{ key: "textContent", op: "set-key", path: AUTHOR, value: "by ${$map.item.data.author}" }],
      [AUTHOR],
    );
    expect(addressable(frame.container, AUTHOR)).toBe(third!);
  });

  test("a caret that returns to a row made active again opens a session there", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    const [first, , third] = instances(frame.container, AUTHOR);
    caretAt(first!);
    press(third!);
    await frame.settle();
    press(first!);
    await frame.settle();
    caretAt(first!);
    // The editing host forgot the element when its row was demoted, so this is a new session.
    expect(isEditing()).toBe(true);
    expect(getActiveElement()).toBe(first!);
  });

  test("a live expression is evaluated against the row the author is working in", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    press(instances(frame.container, HEADING)[2]!);
    await frame.settle();
    /* SAFETY: a `$ref` operand as the expression editor posts it, which the wire type spells more
       narrowly than the evaluator reads. */
    await frame.send({
      contextPath: HEADING,
      exprs: [
        { id: "t", node: { operator: "+", target: { $ref: "$map/item/data/title" }, value: "" } },
      ] as never,
      gen: 1,
      kind: "evalExpr",
      reqId: 9,
    });
    const [reply] = frame.of("evalResult");
    const results = JSON.stringify(reply?.results);
    expect(results).toContain(EPISODES[2]!.data.title);
    expect(results).not.toContain(EPISODES[0]!.data.title);
  });

  test("hovering the same node in the next row reports that row's box", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    const [a, b] = instances(frame.container, HEADING);
    stubRect(a!, { height: 10, left: 0, top: 0, width: 50 });
    stubRect(b!, { height: 10, left: 0, top: 100, width: 50 });
    a!.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    await nextFrame();
    await frame.settle();
    b!.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    await nextFrame();
    await frame.settle();
    expect(frame.of("hover").map((m) => m.hit?.rect.y)).toEqual([0, 100]);
  });
});

describe("what a render names is what the frame draws", () => {
  test("the render's active rows are adopted by a frame that held none", async () => {
    const frame = await frameWith(pageOf(EPISODES), { activeRows: { [JSON.stringify(LIST)]: 1 } });
    expect(instances(frame.container, ROW).map((el) => el.dataset.jxPath !== undefined)).toEqual([
      false,
      true,
      false,
    ]);
  });

  test("the template row is drawn from the sample item the render names", async () => {
    const frame = await frameWith(pageOf([]), {
      rowSamples: { [JSON.stringify(LIST)]: { data: { title: "Sample title", url: "" } } },
    });
    expect(addressable(frame.container, HEADING).textContent).toBe("Sample title");
  });
});

describe("a patch reaches every row", () => {
  test("literal text written over literal text is written in every row", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    await frame.patch([{ key: "textContent", op: "set-key", path: HEADING, value: "Listen" }]);
    // The second op finds a literal node, so it is a text write and not a redraw.
    await frame.patch([{ key: "textContent", op: "set-key", path: HEADING, value: "Hear" }]);
    expect(frame.of("patchError")).toEqual([]);
    expect(instances(frame.container, HEADING).map((el) => el.textContent)).toEqual([
      "Hear",
      "Hear",
      "Hear",
    ]);
  });

  test("a $props op under map draws every row's instance again", async () => {
    await defineElement({
      children: [{ tagName: "h3", textContent: "${state.label}" }, { tagName: "slot" }],
      state: { label: "Default" },
      tagName: "rows-probe-card",
    });
    const CARD: JxPath = ["children", 0, "map", "children", 0];
    const frame = await frameWith({
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/rows" },
          map: {
            children: [{ $props: { label: "A" }, tagName: "rows-probe-card" }],
            tagName: "li",
          },
        },
      ],
      state: { rows: [{ n: 1 }, { n: 2 }, { n: 3 }] },
      tagName: "ul",
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
    const headings = () =>
      instances(frame.container, CARD).map((el) => el.querySelector("h3")?.textContent);
    expect(headings()).toEqual(["A", "A", "A"]);
    await frame.patch([{ key: "$props", op: "set-key", path: CARD, value: { label: "B" } }]);
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
    expect(frame.of("patchError")).toEqual([]);
    expect(headings()).toEqual(["B", "B", "B"]);
  });

  test("moving the container that holds a repeater moves every row's path with it", async () => {
    const frame = await frameWith(pageOf(EPISODES));
    await frame.patch([
      { fromIndex: 1, fromParentPath: [], op: "move-child", toIndex: 0, toParentPath: [] },
    ]);
    expect(frame.of("patchError")).toEqual([]);
    expect(instances(frame.container, ["children", 0, ...HEADING.slice(2)])).toHaveLength(3);
    expect(instances(frame.container, HEADING)).toHaveLength(0);
  });

  test("and into another parent", async () => {
    const doc = pageOf(EPISODES);
    doc.children = [
      // SAFETY: `pageOf` builds `children` as an array of nodes.
      ...(doc.children as JxMutableNode[]),
      { children: [{ tagName: "p", textContent: "x" }], tagName: "section" },
    ];
    const frame = await frameWith(doc);
    await frame.patch([
      {
        fromIndex: 1,
        fromParentPath: [],
        op: "move-child",
        toIndex: 0,
        toParentPath: ["children", 2],
      },
    ]);
    expect(frame.of("patchError")).toEqual([]);
    const moved: JxPath = ["children", 1, "children", 0, ...HEADING.slice(2)];
    expect(instances(frame.container, moved)).toHaveLength(3);
    expect(instances(frame.container, HEADING)).toHaveLength(0);
  });

  test("a patch under a clamped active row leaves its path an addressable element", async () => {
    // Row 7 of three: the last row stands in for it.
    const frame = await frameWith(pageOf(EPISODES), { activeRows: { [JSON.stringify(LIST)]: 7 } });
    const flags = () =>
      instances(frame.container, AUTHOR).map((el) => el.dataset.jxPath !== undefined);
    expect(flags()).toEqual([false, false, true]);
    await frame.patch([{ key: "attributes", op: "set-key", path: AUTHOR, value: { title: "x" } }]);
    expect(frame.of("patchError")).toEqual([]);
    // Each new element was stamped by the choice alone (row 7, which nothing is): settled after.
    expect(flags()).toEqual([false, false, true]);
  });

  test("a container drawn again keeps its repeater capped, and its empty one on the template", async () => {
    const container: JxPath = ["children", 1];
    const capped = await frameWith(pageOf(manyEpisodes(30)));
    await capped.patch([
      { key: "attributes", op: "set-key", path: container, value: { title: "x" } },
    ]);
    const rows = instances(capped.container, ROW);
    expect(capped.of("patchError")).toEqual([]);
    expect(rows).toHaveLength(DEFAULT_ROW_LIMIT);
    expect(rows.at(-1)?.dataset.jxRowsMore).toBe(`${DEFAULT_ROW_LIMIT} of 30 rows`);
    dropFrame();

    const empty = await frameWith(pageOf([]), {
      rowSamples: { [JSON.stringify(LIST)]: { data: { title: "", url: "" } } },
    });
    await empty.patch([
      { key: "attributes", op: "set-key", path: container, value: { title: "x" } },
    ]);
    expect(instances(empty.container, ROW).map((row) => row.dataset.jxTemplateRow)).toEqual([""]);
  });
});

describe("a remove and a move beside a repeater are refused like an insert", () => {
  /** The page with a paragraph after the repeater, in the same container. */
  const withTail = (): JxMutableNode => {
    const doc = pageOf(EPISODES);
    // SAFETY: `pageOf` builds `children` as an array of nodes.
    const query = (doc.children as JxMutableNode[])[1]!;
    // SAFETY: and the container's `children` as an array holding the Array node.
    (query.children as JxMutableNode[]).push({ tagName: "p", textContent: "tail" });
    return doc;
  };
  const parentPath = LIST.slice(0, -2);
  const REFUSED = ["iframe-patch-structure-beside-repeater"];

  test("removing a sibling of the repeater", async () => {
    const frame = await frameWith(withTail());
    await frame.patch([{ index: 1, op: "remove-child", parentPath }]);
    expect(frame.of("patchError").map((m) => m.message)).toEqual(REFUSED);
  });

  test("moving a sibling of the repeater away", async () => {
    const frame = await frameWith(withTail());
    await frame.patch([
      { fromIndex: 1, fromParentPath: parentPath, op: "move-child", toIndex: 3, toParentPath: [] },
    ]);
    expect(frame.of("patchError").map((m) => m.message)).toEqual(REFUSED);
  });

  test("moving a node in beside the repeater", async () => {
    const frame = await frameWith(withTail());
    // Document index 1 is after the repeater. DOM child 1 is the second ROW.
    await frame.patch([
      { fromIndex: 2, fromParentPath: [], op: "move-child", toIndex: 1, toParentPath: parentPath },
    ]);
    expect(frame.of("patchError").map((m) => m.message)).toEqual(REFUSED);
    const host = addressable(frame.container, parentPath);
    expect([...host.children].map((child) => child.tagName)).toEqual(["DIV", "DIV", "DIV", "P"]);
  });
});

/** A list whose ROW ROOT is the text block: the commonest `li`, `p` or `a` repeater. */
const LEAF_ROWS = (text: string): JxMutableNode => ({
  children: [
    {
      $prototype: "Array",
      items: { $ref: "#/state/rows" },
      map: { tagName: "li", textContent: text },
    },
  ],
  state: { rows: [{ name: "a" }, { name: "b" }, { name: "c" }] },
  tagName: "ul",
});
const LEAF_ROW: JxPath = ["children", 0, "map"];

describe("a block that is the row's root is edited like any other", () => {
  test("the caret's own commit keeps the session, and every other row shows the edit", async () => {
    const frame = await frameWith(LEAF_ROWS("${$map.item.name}"));
    const [first] = instances(frame.container, LEAF_ROW);
    caretAt(first!, true);
    expect(isEditing()).toBe(true);
    first!.append(" x");
    await frame.patch(
      [{ key: "textContent", op: "set-key", path: LEAF_ROW, value: "${$map.item.name} x" }],
      [LEAF_ROW],
    );
    // No escalation: a full render would have ended the session and replaced the element.
    expect(frame.of("patchError")).toEqual([]);
    expect(isEditing()).toBe(true);
    expect(getActiveElement()).toBe(first!);
    expect(frame.of("editEnd")).toEqual([]);
    const rows = instances(frame.container, LEAF_ROW);
    expect(rows[0]).toBe(first!);
    expect(rows.map((row) => row.textContent)).toEqual(["a x", "b x", "c x"]);
    expect(duplicatePaths(frame.container)).toEqual([]);
  });

  test("literal text in the row's root echoes the same way", async () => {
    const frame = await frameWith(LEAF_ROWS("item"));
    const [first] = instances(frame.container, LEAF_ROW);
    caretAt(first!, true);
    first!.append("s");
    await frame.patch(
      [{ key: "textContent", op: "set-key", path: LEAF_ROW, value: "items" }],
      [LEAF_ROW],
    );
    expect(frame.of("patchError")).toEqual([]);
    expect(isEditing()).toBe(true);
    expect(instances(frame.container, LEAF_ROW).map((row) => row.textContent)).toEqual([
      "items",
      "items",
      "items",
    ]);
  });

  test("a row's root drawn again is the row the list goes on reordering and removing", async () => {
    const doc = LEAF_ROWS("${$map.item.name}");
    doc.state = { data: { rows: [{ name: "a" }, { name: "b" }, { name: "c" }] } };
    // SAFETY: `LEAF_ROWS` builds `children` as an array holding the Array node.
    const list = (doc.children as JxMutableNode[])[0]!;
    list.items = { $ref: "#/state/data/rows" };
    list.key = { $ref: "$map/item/name" };
    const frame = await frameWith(doc, { entryRoot: "data" });
    await frame.patch([{ key: "className", op: "set-key", path: LEAF_ROW, value: "wide" }]);
    expect(frame.of("patchError")).toEqual([]);
    const texts = () => instances(frame.container, LEAF_ROW).map((row) => row.textContent);
    const classes = () => instances(frame.container, LEAF_ROW).map((row) => row.className);
    expect(classes()).toEqual(["wide", "wide", "wide"]);
    const [a, , c] = instances(frame.container, LEAF_ROW);
    // The list reverses and drops a row: it moves and removes the roots it was handed.
    await frame.send({
      gen: 1,
      kind: "entryState",
      value: { rows: [{ name: "c" }, { name: "a" }] },
    });
    expect(texts()).toEqual(["c", "a"]);
    const [first, second] = instances(frame.container, LEAF_ROW);
    expect(first).toBe(c!);
    expect(second).toBe(a!);
    expect(frame.container.querySelectorAll("li")).toHaveLength(2);
    expect(duplicatePaths(frame.container)).toEqual([]);
  });
});

describe("a row the list draws after a patch shows the patched template", () => {
  const PAIR = (): JxMutableNode => ({
    children: [
      {
        $prototype: "Array",
        items: { $ref: "#/state/data/rows" },
        map: {
          children: [
            { tagName: "b", textContent: "${$map.item.name}" },
            { tagName: "i", textContent: "old" },
          ],
          tagName: "li",
        },
      },
    ],
    state: { data: { rows: [{ name: "A" }, { name: "B" }] } },
    tagName: "ul",
  });
  const NAME: JxPath = ["children", 0, "map", "children", 0];
  const NOTE: JxPath = ["children", 0, "map", "children", 1];

  test("text, a binding and a class set in place are all in the row the list adds", async () => {
    const frame = await frameWith(PAIR(), { entryRoot: "data" });
    await frame.patch([{ key: "textContent", op: "set-key", path: NOTE, value: "new" }]);
    await frame.patch([
      { key: "textContent", op: "set-key", path: NAME, value: "Name: ${$map.item.name}" },
    ]);
    await frame.patch([{ key: "className", op: "set-key", path: NOTE, value: "k" }]);
    expect(frame.of("patchError")).toEqual([]);
    await frame.send({
      gen: 1,
      kind: "entryState",
      value: { rows: [{ name: "A" }, { name: "B" }, { name: "C" }] },
    });
    expect(instances(frame.container, NAME).map((el) => el.textContent)).toEqual([
      "Name: A",
      "Name: B",
      "Name: C",
    ]);
    expect(instances(frame.container, NOTE).map((el) => el.textContent)).toEqual([
      "new",
      "new",
      "new",
    ]);
    expect(instances(frame.container, NOTE).map((el) => el.className)).toEqual(["k", "k", "k"]);
    expect(duplicatePaths(frame.container)).toEqual([]);
    // Drawn again once: the next redraw of the list finds the row it knows.
    const third = instances(frame.container, NAME)[2]!;
    await frame.send({
      gen: 1,
      kind: "entryState",
      value: { rows: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }] },
    });
    expect(instances(frame.container, NAME)[2]).toBe(third);
    expect(instances(frame.container, NAME)[3]!.textContent).toBe("Name: D");
    // And the list still owns the row it was handed: emptied, nothing is left behind.
    await frame.send({ gen: 1, kind: "entryState", value: { rows: [{ name: "A" }] } });
    expect(frame.container.querySelectorAll("li")).toHaveLength(1);
  });

  test("a list nobody patched draws its rows once, from the template it has", async () => {
    const frame = await frameWith(PAIR(), { entryRoot: "data" });
    await frame.send({
      gen: 1,
      kind: "entryState",
      value: { rows: [{ name: "A" }, { name: "B" }, { name: "C" }] },
    });
    const third = instances(frame.container, NAME)[2]!;
    await frame.settle();
    expect(instances(frame.container, NAME)[2]).toBe(third);
    expect(third.textContent).toBe("C");
  });
});

describe("a structural patch above a list leaves the list as it was", () => {
  const LISTED = (rows: JsonValue): JxMutableNode => ({
    children: [
      { tagName: "h1", textContent: "H" },
      {
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/data/rows" },
            map: { tagName: "li", textContent: "${$map.item.name}" },
          },
        ],
        tagName: "ul",
      },
    ],
    state: { data: { rows } },
    tagName: "main",
  });
  const INTRO: JxDocOp = {
    index: 0,
    node: { tagName: "p", textContent: "intro" },
    op: "insert-child",
    parentPath: [],
  };
  const marks = (frame: Frame) =>
    [...frame.container.querySelectorAll("li")].map((li) => [
      li.dataset.jxPath ?? li.dataset.jxEchoPath,
      li.dataset.jxTemplateRow ?? null,
      li.dataset.jxRowsMore ?? null,
    ]);
  const SHIFTED = '["children",2,"children",0,"map"]';

  test("the template row keeps its mark", async () => {
    const frame = await frameWith(LISTED([]), {
      rowSamples: { '["children",1,"children",0]': { name: "" } },
    });
    expect(marks(frame)).toEqual([['["children",1,"children",0,"map"]', "", null]]);
    await frame.patch([INTRO]);
    expect(frame.of("patchError")).toEqual([]);
    expect(marks(frame)).toEqual([[SHIFTED, "", null]]);
  });

  test("the last row of a capped list keeps its mark", async () => {
    const frame = await frameWith(LISTED([{ name: "a" }, { name: "b" }, { name: "c" }]), {
      rowLimit: 2,
    });
    await frame.patch([INTRO]);
    expect(frame.of("patchError")).toEqual([]);
    expect(marks(frame)).toEqual([
      [SHIFTED, null, null],
      [SHIFTED, null, "2 of 3 rows"],
    ]);
  });

  test("a row's root drawn again keeps the marks the list wrote on it", async () => {
    const row: JxPath = ["children", 1, "children", 0, "map"];
    const capped = await frameWith(LISTED([{ name: "a" }, { name: "b" }, { name: "c" }]), {
      rowLimit: 2,
    });
    await capped.patch([{ key: "className", op: "set-key", path: row, value: "wide" }]);
    expect(capped.of("patchError")).toEqual([]);
    expect(marks(capped).map((mark) => mark[2])).toEqual([null, "2 of 3 rows"]);
    dropFrame();
    const empty = await frameWith(LISTED([]), {
      rowSamples: { '["children",1,"children",0]': { name: "" } },
    });
    await empty.patch([{ key: "className", op: "set-key", path: row, value: "wide" }]);
    expect(marks(empty).map((mark) => mark[1])).toEqual([""]);
    expect(empty.container.querySelector("li")!.className).toContain("wide");
  });

  test("a row the list adds afterwards is stamped with the path the document now holds", async () => {
    const frame = await frameWith(LISTED([{ name: "a" }]), { entryRoot: "data" });
    await frame.patch([INTRO]);
    await frame.send({
      gen: 1,
      kind: "entryState",
      value: { rows: [{ name: "a" }, { name: "b" }] },
    });
    // The list was created at `children/1` and still names its rows that way.
    expect(marks(frame).map(([path]) => path)).toEqual([SHIFTED, SHIFTED]);
    expect(
      [...frame.container.querySelectorAll("li")].map((li) => li.dataset.jxPath !== undefined),
    ).toEqual([true, false]);
    expect(duplicatePaths(frame.container)).toEqual([]);
  });
});

describe("a selection stays in the row it began in", () => {
  /** A list of paragraphs, each row's text literal plus its item's name. */
  const PARAGRAPHS = (): JxMutableNode => ({
    children: [
      { tagName: "h1", textContent: "Head" },
      {
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/rows" },
            map: {
              children: [
                { tagName: "h2", textContent: "Read" },
                { tagName: "p", textContent: "Second paragraph" },
              ],
              tagName: "article",
            },
          },
        ],
        tagName: "section",
      },
    ],
    state: { rows: [{ n: 1 }, { n: 2 }, { n: 3 }] },
    tagName: "main",
  });
  const ARTICLE: JxPath = ["children", 1, "children", 0, "map"];
  const TITLE: JxPath = [...ARTICLE, "children", 0];
  const PARAGRAPH: JxPath = [...ARTICLE, "children", 1];

  /** Select from `offset` in `from`'s text to `to`'s text, as a drag or a Shift press does. */
  function selectAcross(from: HTMLElement, offset: number, to: HTMLElement): Selection {
    // SAFETY: a frame under test has a document, and a document has a selection.
    const selection = document.getSelection() as Selection;
    selection.setBaseAndExtent(from.firstChild!, offset, to.firstChild!, 2);
    document.dispatchEvent(new Event("selectionchange"));
    return selection;
  }

  test("dragged into the next row, it ends at the end of its own", async () => {
    const frame = await frameWith(PARAGRAPHS());
    const [para] = instances(frame.container, PARAGRAPH);
    const titles = instances(frame.container, TITLE);
    caretAt(para!);
    expect(isEditing()).toBe(true);
    const selection = selectAcross(para!, 7, titles[1]!);
    // The focus is back in row 1's last block, and the caret session goes on.
    expect(selection.focusNode).toBe(para!.firstChild);
    expect(selection.focusOffset).toBe("Second paragraph".length);
    expect(selection.toString()).toBe("paragraph");
    expect(isEditing()).toBe(true);
    expect(getActiveElement()).toBe(para!);
    expect(frame.of("editEnd")).toEqual([]);
  });

  test("dragged back into an earlier row, it ends at the start of its own", async () => {
    const frame = await frameWith(PARAGRAPHS(), {
      activeRows: { [JSON.stringify(ARTICLE.slice(0, -1))]: 2 },
    });
    const titles = instances(frame.container, TITLE);
    const paragraphs = instances(frame.container, PARAGRAPH);
    caretAt(paragraphs[2]!);
    const selection = selectAcross(paragraphs[2]!, 6, paragraphs[0]!);
    // Rows 1 and 2 are both echo rows: the wall is the nearer one, so the focus is row 3's start.
    expect(selection.focusNode).toBe(titles[2]!.firstChild);
    expect(selection.focusOffset).toBe(0);
    expect(isEditing()).toBe(true);
  });

  test("a selection that begins above the list stops where the first echo row does", async () => {
    const frame = await frameWith(PARAGRAPHS());
    const head = frame.container.querySelector("h1")!;
    const paragraphs = instances(frame.container, PARAGRAPH);
    caretAt(head);
    const selection = selectAcross(head, 1, paragraphs[2]!);
    expect(selection.focusNode).toBe(paragraphs[0]!.firstChild);
    expect(selection.focusOffset).toBe("Second paragraph".length);
  });

  test("a selection inside one row, or with no session behind it, is left as it is", async () => {
    const frame = await frameWith(PARAGRAPHS());
    const [title] = instances(frame.container, TITLE);
    const [para] = instances(frame.container, PARAGRAPH);
    caretAt(title!);
    const selection = selectAcross(title!, 1, para!);
    expect(selection.focusNode).toBe(para!.firstChild);
    expect(selection.focusOffset).toBe(2);
  });

  test("an echo row of an inner list is a wall too, and the selection stops before it", async () => {
    const inner: JxPath = [...ARTICLE, "children", 2, "children", 0];
    const doc = PARAGRAPHS();
    // SAFETY: `PARAGRAPHS` builds `children` as an array of nodes.
    const section = (doc.children as JxMutableNode[])[1]!;
    // SAFETY: whose second member holds the Array node, and its `map` is a node.
    const template = (section.children as JxMutableNode[])[0]!.map as JxMutableNode;
    // SAFETY: the template's `children` is an array of nodes too.
    (template.children as JxMutableNode[]).push({
      children: [
        {
          $prototype: "Array",
          items: ["x", "y"],
          map: { tagName: "li", textContent: "Tag ${$map.item}" },
        },
      ],
      tagName: "ul",
    });
    // The second tag is the active one, so the first, which comes sooner, is an echo row.
    const frame = await frameWith(doc, { activeRows: { [JSON.stringify(inner)]: 1 } });
    const [para] = instances(frame.container, PARAGRAPH);
    const titles = instances(frame.container, TITLE);
    caretAt(para!);
    const selection = selectAcross(para!, 7, titles[1]!);
    expect(selection.focusNode).toBe(para!.firstChild);
    expect(selection.focusOffset).toBe("Second paragraph".length);
  });

  test("beside a chip the selection ends at the chip's edge in its block", async () => {
    const frame = await frameWith(LEAF_ROWS("Tag ${$map.item.name}"));
    const [first, second] = instances(frame.container, LEAF_ROW);
    caretAt(first!);
    // SAFETY: a frame under test has a document, and a document has a selection.
    const selection = document.getSelection() as Selection;
    selection.setBaseAndExtent(first!.firstChild!, 1, second!.firstChild!, 2);
    document.dispatchEvent(new Event("selectionchange"));
    // The row ends in a chip, which no caret enters: the position after it, in the block.
    expect(selection.focusNode).toBe(first!);
    expect(selection.focusOffset).toBe(first!.childNodes.length);
    expect(isEditing()).toBe(true);
  });

  test("with nothing between the anchor and the wall, the selection collapses where it began", async () => {
    const frame = await frameWith(LEAF_ROWS("Tag ${$map.item.name}"), {
      activeRows: { '["children",0]': 1 },
    });
    const [first, second] = instances(frame.container, LEAF_ROW);
    // SAFETY: as above.
    const selection = document.getSelection() as Selection;
    // Anchored on the row's own element, at its start, and dragged back into the row before.
    selection.setBaseAndExtent(second!, 0, first!.firstChild!, 1);
    document.dispatchEvent(new Event("selectionchange"));
    expect(selection.isCollapsed).toBe(true);
    expect(selection.anchorNode).toBe(second!);
  });

  test("a Shift press in another row extends the selection and promotes nothing", async () => {
    const frame = await frameWith(PARAGRAPHS());
    const paragraphs = instances(frame.container, PARAGRAPH);
    caretAt(paragraphs[0]!);
    const pressed = new MouseEvent("pointerdown", { bubbles: true, shiftKey: true });
    paragraphs[1]!.dispatchEvent(pressed);
    // The press did not drop the selection, so the engine has something to extend.
    expect(document.getSelection()?.rangeCount).toBe(1);
    await frame.settle();
    expect(frame.of("rowActivated")).toEqual([]);
    expect(isEditing()).toBe(true);
    expect(
      instances(frame.container, ARTICLE).map((el) => el.dataset.jxPath !== undefined),
    ).toEqual([true, false, false]);
    // Without Shift the same press is a promotion, as ever.
    paragraphs[1]!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await frame.settle();
    expect(frame.of("rowActivated").map((m) => m.row)).toEqual([1]);
  });
});

describe("End and Home in a block that holds a chip", () => {
  const TAGS: JxPath = ["children", 0, "map"];

  /** Stand in for the engine: End steps past a trailing chip, into the block that follows. */
  function engineLeavesBlock(next: Node): () => void {
    const proto = Selection.prototype;
    // Undefined where the DOM under test has no `modify`, and put back as that.
    const had = proto.modify;
    proto.modify = function modify(this: Selection, alter: string) {
      if (alter === "extend") {
        this.setBaseAndExtent(this.anchorNode!, this.anchorOffset, next, 0);
      } else {
        this.collapse(next, 0);
      }
    };
    return () => {
      proto.modify = had;
    };
  }

  test("End keeps the caret in the block when the engine would step into the next row", async () => {
    const frame = await frameWith(LEAF_ROWS("Tag ${$map.item.name}"));
    const [first, second] = instances(frame.container, TAGS);
    caretAt(first!);
    expect(isEditing()).toBe(true);
    const restore = engineLeavesBlock(second!.firstChild!);
    try {
      const end = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "End" });
      first!.dispatchEvent(end);
      const selection = document.getSelection()!;
      expect(end.defaultPrevented).toBe(true);
      // After the chip, at the block's own edge: not in the echo row, where typing goes nowhere.
      expect(selection.focusNode).toBe(first!);
      expect(selection.focusOffset).toBe(first!.childNodes.length);
      expect(selection.isCollapsed).toBe(true);

      const home = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Home" });
      first!.dispatchEvent(home);
      expect(home.defaultPrevented).toBe(true);
      expect(selection.focusNode).toBe(first!);
      expect(selection.focusOffset).toBe(0);
      expect(selection.isCollapsed).toBe(true);

      // With Shift the selection is extended to the same edge, and its anchor stays.
      const extend = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "End",
        shiftKey: true,
      });
      first!.dispatchEvent(extend);
      expect(extend.defaultPrevented).toBe(true);
      expect([selection.anchorNode === first!, selection.anchorOffset]).toEqual([true, 0]);
      expect(selection.focusNode).toBe(first!);
      expect(selection.focusOffset).toBe(first!.childNodes.length);
    } finally {
      restore();
    }
  });

  test("a block with no chip, and a chord, are the engine's own", async () => {
    const frame = await frameWith(LEAF_ROWS("plain"));
    const [first, second] = instances(frame.container, TAGS);
    caretAt(first!);
    const restore = engineLeavesBlock(second!.firstChild!);
    try {
      const end = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "End" });
      first!.dispatchEvent(end);
      expect(end.defaultPrevented).toBe(false);
    } finally {
      restore();
    }
    dropFrame();
    const bound = await frameWith(LEAF_ROWS("Tag ${$map.item.name}"));
    const [block, next] = instances(bound.container, TAGS);
    caretAt(block!);
    const undo = engineLeavesBlock(next!.firstChild!);
    try {
      const chord = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "End",
      });
      block!.dispatchEvent(chord);
      expect(chord.defaultPrevented).toBe(false);
    } finally {
      undo();
    }
  });
});
