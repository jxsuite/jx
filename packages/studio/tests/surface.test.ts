import "./with-dom.js";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { reactive } from "@vue/reactivity";
import type { JxDocument } from "@jxsuite/schema/types";

import { mountsOf, resetSurfaceRegistry, surfaceMounts } from "../src/services/surface-registry";
import { REGION_ATTR } from "../src/ui/regions";
import {
  mountSurface,
  registerSurface,
  SURFACES_BASE,
  surfaceDocument,
  surfaceResolver,
  surfaceUrl,
} from "../src/ui/surface";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

const probe: JxDocument = {
  tagName: "div",
  children: [
    { tagName: "jx-icon", $props: { name: { $ref: "#/state/icon" } } },
    { tagName: "span", textContent: "${state.model.label}" },
  ],
};

let host: HTMLElement;

beforeEach(() => {
  resetSurfaceRegistry();
  host = document.createElement("div");
  document.body.append(host);
  registerSurface("probe", probe);
});

afterEach(() => {
  host.remove();
});

describe("surface documents", () => {
  test("are registered by name and resolved by their kit URL", () => {
    expect(surfaceDocument("probe")).toBe(probe);
    expect(surfaceUrl("probe")).toBe(`${SURFACES_BASE}probe.json`);
    expect(surfaceResolver(surfaceUrl("probe"))).toBe(probe);
    expect(surfaceResolver(`${SURFACES_BASE}nothing.json`)).toBeUndefined();
    expect(surfaceResolver(`${SURFACES_BASE}probe`)).toBeUndefined();
    expect(surfaceResolver("http://localhost/probe.json")).toBeUndefined();
  });

  test("an unregistered name is refused", async () => {
    let refusal: unknown = null;
    try {
      await mountSurface("nope", {}, host);
    } catch (error) {
      refusal = error;
    }
    expect(String(refusal)).toContain('"nope" is not registered');
  });
});

describe("mountSurface", () => {
  test("mounts with the kit ready, stamps the region, projects host state, and records the mount", async () => {
    const model = reactive({ label: "one" });
    const handle = await mountSurface("probe", { icon: "plus", model }, host, {
      region: "overlay.menu:probe",
    });
    await tick();
    expect(host.getAttribute(REGION_ATTR)).toBe("overlay.menu:probe");
    expect(host.querySelector("span")?.textContent).toBe("one");
    expect(host.querySelector("jx-icon path")?.getAttribute("d")?.startsWith("M")).toBe(true);
    expect(handle.elements.has("jx-icon")).toBe(true);
    expect(mountsOf("probe").length).toBe(1);

    model.label = "two";
    await tick();
    expect(host.querySelector("span")?.textContent).toBe("two");

    handle.dispose();
    expect(host.childElementCount).toBe(0);
    expect(surfaceMounts()).toEqual([]);
  });

  test("remount renders the document again into the same host with the same scope", async () => {
    const model = reactive({ label: "one" });
    await mountSurface("probe", { icon: "plus", model }, host);
    const before = host.firstElementChild;
    await mountsOf("probe")[0]!.remount();
    await tick();
    expect(host.childElementCount).toBe(1);
    expect(host.firstElementChild).not.toBe(before);
    expect(host.querySelector("span")?.textContent).toBe("one");
    expect(mountsOf("probe").length).toBe(1);
  });

  test("an aborted signal mounts nothing and records nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    await mountSurface("probe", { icon: "plus", model: { label: "x" } }, host, {
      signal: controller.signal,
    });
    expect(host.childElementCount).toBe(0);
    expect(surfaceMounts()).toEqual([]);
  });

  test("aborting after mount disposes and unregisters", async () => {
    const controller = new AbortController();
    await mountSurface("probe", { icon: "plus", model: { label: "x" } }, host, {
      signal: controller.signal,
    });
    expect(surfaceMounts().length).toBe(1);
    controller.abort();
    expect(host.childElementCount).toBe(0);
    expect(surfaceMounts()).toEqual([]);
  });

  test("forwards node hooks", async () => {
    const created: string[] = [];
    await mountSurface("probe", { icon: "plus", model: { label: "x" } }, host, {
      onNodeCreated: (el) => {
        if (el instanceof Element) {
          created.push(el.tagName.toLowerCase());
        }
      },
      onNodeMoved: () => null,
    });
    expect(created).toContain("jx-icon");
    expect(created).toContain("span");
  });
});
