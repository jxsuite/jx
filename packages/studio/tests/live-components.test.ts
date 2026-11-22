/**
 * The live component lane (`services/live-components.ts`): a project component saved in Studio or
 * rewritten on disk is redefined in every canvas frame, its Library preview is evicted, and nothing
 * that is not a component, or that the chrome lane owns, is touched.
 */
import "./with-dom.js";

import { beforeEach, describe, expect, test } from "bun:test";
import type { JxDocument } from "@jxsuite/schema/types";

import { componentTagOf, createLiveComponentLane } from "../src/services/live-components";
import type { LiveComponentDeps, LiveComponentTab } from "../src/services/live-components";
import {
  createPreviewCache,
  evictPreview,
  onPreviewsInvalidated,
} from "../src/browse/library-preview";

/* SAFETY: `./with-dom.js` registers happy-dom's GlobalRegistrator, which copies the window's members
   onto globalThis, `happyDOM` (the DetachedWindowAPI that owns setURL) among them. */
const { happyDOM } = globalThis as typeof globalThis & {
  happyDOM: { setURL: (u: string) => void };
};
happyDOM.setURL("http://localhost:3000/packages/studio/index.html");

const card: JxDocument = {
  tagName: "site-card",
  state: { title: "" },
  children: [{ tagName: "h2", textContent: "${state.title}" }],
};

const page: JxDocument = { tagName: "main", children: [] };

interface Harness {
  deps: LiveComponentDeps;
  workspace: { projectRoot: string | null; tabs: Map<string, LiveComponentTab> };
  files: Map<string, string>;
  redefined: { doc: JxDocument; base: string }[];
  evicted: string[];
  noted: string[];
  repaints: number;
}

function harness(): Harness {
  const workspace: Harness["workspace"] = { projectRoot: "sites/demo", tabs: new Map() };
  const files = new Map<string, string>();
  const evicted: string[] = [];
  const noted: string[] = [];
  const redefined: Harness["redefined"] = [];
  const h: Harness = {
    deps: {
      evictPreview: (path) => {
        evicted.push(path);
      },
      noteComponent: (path) => {
        noted.push(path);
        return true;
      },
      readFile: (path) => {
        const text = files.get(path);
        return text === undefined ? Promise.reject(new Error("missing")) : Promise.resolve(text);
      },
      redefineOnCanvases: (doc, base) => {
        redefined.push({ base, doc });
        return 2;
      },
      repaint: () => {
        h.repaints += 1;
      },
      workspace,
    },
    evicted,
    files,
    noted,
    redefined,
    repaints: 0,
    workspace,
  };
  return h;
}

let h: Harness;
beforeEach(() => {
  h = harness();
});

describe("componentTagOf", () => {
  test("is the hyphenated tagName, as the registry's scan reads it", () => {
    expect(componentTagOf(card, "components/site-card.json")).toBe("site-card");
    expect(componentTagOf(page, "pages/index.json")).toBeNull();
    expect(componentTagOf(null, "x.json")).toBeNull();
  });
});

describe("saved", () => {
  test("redefines a project component in the frames, at the file's URL, and evicts its preview", () => {
    const lane = createLiveComponentLane(h.deps);
    const result = lane.saved("components/site-card.json", card);
    expect(result).toEqual({ canvases: 2, registryChanged: false, tag: "site-card" });
    expect(h.redefined).toHaveLength(1);
    expect(h.redefined[0]!.doc).toBe(card);
    expect(h.redefined[0]!.base).toBe("http://localhost:3000/sites/demo/components/site-card.json");
    expect(h.evicted).toEqual(["components/site-card.json"]);
  });

  test("does nothing for a document that is not a component", () => {
    const lane = createLiveComponentLane(h.deps);
    expect(lane.saved("pages/index.json", page)).toBeNull();
    expect(lane.saved(null, card)).toBeNull();
    expect(lane.saved("components/site-card.json", null)).toBeNull();
    expect(h.redefined).toHaveLength(0);
    expect(h.evicted).toHaveLength(0);
  });

  test("leaves a kit component to the chrome lane, which posts to the frames itself", () => {
    h.workspace.projectRoot = "/w/jx/packages/ui";
    const lane = createLiveComponentLane(h.deps);
    expect(lane.saved("components/jx-tree.json", { tagName: "jx-tree" })).toBeNull();
    expect(h.redefined).toHaveLength(0);
  });

  test("does nothing with no project open", () => {
    h.workspace.projectRoot = null;
    expect(createLiveComponentLane(h.deps).saved("components/site-card.json", card)).toBeNull();
  });

  test("an opaque shell origin redefines nothing and still evicts, without throwing", () => {
    happyDOM.setURL("about:blank");
    try {
      const result = createLiveComponentLane(h.deps).saved("components/site-card.json", card);
      expect(result).toEqual({ canvases: 0, registryChanged: false, tag: "site-card" });
      expect(h.redefined).toHaveLength(0);
      expect(h.evicted).toEqual(["components/site-card.json"]);
    } finally {
      happyDOM.setURL("http://localhost:3000/packages/studio/index.html");
    }
  });
});

describe("changedOnDisk", () => {
  test("reads and parses the file, updates the registry, redefines it and repaints", async () => {
    h.files.set("components/site-card.json", JSON.stringify(card));
    const result = await createLiveComponentLane(h.deps).changedOnDisk("components/site-card.json");
    expect(result).toEqual({ canvases: 2, registryChanged: true, tag: "site-card" });
    expect(h.noted).toEqual(["components/site-card.json"]);
    expect(h.redefined[0]!.doc.tagName).toBe("site-card");
    expect(h.evicted).toEqual(["components/site-card.json"]);
    expect(h.repaints).toBe(1);
  });

  test("reads a .jxn definition too", async () => {
    h.files.set("components/site-badge.jxn", 'site-badge {\n  span "hi"\n}\n');
    const result = await createLiveComponentLane(h.deps).changedOnDisk("components/site-badge.jxn");
    expect(result?.tag).toBe("site-badge");
  });

  test("leaves a file open in a dirty tab alone: its save is what redefines", async () => {
    h.files.set("components/site-card.json", JSON.stringify(card));
    h.workspace.tabs.set("t1", { doc: { dirty: true }, documentPath: "components/site-card.json" });
    expect(await createLiveComponentLane(h.deps).changedOnDisk("components/site-card.json")).toBe(
      null,
    );
    expect(h.redefined).toHaveLength(0);
    expect(h.noted).toHaveLength(0);
  });

  test("redefines a file open in a CLEAN tab", async () => {
    h.files.set("components/site-card.json", JSON.stringify(card));
    h.workspace.tabs.set("t1", {
      doc: { dirty: false },
      documentPath: "components/site-card.json",
    });
    const result = await createLiveComponentLane(h.deps).changedOnDisk("components/site-card.json");
    expect(result?.tag).toBe("site-card");
  });

  test("ignores files that are not documents, do not parse, or are gone", async () => {
    const lane = createLiveComponentLane(h.deps);
    expect(await lane.changedOnDisk("public/logo.png")).toBeNull();
    h.files.set("components/broken.json", "{ nope");
    expect(await lane.changedOnDisk("components/broken.json")).toBeNull();
    expect(await lane.changedOnDisk("components/gone.json")).toBeNull();
    expect(h.redefined).toHaveLength(0);
    expect(h.repaints).toBe(0);
  });

  test("a page on disk updates nothing but what the registry says", async () => {
    h.files.set("pages/index.json", JSON.stringify(page));
    h.deps.noteComponent = () => false;
    expect(await createLiveComponentLane(h.deps).changedOnDisk("pages/index.json")).toBeNull();
    expect(h.redefined).toHaveLength(0);
    expect(h.repaints).toBe(0);
  });

  test("drops a read that lands after the project changed", async () => {
    let release: (text: string) => void = () => {};
    h.deps.readFile = () =>
      new Promise<string>((resolve) => {
        release = resolve;
      });
    const pending = createLiveComponentLane(h.deps).changedOnDisk("components/site-card.json");
    h.workspace.projectRoot = "sites/other";
    release(JSON.stringify(card));
    expect(await pending).toBeNull();
    expect(h.redefined).toHaveLength(0);
  });
});

describe("evictPreview", () => {
  test("drops one path from every live cache and detaches its rendered preview", () => {
    const a = createPreviewCache();
    const b = createPreviewCache();
    const box = document.createElement("div");
    const stale = document.createElement("span");
    box.append(stale);
    a.set("components/site-card.json", stale);
    b.set("components/site-card.json", document.createElement("span"));
    b.set("components/other.json", document.createElement("span"));
    evictPreview("components/site-card.json");
    expect(a.has("components/site-card.json")).toBe(false);
    expect(b.has("components/site-card.json")).toBe(false);
    expect(b.has("components/other.json")).toBe(true);
    expect(stale.isConnected).toBe(false);
    expect(box.childElementCount).toBe(0);
  });

  test("tells the panes to repaint when it dropped something, and only then", () => {
    let told = 0;
    const stop = onPreviewsInvalidated(() => {
      told += 1;
    });
    try {
      const cache = createPreviewCache();
      cache.set("components/told.json", document.createElement("span"));
      evictPreview("components/told.json");
      expect(told).toBe(1);
      evictPreview("components/never-rendered.json");
      expect(told).toBe(1);
    } finally {
      stop();
    }
  });
});

describe("the dependents door", () => {
  test("evicts each dependent and redefines each changed tag Studio did not just save", async () => {
    h.files.set("components/site-card.json", JSON.stringify(card));
    h.files.set("components/site-hero.json", JSON.stringify({ ...card, tagName: "site-hero" }));
    const paths = new Map([
      ["site-card", "components/site-card.json"],
      ["site-hero", "components/site-hero.json"],
    ]);
    const lane = createLiveComponentLane({ ...h.deps, componentPath: (tag) => paths.get(tag) });
    const results = await lane.dependentsInvalidated(
      ["pages/index.json"],
      ["site-card", "site-hero", "site-hero", "pkg-tag"],
      (path) => path === "components/site-hero.json",
    );
    expect(results.map((result) => result?.tag)).toEqual(["site-card"]);
    expect(h.evicted).toEqual(["pages/index.json", "components/site-card.json"]);
    expect(h.redefined.map((entry) => entry.doc.tagName)).toEqual(["site-card"]);
  });

  test("without a registry lookup, only the dependents' previews go", async () => {
    const lane = createLiveComponentLane(h.deps);
    expect(await lane.dependentsInvalidated(["pages/a.json"], ["site-card"], () => false)).toEqual(
      [],
    );
    expect(h.evicted).toEqual(["pages/a.json"]);
  });
});
