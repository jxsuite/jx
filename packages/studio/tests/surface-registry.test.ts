import "./with-dom.js";

import { beforeEach, describe, expect, test } from "bun:test";

import {
  mountsOf,
  mountsUsing,
  registerMount,
  resetSurfaceRegistry,
  surfaceMounts,
  unregisterMount,
} from "../src/services/surface-registry";

const entry = (name: string, ...elements: string[]) => ({
  elements: new Set(elements),
  host: document.createElement("div"),
  name,
  remount: () => Promise.resolve(),
});

beforeEach(() => {
  resetSurfaceRegistry();
});

describe("surface registry", () => {
  test("records mounts in order and forgets them on unregister", () => {
    const a = registerMount(entry("menu", "jx-menu", "jx-icon"));
    const b = registerMount(entry("statusbar", "jx-icon"));
    expect(surfaceMounts().map((m) => m.id)).toEqual([a, b]);
    unregisterMount(a);
    expect(surfaceMounts().map((m) => m.name)).toEqual(["statusbar"]);
    unregisterMount(a);
    expect(surfaceMounts().length).toBe(1);
  });

  test("answers which mounts use an element, case-insensitively, and which came from a document", () => {
    registerMount(entry("menu", "jx-menu", "jx-icon"));
    registerMount(entry("statusbar", "jx-icon"));
    registerMount(entry("menu", "jx-menu"));
    expect(mountsUsing("JX-ICON").map((m) => m.name)).toEqual(["menu", "statusbar"]);
    expect(mountsUsing("jx-menu").length).toBe(2);
    expect(mountsUsing("jx-dialog")).toEqual([]);
    expect(mountsOf("menu").length).toBe(2);
    expect(mountsOf("nothing")).toEqual([]);
  });

  test("reset forgets everything", () => {
    registerMount(entry("menu"));
    resetSurfaceRegistry();
    expect(surfaceMounts()).toEqual([]);
  });
});
