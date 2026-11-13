/**
 * What the harness records about one rendered page (scripts/conformance/README.md).
 *
 * Everything here is an observation of BEHAVIOUR, taken through a browser: the tree a reader's
 * browser ends up with, where each element is and how it is painted, what assistive technology is
 * told, what the page complained about, and what it looks like. None of it is the bytes the
 * compiler wrote, which is the point: two compilers whose output differs in every byte conform when
 * these agree.
 */

import { createHash } from "node:crypto";
import type { Page, SerializedAXNode } from "puppeteer-core";
import { normalize } from "./normalize.ts";

/** A viewport a page is observed at. */
export interface Viewport {
  name: string;
  width: number;
  height: number;
}

/** Narrow enough for a phone layout, wide enough for the desktop one. */
export const VIEWPORTS: readonly Viewport[] = [
  { height: 844, name: "narrow", width: 390 },
  { height: 800, name: "wide", width: 1280 },
];

/** One page at one viewport, as recorded. */
export interface Observation {
  route: string;
  viewport: string;
  /** One line per element or text node, indented by depth (see `collectLines`). */
  dom: string[];
  /** The accessibility tree, one line per node. */
  accessibility: string[];
  /** Console errors and warnings, uncaught exceptions, failed and refused requests, sorted. */
  complaints: string[];
  /** A digest of the DOM after each scripted click, in order (the wide viewport only). */
  interactions: string[];
  /** SHA-256 of the full-page screenshot, whose PNG is stored beside this record. */
  screenshot: string;
}

/** Computed properties recorded per element, where they differ from the parent's. */
const STYLE_PROPERTIES = [
  "display",
  "position",
  "visibility",
  "opacity",
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "text-align",
  "text-decoration-line",
  "text-transform",
  "border-top-width",
  "border-top-color",
  "border-radius",
  "box-shadow",
  "overflow",
  "z-index",
];

/** Elements that are the compiler's plumbing rather than the page: observed by their effect. */
const PLUMBING = "script, style, link[rel=stylesheet], link[rel=modulepreload], template";

/**
 * Runs in the page. Serialise the document as one line per node:
 *
 *     <indent><tag> <attr="value" ...> @x,y,w,h {property:value;...}
 *     <indent>"text"
 *
 * Attributes are sorted. Geometry is in whole CSS pixels from the document's top left and is left
 * off an element that renders no box. A style property is written only where it differs from the
 * parent element's, so a line says what an element changes rather than restating what it inherits.
 */
function collectLines(properties: string[], plumbing: string): string[] {
  const lines: string[] = [];
  const quote = (value: string) => JSON.stringify(value.replaceAll(/\s+/gu, " ").trim());
  const walk = (node: Node, depth: number, inherited: Map<string, string>) => {
    const indent = "  ".repeat(depth);
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replaceAll(/\s+/gu, " ").trim();
      if (text !== "") {
        lines.push(`${indent}${JSON.stringify(text)}`);
      }
      return;
    }
    if (!(node instanceof Element) || node.matches(plumbing)) {
      return;
    }
    const attributes = [...node.attributes]
      .map((attribute) => `${attribute.name}=${quote(attribute.value)}`)
      .toSorted()
      .join(" ");
    const computed = getComputedStyle(node);
    const own = new Map<string, string>();
    const changed: string[] = [];
    for (const property of properties) {
      const value = computed.getPropertyValue(property);
      own.set(property, value);
      if (inherited.get(property) !== value) {
        changed.push(`${property}:${value}`);
      }
    }
    const box = node.getBoundingClientRect();
    const geometry =
      box.width === 0 && box.height === 0
        ? ""
        : ` @${Math.round(box.x + scrollX)},${Math.round(box.y + scrollY)},${Math.round(box.width)},${Math.round(box.height)}`;
    const style = changed.length > 0 ? ` {${changed.join(";")}}` : "";
    const tag = node.tagName.toLowerCase();
    lines.push(`${indent}${tag}${attributes ? ` ${attributes}` : ""}${geometry}${style}`);
    for (const child of node.childNodes) {
      walk(child, depth + 1, own);
    }
  };
  walk(document.documentElement, 0, new Map());
  return lines;
}

/**
 * Runs in the page. Bring the page to rest: scroll through it so every lazy image starts, wait for
 * images and fonts, and return to the top. A page observed mid-load is observed at a moment no two
 * runs share.
 */
async function settle(): Promise<void> {
  const frame = async () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  const step = Math.max(200, innerHeight);
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
    scrollTo(0, y);
    await frame();
  }
  scrollTo(0, document.documentElement.scrollHeight);
  await frame();
  const loaded = async (image: HTMLImageElement) =>
    new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  const pending = [...document.images].flatMap((image) => (image.complete ? [] : [loaded(image)]));
  const deadline = new Promise<void>((resolve) => {
    setTimeout(resolve, 8000);
  });
  await Promise.race([Promise.all(pending), deadline]);
  /* Loaded is not painted: an image is decoded off the main thread, and a screenshot taken before
     that finishes shows its box empty. */
  await Promise.all([...document.images].map(async (image) => image.decode().catch(() => {})));
  /* `fonts.ready` resolves when the faces requested SO FAR have loaded, and laying text out with
     them can request more (another weight, another unicode range). Ask until nothing is loading. */
  for (let round = 0; round < 10; round += 1) {
    await document.fonts.ready;
    await frame();
    if (document.fonts.status === "loaded") {
      break;
    }
  }
  scrollTo(0, 0);
  /* Back at the top is not at rest. A scroll listener that restyles a header, an intersection
     observer that reveals a section, and a sticky element finding its place each answer the scroll
     a task or a frame later, so give them both before anything is measured. */
  await frame();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 120);
  });
  await frame();
  await frame();
}

/**
 * Runs in the page before any of its scripts. Give the page a clock that does not move and a random
 * sequence that is the same every time, so a page that shows the date or shuffles a list shows and
 * shuffles the same thing in every capture. Both are inputs the page reads from the world; neither
 * is something a compiler decides.
 */
function pinTheWorld(epoch: number): void {
  // Park and Miller's minimal standard generator: fully determined by its seed.
  let seed = 20_260_115;
  Math.random = () => {
    seed = (seed * 48_271) % 2_147_483_647;
    return (seed - 1) / 2_147_483_646;
  };
  const RealDate = Date;
  class PinnedDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date> | []) {
      if (args.length === 0) {
        super(epoch);
      } else {
        super(...args);
      }
    }
    static override now(): number {
      return epoch;
    }
  }
  globalThis.Date = PinnedDate;
}

/** Noon UTC on a fixed day: no time zone puts it on another date. */
const PINNED_EPOCH = Date.UTC(2026, 0, 15, 12);

/**
 * Runs in the page. Click the `index`-th visible control and report what it was, or `null` when
 * there are no more. Controls are the elements a visitor operates without leaving the page: buttons
 * that submit nothing, disclosure summaries and tabs.
 */
function clickControl(index: number): string | null {
  const controls = [
    ...document.querySelectorAll<HTMLElement>(
      "button:not([type=submit]):not([disabled]), summary, [role=tab], [role=button]",
    ),
  ].filter((control) => {
    const box = control.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  });
  const control = controls.at(index);
  if (!control) {
    return null;
  }
  const label = control.textContent.replaceAll(/\s+/gu, " ").trim().slice(0, 40);
  control.click();
  return `${control.tagName.toLowerCase()} ${JSON.stringify(label)}`;
}

/** Freeze motion, so a transition half-way through is never what a run happens to record. */
const STILL =
  "*, *::before, *::after { animation: none !important; transition: none !important; " +
  "caret-color: transparent !important; scroll-behavior: auto !important; }";

/** At most this many controls are clicked on a page. */
const MAX_CLICKS = 6;

/**
 * A short digest of a DOM, normalized first. This is the one place a normalization rule is applied
 * at capture time: a digest cannot be normalized afterwards, and one taken of raw lines would
 * differ between two compilers for every tolerated reason at once.
 */
function digest(lines: readonly string[]): string {
  return createHash("sha256")
    .update(normalize(lines.join("\n")))
    .digest("hex")
    .slice(0, 16);
}

function flattenAccessibility(node: SerializedAXNode | null, depth = 0): string[] {
  if (!node) {
    return [];
  }
  const state = [
    node.level === undefined ? "" : ` level=${node.level}`,
    node.checked === undefined ? "" : ` checked=${node.checked}`,
    node.expanded === undefined ? "" : ` expanded=${node.expanded}`,
    node.disabled ? " disabled" : "",
  ].join("");
  const line = `${"  ".repeat(depth)}${node.role} ${JSON.stringify(node.name)}${state}`;
  return [
    line,
    ...(node.children ?? []).flatMap((child) => flattenAccessibility(child, depth + 1)),
  ];
}

/** A request the browser makes on its own account, whatever the page says. */
function isBrowsersOwn(url: string): boolean {
  return new URL(url).pathname === "/favicon.ico";
}

/**
 * Wait for the network to go quiet, for a bounded time. A page that holds a connection open (a
 * stream, a poll) never goes quiet, and it is observed as it stands when the wait runs out.
 */
async function quiet(page: Page, idleTime: number): Promise<void> {
  try {
    await page.waitForNetworkIdle({ idleTime, timeout: 5000 });
  } catch {
    // Still busy after the bound: go on with the page as it is.
  }
}

/**
 * Observe one route at one viewport.
 *
 * @param page A page in a context of its own, so nothing is cached from an earlier observation.
 * @param origin The origin the build is served from.
 * @returns The record and the screenshot's PNG bytes.
 */
export async function observe(
  page: Page,
  origin: string,
  route: string,
  viewport: Viewport,
): Promise<{ observation: Observation; png: Uint8Array }> {
  const complaints = new Set<string>();
  page.on("console", (message) => {
    const loud = message.type() === "error" || message.type() === "warn";
    // The browser's own line about a failed load names no URL; the response line below does.
    if (loud && !message.text().startsWith("Failed to load resource")) {
      complaints.add(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    complaints.add(`uncaught: ${error instanceof Error ? error.message : String(error)}`);
  });
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).origin === origin) {
      complaints.add(`request failed: ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !isBrowsersOwn(response.url())) {
      complaints.add(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
  /* Nothing leaves the machine. A page that asks another origin for a font or a script is recorded
     as asking, and refused: the answer would depend on the network and on that origin's mood, and
     two captures of one build would then differ by how fast a font arrived. What a build makes a
     page ask for IS the compiler's doing, so the asking is compared. */
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === origin || url.protocol === "data:" || url.protocol === "blob:") {
      void request.continue();
    } else {
      complaints.add(`external request: ${url.origin}${url.pathname}`);
      void request.abort("blockedbyclient");
    }
  });

  await page.setViewport({ deviceScaleFactor: 1, height: viewport.height, width: viewport.width });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.evaluateOnNewDocument(pinTheWorld, PINNED_EPOCH);
  await page.goto(`${origin}${route}`, { waitUntil: "networkidle0" });
  await page.addStyleTag({ content: STILL });
  /* Scrolling starts the lazy loads; the network going quiet is what says they are done; and a
     second pass lets the page lay out with what arrived. */
  await page.evaluate(settle);
  await quiet(page, 300);
  await page.evaluate(settle);

  const dom = await page.evaluate(collectLines, STYLE_PROPERTIES, PLUMBING);
  const accessibility = flattenAccessibility(await page.accessibility.snapshot());
  const png = await page.screenshot({ fullPage: true, type: "png" });

  const interactions: string[] = [];
  if (viewport.name === "wide") {
    for (let index = 0; index < MAX_CLICKS; index += 1) {
      const clicked = await page.evaluate(clickControl, index);
      if (clicked === null) {
        break;
      }
      await page.evaluate(settle);
      await quiet(page, 150);
      if (new URL(page.url()).pathname !== new URL(`${origin}${route}`).pathname) {
        interactions.push(`${clicked} -> navigated to ${new URL(page.url()).pathname}`);
        break;
      }
      const after = await page.evaluate(collectLines, STYLE_PROPERTIES, PLUMBING);
      interactions.push(`${clicked} -> ${digest(after)}`);
    }
  }

  return {
    observation: {
      accessibility,
      complaints: [...complaints].toSorted(),
      dom,
      interactions,
      route,
      screenshot: createHash("sha256").update(png).digest("hex"),
      viewport: viewport.name,
    },
    png,
  };
}
