/**
 * The Files tree draws a WINDOW over a flattened row model.
 *
 * The recursion it replaces had no row list at all — a template per directory level — so a project
 * with an expanded `node_modules` built tens of thousands of rows, each with an `sp-icon` custom
 * element, on every repaint. Flattening is what makes a window possible, and it is also what makes
 * the questions below answerable: which row is below this one, where does this row sit among its
 * siblings, and where is the tab stop when the selected row has scrolled out of the DOM.
 */
import { flush, installMockPlatform, installResizeObserver, stubRect } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { requireProjectState, setProjectState } from "../src/store";
import { initLayers } from "../src/ui/layers";
import type { DirEntry } from "../src/types";

/** The recorded drag sources, so a case can start a real drag instead of forging its evidence. */
const draggables: { element?: HTMLElement; onDragStart?: () => void; onDrop?: () => void }[] = [];

void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: (opts: { element?: HTMLElement }) => {
    draggables.push(opts);
    return () => {};
  },
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}));

const { FILE_ROW_HEIGHT, mountFilesPanel, unmountFilesPanel } = await import("../src/files/files");

/** Files in the project root — enough that a window is a small fraction of the tree. */
const FILE_COUNT = 300;
/** A Navigator tall enough for ten rows. */
const VIEWPORT = 240;

let scroller: HTMLElement;
let host: HTMLElement;
let renders = 0;

function fileName(index: number): string {
  return `file-${String(index).padStart(3, "0")}.json`;
}

/** A root of 300 files with one expanded directory in front of them. */
function seedProject(): void {
  const root: DirEntry[] = [
    { name: "pages", path: "pages", type: "directory" },
    ...Array.from({ length: FILE_COUNT }, (_v, index) => ({
      name: fileName(index),
      path: fileName(index),
      type: "file" as const,
    })),
  ];
  setProjectState({
    dirs: new Map<string, DirEntry[]>([
      [".", root],
      [
        "pages",
        [
          { name: "index.json", path: "pages/index.json", type: "file" },
          { name: "about.json", path: "pages/about.json", type: "file" },
        ],
      ],
    ]),
    expanded: new Set(["pages"]),
    isSiteProject: true,
    name: "Demo",
    projectConfig: { name: "Demo" },
    projectDirs: [],
    projectRoot: ".",
    searchQuery: "",
    selectedPath: null,
  } as never);
}

/** Rows in the model: the directory, its two children, and every root file. */
const ROW_COUNT = 3 + FILE_COUNT;

/** Happy-dom performs no layout, so the tree's top relative to the scroller is stubbed. */
function place(): void {
  const tree = host.querySelector<HTMLElement>('[part="tree"]');
  if (tree) {
    (tree as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
      ({ height: ROW_COUNT * FILE_ROW_HEIGHT, top: -scroller.scrollTop }) as DOMRect;
  }
}

/** The Navigator's repaint: the panel is drawn again, which re-projects into the document. */
function repaint(): void {
  renders += 1;
  mountFilesPanel(host, repaint);
  place();
}

async function renderTree(): Promise<void> {
  repaint();
  await flush();
  place();
}

/**
 * Mount, then settle: the first paint draws every row because nothing has been laid out to measure,
 * and the watch's opening measurement is what asks for the second, windowed pass.
 */
async function renderWindowed(): Promise<void> {
  mountFilesPanel(host, repaint);
  await flush(3);
  place();
  await flush(3);
  place();
  renders = 0;
}

async function scrollTo(top: number): Promise<void> {
  scroller.scrollTop = top;
  place();
  scroller.dispatchEvent(new Event("scroll"));
  await flush();
  await flush();
}

function rows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[part="row"][role="treeitem"]')];
}

function rowFor(path: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[part="row"][data-value="${CSS.escape(path)}"]`);
}

/**
 * The two spacers, in pixels.
 *
 * `jx-tree` draws them from its own `padtop`/`padbottom` props, so what the window reserves is read
 * off the element the host handed the numbers to rather than off a declaration the host composed —
 * which is the same evidence, one writer later.
 */
function pads(): number[] {
  return [...host.querySelectorAll<HTMLElement>('[part="pad-top"], [part="pad-bottom"]')].map(
    (el) => Number(/(-?[\d.]+)px/.exec(el.getAttribute("style") ?? "")?.[1] ?? 0),
  );
}

/** Stand the Navigator up around a seeded project and let the tree window it. */
async function mountWindowed(): Promise<void> {
  document.body.innerHTML = `
    <div id="scroller"><div id="host"></div></div>
    <div id="layer-popover"></div>
    <div id="layer-modal"></div>
    <div id="layer-dialog"></div>
  `;
  initLayers();
  installMockPlatform();
  scroller = document.querySelector("#scroller") as HTMLElement;
  scroller.style.overflowY = "auto";
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: VIEWPORT });
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    value: ROW_COUNT * FILE_ROW_HEIGHT,
  });
  stubRect(scroller, { height: VIEWPORT, top: 0 });
  host = document.querySelector("#host") as HTMLElement;
  renders = 0;
  draggables.length = 0;
  seedProject();
  await renderWindowed();
}

function tearDown(): void {
  unmountFilesPanel();
  setProjectState(null);
  document.body.innerHTML = "";
}

beforeEach(mountWindowed);

afterEach(tearDown);

describe("the window", () => {
  test("draws the viewport and its overscan, not the project", () => {
    const drawn = rows();
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(20);
    expect(drawn.length).toBeLessThan(ROW_COUNT);
    // An expanded directory contributes its children right after itself, in display order.
    expect(drawn.slice(0, 3).map((el) => el.dataset.value)).toEqual([
      "pages",
      "pages/about.json",
      "pages/index.json",
    ]);
  });

  test("reserves the scroll height of every row it did not draw", () => {
    const [padTop, padBottom] = pads();
    expect(padTop).toBe(0);
    expect(padTop! + rows().length * FILE_ROW_HEIGHT + padBottom!).toBe(
      ROW_COUNT * FILE_ROW_HEIGHT,
    );
  });

  test("moves with the scroller, and still totals the whole project", async () => {
    await scrollTo(FILE_ROW_HEIGHT * 200);
    expect(rowFor("pages")).toBeNull();
    expect(rowFor(fileName(200))).not.toBeNull();
    const [padTop, padBottom] = pads();
    expect(padTop).toBeGreaterThan(0);
    expect(padTop! + rows().length * FILE_ROW_HEIGHT + padBottom!).toBe(
      ROW_COUNT * FILE_ROW_HEIGHT,
    );
  });

  test("reports each row's place in the PROJECT, not in the window", async () => {
    await scrollTo(FILE_ROW_HEIGHT * 200);
    const row = rowFor(fileName(200))!;
    // The 202nd of 301 entries in the root (the `pages` directory sorts first).
    expect(row.getAttribute("aria-posinset")).toBe("202");
    expect(row.getAttribute("aria-setsize")).toBe(String(FILE_COUNT + 1));
    expect(row.getAttribute("aria-level")).toBe("1");
  });

  test("a child of an expanded directory says which level it is on", () => {
    expect(rowFor("pages/index.json")!.getAttribute("aria-level")).toBe("2");
    expect(rowFor("pages/index.json")!.getAttribute("aria-posinset")).toBe("2");
    expect(rowFor("pages/index.json")!.getAttribute("aria-setsize")).toBe("2");
  });

  test("keeps exactly one tab stop, and keeps it inside the window", async () => {
    expect(rows().filter((el) => el.tabIndex === 0)).toHaveLength(1);
    await scrollTo(FILE_ROW_HEIGHT * 200);
    // The row that WOULD hold it (the first) has scrolled away; a tree with no tabbable row is a
    // Panel the Tab key skips entirely.
    const stops = rows().filter((el) => el.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]!.dataset.value).toBe(rows()[0]!.dataset.value);
  });

  test("the selected row takes the tab stop while it is on screen", async () => {
    requireProjectState().selectedPath = fileName(1);
    await renderTree();
    expect(rowFor(fileName(1))!.tabIndex).toBe(0);
    expect(rows().filter((el) => el.tabIndex === 0)).toHaveLength(1);
  });
});

describe("the keyboard walks the model", () => {
  /* `jx-tree` owns the keyboard, and it walks the DRAWN rows: the slice is all it can see, so ↓ on
     the last of them has nowhere to land and it says `move` instead of performing anything. That
     event is the whole windowing contract, and answering it — which model row is next, and how far
     to scroll to bring it into view — is what `files.ts` still owns. */
  test("↓ steps past the last DRAWN row instead of stopping at it", async () => {
    const last = rows().at(-1)!;
    const from = last.dataset.value!;
    /* The row the model has next. The window starts at the top, and its first three rows are the
       directory and its two children, so the file after the last drawn one is that many in. */
    const next = fileName(rows().length - 3);
    /* The caret is put on the row the key is pressed on, which is the app's own invariant rather
       than a convenience: Tab lands on the tab stop, and every gesture that moves the focus writes
       the caret before it moves anything. A test that focused a row the caret was not on would be
       measuring a state the tree cannot be in. */
    requireProjectState().selectedPath = from;
    await renderTree();
    const row = rowFor(from)!;
    row.focus();

    row.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
    );
    await flush();
    await flush();

    // The row below the window: the walk scrolled to it and the repaint handed it the keyboard.
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(next).not.toBe(from);
    expect((document.activeElement as HTMLElement).dataset.value).toBe(next);
    /* And the selection went with it, exactly as it does for a step the element could perform
       itself: `jx-tree` raises `select` beside `change` on every arrow inside the drawn slice, so a
       step the window could not satisfy must not be the one step that silently does not. It is also
       what puts the tab stop on the revealed row — without it the element's caret is still on a row
       the new window does not draw, and the reader is FOCUSED on one row while Tab comes back to
       another. */
    expect(rowFor(next)!.getAttribute("aria-selected")).toBe("true");
    expect(rowFor(next)!.tabIndex).toBe(0);
    expect(rows().filter((el) => el.tabIndex === 0)).toHaveLength(1);
  });

  test("Tab into a scrolled tree lands on a row, and ↑ from it walks the model", async () => {
    await scrollTo(FILE_ROW_HEIGHT * 200);
    expect(requireProjectState().selectedPath).toBeNull();
    /* The state a reader is in the first time they reach a scrolled tree: nothing selected, and the
       ONE tab stop is wherever `jx-tree` could put it — the first row the window drew, because the
       row `current` names is not one of them. The caret has to name that row too, or the first key
       press reports a move `from` nothing and the flow answers it about the top of the project,
       two hundred rows away from what is on screen. */
    const first = rows()[0]!;
    expect(first.tabIndex).toBe(0);
    const index = Number(first.dataset.value!.slice("file-".length, -".json".length));
    first.focus();

    first.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowUp" }),
    );
    await flush();
    await flush();

    expect(rowFor(fileName(index - 1))).not.toBeNull();
    expect((document.activeElement as HTMLElement).dataset.value).toBe(fileName(index - 1));
  });

  test("↓ at the very bottom of the MODEL stays put — a tree does not wrap", async () => {
    const lastPath = fileName(FILE_COUNT - 1);
    requireProjectState().selectedPath = lastPath;
    await renderTree();
    // Scroll it into the window, then hand it the keyboard.
    await scrollTo(ROW_COUNT * FILE_ROW_HEIGHT);
    const row = rowFor(lastPath)!;
    row.focus();
    const top = scroller.scrollTop;

    row.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
    );
    await flush();
    await flush();

    expect(scroller.scrollTop).toBe(top);
    expect((document.activeElement as HTMLElement).dataset.value).toBe(lastPath);
  });

  test("a letter reaches a row two hundred above the window, not one of the eleven drawn", async () => {
    /*
     * The gap this closed. `jx-tree`'s own typeahead searches the DRAWN rows and wraps inside them,
     * so over three hundred rows a letter reached whichever of the eleven painted rows started with
     * it and called that the tree's next match. Unlike a move off the end of the slice the element
     * cannot discover the mistake: the search always answers, and the answer is simply the wrong
     * row. So a windowed tree dispatches every printable character and the flow resolves it here.
     *
     * `index.json` is row 1 of 303 and is the only row in the project whose name starts with `i`.
     * From row 150 it is a hundred and fifty rows above the window: unreachable by the element under
     * any implementation that looks at elements.
     */
    await scrollTo(FILE_ROW_HEIGHT * 150);
    const first = rows()[0]!;
    expect(rowFor("pages/index.json")).toBeNull();
    first.focus();

    first.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "i" }),
    );
    await flush();
    await flush();

    expect(rowFor("pages/index.json")).not.toBeNull();
    expect((document.activeElement as HTMLElement).dataset.value).toBe("pages/index.json");
    // Selection follows the caret, exactly as it does for a `move` the window could not satisfy.
    expect(rowFor("pages/index.json")!.getAttribute("aria-selected")).toBe("true");
  });

  test("a letter no row in the MODEL starts with moves nothing", async () => {
    await scrollTo(FILE_ROW_HEIGHT * 150);
    const first = rows()[0]!;
    const at = first.dataset.value;
    const top = scroller.scrollTop;
    first.focus();

    first.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "q" }),
    );
    await flush();
    await flush();

    expect(scroller.scrollTop).toBe(top);
    expect((document.activeElement as HTMLElement).dataset.value).toBe(at);
  });
});

describe("← climbs to a parent the window is not drawing", () => {
  /** One expanded directory holding every file, so its own row is what scrolls away. */
  function seedDeepProject(): void {
    setProjectState({
      dirs: new Map<string, DirEntry[]>([
        [".", [{ name: "deep", path: "deep", type: "directory" }]],
        [
          "deep",
          Array.from({ length: FILE_COUNT }, (_v, index) => ({
            name: fileName(index),
            path: `deep/${fileName(index)}`,
            type: "file" as const,
          })),
        ],
      ]),
      expanded: new Set(["deep"]),
      isSiteProject: true,
      name: "Demo",
      projectConfig: { name: "Demo" },
      projectDirs: [],
      projectRoot: ".",
      searchQuery: "",
      selectedPath: null,
    } as never);
  }

  beforeEach(async () => {
    seedDeepProject();
    await renderWindowed();
  });

  test("the parent is the model's, not the nearest row on screen", async () => {
    await scrollTo(FILE_ROW_HEIGHT * 200);
    expect(rowFor("deep")).toBeNull();
    // Every row on screen is a sibling at the same level, so a scan for "the nearest drawn row at a
    // Shallower level" has nothing at all to find.
    expect(rows().every((el) => el.getAttribute("aria-level") === "2")).toBe(true);
    const row = rowFor(`deep/${fileName(200)}`)!;
    requireProjectState().selectedPath = `deep/${fileName(200)}`;
    await renderTree();
    rowFor(`deep/${fileName(200)}`)!.focus();

    row.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowLeft" }),
    );
    await flush();
    await flush();

    /* The one key that could never have been the element's: `jx-tree` climbs to the nearest DRAWN
       row at a shallower level, and the answer here is a hundred and ninety rows above the window.
       The flow scans its own row model for it. */
    expect(requireProjectState().selectedPath).toBe("deep");
    expect(scroller.scrollTop).toBeLessThan(FILE_ROW_HEIGHT * 200);
  });
});

/**
 * The language chip (`[part="locale"]`) is drawn INSIDE the 24px row.
 *
 * `FILE_ROW_HEIGHT` mirrors the `--jx-control-h` the document gives `[part="row"]`, and the
 * window's scroll reservation is that number times the rows it did not draw. A chip that grew the
 * box would desynchronise the scrollbar from the model on every multilingual project — silently,
 * because nothing measures a row until one has been laid out.
 */
describe("a multilingual project", () => {
  /** The same shape as {@link seedProject}, with the expanded directory naming a declared locale. */
  function seedLocalizedProject(): void {
    const root: DirEntry[] = [
      { name: "fr", path: "fr", type: "directory" },
      ...Array.from({ length: FILE_COUNT }, (_v, index) => ({
        name: fileName(index),
        path: fileName(index),
        type: "file" as const,
      })),
    ];
    setProjectState({
      dirs: new Map<string, DirEntry[]>([
        [".", root],
        [
          "fr",
          [
            { name: "index.json", path: "fr/index.json", type: "file" },
            { name: "about.json", path: "fr/about.json", type: "file" },
          ],
        ],
      ]),
      expanded: new Set(["fr"]),
      isSiteProject: true,
      name: "Demo",
      projectConfig: { i18n: { defaultLocale: "en", locales: ["en", "fr"] }, name: "Demo" },
      projectDirs: [],
      projectRoot: ".",
      searchQuery: "",
      selectedPath: null,
    } as never);
  }

  beforeEach(async () => {
    seedLocalizedProject();
    await renderWindowed();
  });

  test("chips the rows under a declared locale, in that language's own words", () => {
    expect(rowFor("fr/index.json")!.querySelector('[part="locale"]')?.textContent).toBe("français");
    // The directory names the locale, so it carries the chip too.
    expect(rowFor("fr")!.querySelector('[part="locale"]')?.textContent).toBe("français");
    // A file under no locale directory gets none — inventing the default locale here would be a
    // Claim about `routing` the path does not make.
    expect(rowFor(fileName(0))!.querySelector('[part="locale"]')).toBeNull();
  });

  test("leaves the window and the ARIA set sizes exactly where they were", async () => {
    expect(rows().length).toBeLessThan(20);
    const [padTop, padBottom] = pads();
    expect(padTop! + rows().length * FILE_ROW_HEIGHT + padBottom!).toBe(
      ROW_COUNT * FILE_ROW_HEIGHT,
    );
    expect(rowFor("fr/index.json")!.getAttribute("aria-setsize")).toBe("2");
    expect(rowFor("fr/index.json")!.getAttribute("aria-level")).toBe("2");
    await scrollTo(FILE_ROW_HEIGHT * 200);
    expect(rowFor(fileName(200))!.getAttribute("aria-posinset")).toBe("202");
    expect(rowFor(fileName(200))!.getAttribute("aria-setsize")).toBe(String(FILE_COUNT + 1));
  });
});

describe("a density switch", () => {
  test("re-measures the spacers without a scroll, from the tree's own resize", async () => {
    // The same drift the Outline had, through the same primitive: the rows shrink in place under
    // `[data-density=compact]`, nothing scrolls, the Navigator's box is unchanged, and the spacers
    // Stood at 24px a row. Happy-dom cannot shrink a row, so the drawn rows' measurement is
    // Stubbed and the tree's resize is delivered by hand, to the element the watch observed.
    tearDown();
    const ro = installResizeObserver();
    try {
      await mountWindowed();
      const list = host.querySelector<HTMLElement>('[part="tree"]')!;
      expect(ro.observes(list)).toBe(true);
      const COMPACT = 20;
      for (const el of rows()) {
        Object.defineProperty(el, "offsetHeight", { configurable: true, value: COMPACT });
      }
      ro.resize(list);
      await flush(3);
      const [padTop, padBottom] = pads();
      expect(padTop).toBe(0);
      expect(padTop! + rows().length * COMPACT + padBottom!).toBe(ROW_COUNT * COMPACT);
    } finally {
      ro.restore();
    }
  });
});

describe("a drag keeps the window it started with", () => {
  test("a scroll mid-drag does not repaint the rows pragmatic-dnd is holding", async () => {
    const dragged = rows()[2]!;
    // A REAL drag, through the source the document's `onNodeCreated` registered — the predecessor
    // Forged a `.dragging` class, which was the same thing the guard then went looking for, so the
    // Case could not have caught the guard reading the wrong evidence.
    const source = draggables.find((d) => d.element === dragged)!;
    expect(source).toBeDefined();
    source.onDragStart!();
    const before = renders;

    scroller.scrollTop = FILE_ROW_HEIGHT * 100;
    place();
    scroller.dispatchEvent(new Event("scroll"));
    await flush();

    expect(renders).toBe(before);
    expect(dragged.isConnected).toBe(true);

    source.onDrop!();
  });
});
