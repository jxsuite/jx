/**
 * The live chrome lane (`services/live-surfaces.ts`): a saved surface document or kit component
 * re-mounts the roots it draws in the running shell, and nothing else a save can be is touched.
 */
import "./with-dom.js";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { reactive } from "@vue/reactivity";
import { elementDefinition } from "@jxsuite/runtime";
import type { JxDocument } from "@jxsuite/schema/types";

import {
  applyLiveSave,
  canvasBaseFor,
  createLiveSurfaceSaver,
  liveSaveNotice,
  liveSurfaceTarget,
} from "../src/services/live-surfaces";
import { mountsOf, resetSurfaceRegistry, surfaceMounts } from "../src/services/surface-registry";
import { mountSurface, registerSurface, surfaceDocument } from "../src/ui/surface";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

/* A real origin, so the canvas base the lane hands a frame is a URL and not `null/…`. */
const { happyDOM } = globalThis as unknown as { happyDOM: { setURL: (u: string) => void } };
happyDOM.setURL("http://localhost:3000/packages/studio/index.html");

/** A surface over one probe element, with a host record it projects. */
const surfaceV1: JxDocument = {
  tagName: "div",
  children: [
    { tagName: "jx-live-probe", $props: { word: { $ref: "#/state/model/word" } } },
    { tagName: "span", textContent: "v1 ${state.model.word}" },
  ],
};

const surfaceV2: JxDocument = {
  tagName: "div",
  children: [{ tagName: "span", textContent: "v2 ${state.model.word}" }],
};

/** The probe element, in two definitions that draw the same prop differently. */
const probeV1: JxDocument = {
  tagName: "jx-live-probe",
  observedAttributes: ["word"],
  state: { word: "" },
  children: [{ tagName: "b", attributes: { part: "word" }, textContent: "[${state.word}]" }],
};

const probeV2: JxDocument = {
  tagName: "jx-live-probe",
  observedAttributes: ["word"],
  state: { word: "" },
  children: [{ tagName: "i", attributes: { part: "word" }, textContent: "(${state.word})" }],
};

let host: HTMLElement;

beforeEach(() => {
  resetSurfaceRegistry();
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  host.remove();
});

describe("liveSurfaceTarget", () => {
  test("names a surface or a kit component from any root that contains it", () => {
    expect(liveSurfaceTarget("/w/jx/packages/studio", "src/surfaces/menu.json")).toEqual({
      kind: "surface",
      name: "menu",
    });
    expect(liveSurfaceTarget("/w/jx", "packages/studio/src/surfaces/style-panel.json")).toEqual({
      kind: "surface",
      name: "style-panel",
    });
    expect(liveSurfaceTarget("/w/jx/packages/ui", "components/jx-tree.json")).toEqual({
      kind: "element",
      tag: "jx-tree",
    });
    expect(liveSurfaceTarget("/w/jx/", "./packages/ui/components/jx-tab-panel.json")).toEqual({
      kind: "element",
      tag: "jx-tab-panel",
    });
    /* A Windows root and a POSIX-relative path meet in one spelling. */
    expect(
      liveSurfaceTarget(String.raw`C:\w\jx\packages\ui`, String.raw`components\jx-icon.json`),
    ).toEqual({
      kind: "element",
      tag: "jx-icon",
    });
  });

  test("is null for every other file, and for no project at all", () => {
    /* The examples, a site, a starter: the chrome's paths never appear under them. */
    expect(liveSurfaceTarget("/w/jx/examples", "pages/index.json")).toBeNull();
    expect(liveSurfaceTarget("/w/jx/sites/jxsuite.com", "src/surfaces/menu.json")).toBeNull();
    /* The kit's stylebook and its behaviours are not components. */
    expect(liveSurfaceTarget("/w/jx/packages/ui", "stylebook/jx-tree.json")).toBeNull();
    expect(liveSurfaceTarget("/w/jx/packages/ui", "src/behaviors/tree.ts")).toBeNull();
    expect(liveSurfaceTarget("/w/jx/packages/ui", "components/README.md")).toBeNull();
    /* A surface adapter beside its document is TypeScript, and a nested path is not a surface. */
    expect(liveSurfaceTarget("/w/jx/packages/studio", "src/surfaces/menu.ts")).toBeNull();
    expect(liveSurfaceTarget("/w/jx/packages/studio", "src/surfaces/sub/menu.json")).toBeNull();
    expect(liveSurfaceTarget(null, "src/surfaces/menu.json")).toBeNull();
    expect(liveSurfaceTarget("/w/jx/packages/studio", null)).toBeNull();
    expect(liveSurfaceTarget("", "")).toBeNull();
  });
});

describe("applyLiveSave", () => {
  test("a saved surface re-registers the document and re-mounts every root of that name", async () => {
    await applyLiveSave({ kind: "element", tag: "jx-live-probe" }, probeV1);
    registerSurface("live-probe", surfaceV1);
    const model = reactive({ word: "hello" });
    await mountSurface("live-probe", { model }, host);
    const second = document.createElement("div");
    document.body.append(second);
    await mountSurface("live-probe", { model }, second);
    await tick();
    expect(host.querySelector("span")?.textContent).toBe("v1 hello");
    expect(host.querySelector("jx-live-probe b")?.textContent).toBe("[hello]");

    const result = await applyLiveSave({ kind: "surface", name: "live-probe" }, surfaceV2);
    await tick();
    expect(result).toEqual({
      remounted: 2,
      target: { kind: "surface", name: "live-probe" },
    });
    expect(surfaceDocument("live-probe")).toBe(surfaceV2);
    /* Both roots show the new document, over the SAME host scope. */
    expect(host.querySelector("span")?.textContent).toBe("v2 hello");
    expect(second.querySelector("span")?.textContent).toBe("v2 hello");
    expect(host.querySelector("jx-live-probe")).toBeNull();
    model.word = "again";
    await tick();
    expect(second.querySelector("span")?.textContent).toBe("v2 again");
    /* Re-mounted, not doubled: the registry still holds one entry per host. */
    expect(mountsOf("live-probe").length).toBe(2);
    expect(surfaceMounts().length).toBe(2);
    second.remove();
  });

  test("a surface nothing registered is refused rather than registered", async () => {
    const result = await applyLiveSave({ kind: "surface", name: "brand-new" }, surfaceV2);
    expect(result.remounted).toBe(0);
    expect(result.refused).toContain('"brand-new"');
    expect(surfaceDocument("brand-new")).toBeUndefined();
  });

  test("a saved component redefines the element and re-mounts exactly the roots that used it", async () => {
    await applyLiveSave({ kind: "element", tag: "jx-live-probe" }, probeV1);
    registerSurface("live-probe", surfaceV1);
    registerSurface("bystander", { tagName: "p", textContent: "unchanged" });
    const model = reactive({ word: "hi" });
    await mountSurface("live-probe", { model }, host);
    const other = document.createElement("div");
    document.body.append(other);
    await mountSurface("bystander", {}, other);
    await tick();
    /* A mark rather than the node: a failing `toBe` on a live element walks the DOM graph. */
    (other.firstElementChild as HTMLElement).dataset.mark = "kept";
    expect(host.querySelector("jx-live-probe b")?.textContent).toBe("[hi]");

    const result = await applyLiveSave({ kind: "element", tag: "jx-live-probe" }, probeV2);
    await tick();
    expect(result).toEqual({
      remounted: 1,
      target: { kind: "element", tag: "jx-live-probe" },
    });
    expect(elementDefinition("jx-live-probe")?.doc).toBe(probeV2);
    /* The root that used the element draws its new definition; the bystander was not touched. */
    expect(host.querySelector("jx-live-probe b")).toBeNull();
    expect(host.querySelector("jx-live-probe i")?.textContent).toBe("(hi)");
    expect((other.firstElementChild as HTMLElement).dataset.mark).toBe("kept");
    model.word = "there";
    await tick();
    expect(host.querySelector("jx-live-probe i")?.textContent).toBe("(there)");
    other.remove();
  });

  test("a component whose document names another tag than its file is refused", async () => {
    const result = await applyLiveSave(
      { kind: "element", tag: "jx-live-probe" },
      { ...probeV2, tagName: "jx-something-else" },
    );
    expect(result.remounted).toBe(0);
    expect(result.refused).toContain("<jx-something-else>");
    expect(result.refused).toContain("jx-live-probe.json");
  });
});

describe("liveSaveNotice", () => {
  const surface = { kind: "surface", name: "menu" } as const;
  const element = { kind: "element", tag: "jx-tree" } as const;

  test("names the count, the nothing, and the refusal, keyed per target", () => {
    expect(liveSaveNotice({ remounted: 3, target: surface })).toEqual({
      key: "live-chrome:surface menu",
      level: "info",
      message: "surface menu saved and re-mounted in 3 places.",
    });
    expect(liveSaveNotice({ remounted: 1, target: element })).toEqual({
      key: "live-chrome:jx-tree",
      level: "info",
      message: "jx-tree saved and re-mounted in 1 place.",
    });
    expect(liveSaveNotice({ remounted: 0, target: element }).message).toBe(
      "jx-tree saved; nothing in the shell is drawn from it.",
    );
    /* An element says how far it reached: the canvases too, when any frame was live. */
    expect(liveSaveNotice({ canvases: 1, remounted: 2, target: element }).message).toBe(
      "jx-tree saved and re-mounted in 2 places and on the canvas.",
    );
    expect(liveSaveNotice({ canvases: 2, remounted: 0, target: element }).message).toBe(
      "jx-tree saved; nothing in the shell is drawn from it, redefined and on 2 canvases.",
    );
    expect(liveSaveNotice({ canvases: 0, remounted: 1, target: element }).message).toBe(
      "jx-tree saved and re-mounted in 1 place.",
    );
    expect(liveSaveNotice({ refused: "why", remounted: 0, target: surface })).toEqual({
      key: "live-chrome:surface menu",
      level: "warn",
      message: "Not applied to the running shell: why.",
    });
  });
});

describe("canvasBaseFor", () => {
  test("is the file's own URL under the project, as the frame fetches it", () => {
    /* No platform is registered here, so the base is the canvas origin plus the root — which is
       how the dev server and the desktop loopback both serve a project: by its path. */
    expect(canvasBaseFor("/w/jx/packages/ui", "components/jx-tree.json")).toBe(
      "http://localhost:3000//w/jx/packages/ui/components/jx-tree.json",
    );
    expect(canvasBaseFor("packages/ui", "./components/jx-tree.json")).toBe(
      "http://localhost:3000/packages/ui/components/jx-tree.json",
    );
  });
});

describe("createLiveSurfaceSaver", () => {
  test("applies a chrome save under the open project and says so; ignores every other save", async () => {
    const said: string[] = [];
    const told: string[] = [];
    const workspace: { projectRoot: string | null } = { projectRoot: "/w/jx/packages/studio" };
    const save = createLiveSurfaceSaver({
      notify: {
        info: (message, options) => said.push(`info ${options.key}: ${message}`),
        warn: (message, options) => said.push(`${options.tier} ${options.key}: ${message}`),
      },
      redefineOnCanvases: (doc, base) => {
        told.push(`${String(doc.tagName)} @ ${base}`);
        return 1;
      },
      workspace,
    });
    registerSurface("live-probe", surfaceV1);
    await mountSurface("live-probe", { model: { word: "x" } }, host);

    /* A site's own page: nothing is applied, nothing is said. */
    expect(await save("pages/index.json", surfaceV2)).toBeNull();
    /* A chrome path with no document — a non-Jx save — is nothing either. */
    expect(await save("src/surfaces/live-probe.json", null)).toBeNull();
    expect(said).toEqual([]);

    const result = await save("src/surfaces/live-probe.json", surfaceV2);
    await tick();
    expect(result?.remounted).toBe(1);
    expect(said).toEqual([
      "info live-chrome:surface live-probe: surface live-probe saved and re-mounted in 1 place.",
    ]);
    expect(host.querySelector("span")?.textContent).toBe("v2 x");

    /* A refusal is a problem, not a toast. */
    await save("src/surfaces/nobody.json", surfaceV2);
    expect(said[1]).toBe(
      'problem live-chrome:surface nobody: Not applied to the running shell: no surface is registered as "nobody".',
    );
    /* A surface never reaches a canvas: the frames draw project documents, not the shell's. */
    expect(told).toEqual([]);

    /* A component reaches every canvas, at the file's URL under the project, and says so. */
    workspace.projectRoot = "/w/jx/packages/ui";
    const element = await save("components/jx-live-probe.json", probeV2);
    expect(element?.canvases).toBe(1);
    expect(told).toEqual([
      "jx-live-probe @ http://localhost:3000//w/jx/packages/ui/components/jx-live-probe.json",
    ]);
    expect(said[2]).toBe(
      "info live-chrome:jx-live-probe: jx-live-probe saved; nothing in the shell is drawn from it, redefined and on the canvas.",
    );
    /* A refused component reaches no canvas either. */
    await save("components/jx-live-probe.json", { ...probeV2, tagName: "jx-other" });
    expect(told.length).toBe(1);

    /* No project open: the same path is nobody's, read live off the record. */
    workspace.projectRoot = null;
    expect(await save("src/surfaces/live-probe.json", surfaceV1)).toBeNull();
    expect(said.length).toBe(4);
  });
});
