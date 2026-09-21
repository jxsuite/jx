// oxlint-disable unicorn/prefer-dom-node-append -- These calls test `appendChild` specifically:
// That is the method module-preloads.ts patches, and unlike happy-dom's `Node#append()` (which
// Calls through the instance's own `appendChild`), a real browser's `append()` uses the internal
// Pre-insert algorithm directly and does NOT route through an overridden `appendChild`.
/**
 * Tests for src/services/module-preloads.ts — the batcher that collapses the bundler's per-graph
 * `<link rel=modulepreload>` insertions onto one animation frame instead of paying a document-wide
 * style recalculation per link (see the module's own header for the trace that asked for this).
 */
import "./with-dom.js";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { installModulePreloadBatcher } from "../src/services/module-preloads";

type PatchedHead = HTMLHeadElement & { __modulePreloadsBatched?: boolean };

function preloadLink(href: string): HTMLLinkElement {
  const link = document.createElement("link");
  link.rel = "modulepreload";
  link.href = href;
  return link;
}

let frames: FrameRequestCallback[] = [];
let originalRaf: typeof requestAnimationFrame;

beforeEach(() => {
  frames = [];
  originalRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  }) as typeof requestAnimationFrame;
});

/** Runs every rAF callback queued so far, draining frames scheduled during the flush itself. */
function runFrames(): void {
  while (frames.length > 0) {
    const queued = frames.splice(0);
    for (const cb of queued) {
      cb(0);
    }
  }
}

afterEach(() => {
  // Drain whatever this test left pending: the batcher's `frame`/`QUEUED` are module-level, so a
  // Test that queues a link without flushing it would otherwise leave the NEXT test's first
  // `appendChild` seeing `frame !== null` and skipping its own `requestAnimationFrame` call.
  runFrames();
  globalThis.requestAnimationFrame = originalRaf;
  for (const el of document.head.querySelectorAll('link[rel="modulepreload"], meta[data-test]')) {
    el.remove();
  }
});

describe("installModulePreloadBatcher", () => {
  test("is idempotent: a second call does not re-patch appendChild", () => {
    installModulePreloadBatcher();
    const patchedOnce = document.head.appendChild;
    installModulePreloadBatcher();
    expect(document.head.appendChild).toBe(patchedOnce);
    expect((document.head as PatchedHead).__modulePreloadsBatched).toBe(true);
  });

  test("a modulepreload link is not inserted synchronously", () => {
    installModulePreloadBatcher();
    const link = preloadLink("/dist/chunks/a.js");
    document.head.appendChild(link);
    expect(document.head.contains(link)).toBe(false);
    runFrames();
    expect(document.head.contains(link)).toBe(true);
  });

  test("a non-preload node is appended immediately, with no frame spent", () => {
    installModulePreloadBatcher();
    const meta = document.createElement("meta");
    meta.dataset.test = "1";
    document.head.appendChild(meta);
    expect(document.head.contains(meta)).toBe(true);
    expect(frames.length).toBe(0);
  });

  test("appendChild returns the node it was given, on both paths", () => {
    installModulePreloadBatcher();
    const meta = document.createElement("meta");
    meta.dataset.test = "1";
    expect(document.head.appendChild(meta)).toBe(meta);

    const link = preloadLink("/dist/chunks/b.js");
    expect(document.head.appendChild(link)).toBe(link);
  });

  test("multiple links queued in the same task flush together on ONE frame", () => {
    installModulePreloadBatcher();
    const a = preloadLink("/dist/chunks/a.js");
    const b = preloadLink("/dist/chunks/b.js");
    document.head.appendChild(a);
    document.head.appendChild(b);

    // Both queued, but only one rAF was scheduled for the pair.
    expect(frames.length).toBe(1);
    expect(document.head.contains(a)).toBe(false);
    expect(document.head.contains(b)).toBe(false);

    runFrames();
    expect(document.head.contains(a)).toBe(true);
    expect(document.head.contains(b)).toBe(true);
  });

  test("flushed links keep their original append order — the entry chunk warms before its children", () => {
    installModulePreloadBatcher();
    const entry = preloadLink("/dist/chunks/entry.js");
    const child = preloadLink("/dist/chunks/child.js");
    document.head.appendChild(entry);
    document.head.appendChild(child);
    runFrames();

    const order = [...document.head.querySelectorAll('link[rel="modulepreload"]')];
    expect(order.indexOf(entry)).toBeLessThan(order.indexOf(child));
  });

  test("a new task after a flush schedules its own fresh frame", () => {
    installModulePreloadBatcher();
    const a = preloadLink("/dist/chunks/a.js");
    document.head.appendChild(a);
    runFrames();
    expect(document.head.contains(a)).toBe(true);

    const b = preloadLink("/dist/chunks/b.js");
    document.head.appendChild(b);
    expect(document.head.contains(b)).toBe(false);
    expect(frames.length).toBe(1);

    runFrames();
    expect(document.head.contains(b)).toBe(true);
  });
});
