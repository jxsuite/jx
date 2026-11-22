/// <reference lib="dom" />
/**
 * The preview realm, inside its frame (`project-state.md` §11.2, `studio.md` §9.1.2).
 *
 * Every preview of a project document drawn outside the canvas (the Content home's cards, the Site
 * panel's component cards, the samples Project Styles asks about) is drawn here, in a same-origin
 * frame with a custom-element registry of its own, and never in Studio's window. A project
 * component's definition, a document's `$src` class and a stylesheet it names therefore reach this
 * realm only: Studio's registry holds its own kit and nothing a project defines, so a project tag
 * can never replace a control the chrome is drawn from, and a definition that changes is redefined
 * by replacing this realm (`host.ts`) rather than by a registry that cannot redefine a tag. The
 * separation is of registries and documents, not a security boundary: the frame is same-origin, as
 * the canvas frame is, so code running here can reach the window that holds it.
 *
 * The realm answers each request with a snapshot: the markup it drew, shadow roots included as
 * declarative shadow DOM (`getHTML`, HTML §8.4), and the text of every rule the runtime wrote for
 * it. The shell mounts the snapshot in the card's own shadow root (`browse/preview-root.ts`), so a
 * card stays in the shell's layout and its text stays text, and the rendered tree here is stopped
 * and let go as soon as it is read: a long browse keeps nothing alive in this realm but its
 * definitions.
 *
 * @docs studio/interface
 */

import {
  buildScope,
  defineElement,
  documentStyleText,
  lookupsSettled,
  renderNode,
  runScoped,
  setCanvasAssetResolver,
  setDocumentParser,
  setResolveToken,
  setSkipServerFunctions,
  setTemplateErrorHandler,
} from "@jxsuite/runtime";
import { isNonNullObject, isString } from "@jxsuite/schema/guards";
import { errorMessage } from "@jxsuite/schema/parse";
import { resolveAssetRef } from "../canvas/asset-resolve";
import { parseDocumentText } from "../canvas/document-parser";
import { fillPreviewImages } from "../canvas/preview-placeholder";
import { postMessageChannel } from "../canvas/iframe-channel";
import type { CanvasEnvelope, IframeChannel } from "../canvas/iframe-channel";
import { PREVIEW_FALLBACK_CLASS, PREVIEW_REALM_PARAM, PREVIEW_REALM_VALUE } from "./protocol";
import type {
  FromRealm,
  RealmDocument,
  RealmSnapshot,
  RenderDocumentRequest,
  RenderInstanceRequest,
  RenderPackageRequest,
  ToRealm,
} from "./protocol";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";

/** What waits for a drawn tree to finish drawing. */
export type SettleFn = (root: Element) => Promise<void>;

/** What {@link startPreviewRealm} runs against. */
export interface PreviewRealmOptions {
  /** The channel to the shell. */
  channel: IframeChannel<FromRealm, ToRealm>;
  /** The realm's own document, where previews are drawn before they are read. */
  document: Document;
  /** The realm's registry, watched so the shell learns which tags it holds. */
  registry: CustomElementRegistry;
  /** Waits for a drawn tree to settle; {@link settleTree} unless a test supplies a quicker one. */
  settle?: SettleFn;
}

// ─── The tags the realm defines ──────────────────────────────────────────────

const _defined = new WeakMap<CustomElementRegistry, Set<string>>();

/**
 * The names `registry` defines from now on, as one live set. The registry has no way to list its
 * names, so `define` is wrapped once per registry and every name it is handed is recorded.
 */
export function trackDefinitions(registry: CustomElementRegistry): ReadonlySet<string> {
  const known = _defined.get(registry);
  if (known) {
    return known;
  }
  const names = new Set<string>();
  _defined.set(registry, names);
  const define = registry.define.bind(registry);
  registry.define = (name, constructor, options) => {
    define(name, constructor, options);
    names.add(name);
  };
  return names;
}

// ─── Settling ────────────────────────────────────────────────────────────────

/** How many quiet ticks in a row mean a tree has finished drawing, and how long a tick is. */
const QUIET_TICKS = 3;
const TICK_MS = 10;
/** The longest a tree is waited for: a component that never stops changing is read as it stands. */
const REALM_SETTLE_LIMIT_MS = 2000;

/** Every open shadow root at or under `node`. */
function shadowRootsUnder(node: Element): ShadowRoot[] {
  const roots: ShadowRoot[] = [];
  const visit = (parent: Element | ShadowRoot) => {
    for (const element of parent.querySelectorAll("*")) {
      const root = element.shadowRoot;
      if (root) {
        roots.push(root);
        visit(root);
      }
    }
  };
  if (node.shadowRoot) {
    roots.push(node.shadowRoot);
    visit(node.shadowRoot);
  }
  visit(node);
  return roots;
}

/**
 * Wait for `root` to stop changing: the runtime's lookups settled, then {@link QUIET_TICKS} ticks
 * in a row with no mutation in the tree or in any shadow root it has grown, all within `limitMs`
 * ({@link REALM_SETTLE_LIMIT_MS}) at most. A component draws in its own asynchronous
 * `connectedCallback`, after its instance is created, so the tree is read once it has drawn rather
 * than when it was made.
 */
export async function settleTree(
  root: Element,
  limitMs: number = REALM_SETTLE_LIMIT_MS,
): Promise<void> {
  const deadline = Date.now() + limitMs;
  /* Bounded: a lookup may never settle (a slow API, an unreachable mount), the runtime leaves
     bounding the wait to its host, and `lookupsSettled` waits on every lookup in the realm, not only
     this tree's. One page's hung lookup would otherwise hold every other request behind it. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    lookupsSettled(),
    new Promise((resolve) => {
      timer = setTimeout(resolve, limitMs);
    }),
  ]);
  clearTimeout(timer);
  const Observer = root.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
  let mutations = 0;
  const observer = new Observer(() => {
    mutations += 1;
  });
  const watched = new Set<Node>();
  const watch = () => {
    for (const node of [root, ...shadowRootsUnder(root)]) {
      if (!watched.has(node)) {
        watched.add(node);
        observer.observe(node, {
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true,
        });
      }
    }
  };
  let quiet = 0;
  try {
    while (quiet < QUIET_TICKS && Date.now() < deadline) {
      watch();
      const before = mutations;
      await new Promise((resolve) => {
        setTimeout(resolve, TICK_MS);
      });
      quiet = mutations === before ? quiet + 1 : 0;
    }
  } finally {
    observer.disconnect();
  }
}

// ─── Snapshots ───────────────────────────────────────────────────────────────

/** Attributes whose relative URL would resolve against the shell's address rather than this one. */
const URL_ATTRIBUTES = ["src", "poster"] as const;

/** Make every relative URL a drawn tree names absolute, against the realm's own base. */
function absolutize(scope: Element | ShadowRoot, base: string): void {
  const rewrite = (element: Element, name: string) => {
    const value = element.getAttribute(name);
    if (value === null || value === "" || /^[a-z][\d+.a-z-]*:/iu.test(value)) {
      return;
    }
    if (URL.canParse(value, base)) {
      element.setAttribute(name, new URL(value, base).href);
    }
  };
  for (const element of scope.querySelectorAll("[src], [poster], link[href]")) {
    for (const name of URL_ATTRIBUTES) {
      rewrite(element, name);
    }
    if (element.localName === "link") {
      rewrite(element, "href");
    }
  }
}

/**
 * Read what `container` drew: its markup with every shadow root it holds as declarative shadow DOM,
 * each root's own runtime rules written into it as a `<style>` (an adopted sheet does not
 * serialize), and the document's runtime rules beside it.
 */
export function snapshotOf(container: Element): RealmSnapshot {
  const doc = container.ownerDocument;
  const base = doc.baseURI;
  const roots = shadowRootsUnder(container);
  absolutize(container, base);
  for (const root of roots) {
    absolutize(root, base);
    const text = documentStyleText(root);
    if (text !== "") {
      const style = doc.createElement("style");
      style.textContent = text;
      root.prepend(style);
    }
  }
  return { css: documentStyleText(doc), html: container.getHTML({ shadowRoots: roots }) };
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

/** One `$elements` entry: a package to import, or a reference to a definition. */
type ElementsEntry = NonNullable<JxDocument["$elements"]>[number];

/** The URL an `$elements` entry references a definition by, or null for any other entry. */
function refOf(entry: ElementsEntry): string | null {
  return isNonNullObject(entry) && "$ref" in entry && isString(entry.$ref) ? entry.$ref : null;
}

/** What one trial render's template error handler saw: the first binding that threw, if any. */
interface TemplateTrial {
  error: Error | null;
}

/**
 * Whether `definition` renders given `props`, tried on a detached copy before a live instance is
 * made (`spec.md` §19.4c: a definition may not render with the values it is given). An instance
 * renders in its own asynchronous `connectedCallback`, where a throw cannot be caught; the same
 * render made here synchronously, into an element nobody sees, can be. Throws the reason it did not
 * render.
 */
export async function trialRender(
  target: RealmDocument,
  props: Readonly<Record<string, JsonValue>>,
): Promise<void> {
  let stopRender: (() => void) | null = null;
  try {
    const scope = await buildScope(target.document, {}, target.base);
    for (const [name, value] of Object.entries(props)) {
      scope[name] = value;
    }
    /* A template binding that throws no longer unwinds the render (spec.md §6.1): it draws nothing
       and waits for its data. The trial still has to see it, so the throw is collected for the one
       synchronous render, as the render critic collects it. */
    const trial: TemplateTrial = { error: null };
    setTemplateErrorHandler((error) => {
      trial.error ??= error;
    });
    // Its own tag would make an instance, and the instance's render is the one that cannot be caught.
    const { stop } = runScoped(() => renderNode({ ...target.document, tagName: "div" }, scope));
    stopRender = stop;
    if (trial.error !== null) {
      throw trial.error;
    }
  } finally {
    setTemplateErrorHandler(null);
    stopRender?.();
  }
}

/** Start the realm against its channel; answers the function that stops it. */
export function startPreviewRealm(options: PreviewRealmOptions): () => void {
  const { channel, document: doc, registry } = options;
  const settle = options.settle ?? settleTree;
  const tags = trackDefinitions(registry);
  /* Every Jx host answers a `.jxn` definition as JSON; this realm still reads one a host serves as
     its text, as the canvas frame does. A preview never runs a server function. */
  setDocumentParser(parseDocumentText);
  setSkipServerFunctions(true);

  /**
   * Draw into a container of its own, wait for it to settle, read it and let it go. A draw answers
   * what stops it (its effects, timers and style rules) when it made any, run once it is read.
   */
  async function drawn(draw: (container: HTMLElement) => (() => void) | null) {
    const container = doc.createElement("div");
    doc.body.append(container);
    const stopImages = fillPreviewImages(container);
    let stopDraw: (() => void) | null = null;
    try {
      stopDraw = draw(container);
      await settle(container);
      return snapshotOf(container);
    } finally {
      stopDraw?.();
      stopImages();
      container.remove();
    }
  }

  /**
   * Definitions are made one at a time. The realm answers requests concurrently, and the runtime
   * checks a tag is undefined before it awaits the definition's own `$elements`, so two requests
   * defining one component at once would both pass that check and the second `define` would throw.
   * In turn, the second finds the tag defined and returns.
   */
  let definitions: Promise<unknown> = Promise.resolve();
  function inTurn(work: () => Promise<void>): Promise<void> {
    const turn = definitions.then(work);
    definitions = turn.catch(() => {});
    return turn;
  }

  /** Define a project component from the document the shell handed over. */
  async function define(target: RealmDocument): Promise<string> {
    const { tagName } = target.document;
    if (!isString(tagName) || !tagName.includes("-")) {
      throw new Error(`${target.path} defines no custom element`);
    }
    await inTurn(() => defineElement(target.document, target.base));
    return tagName;
  }

  /** An instance of `tag`, given its attribute defaults and then its props. */
  function instance(
    tag: string,
    attributes: Readonly<Record<string, string>>,
    props: Readonly<Record<string, JsonValue>> = {},
  ): HTMLElement {
    const element = doc.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    /* SAFETY: an element is an ordinary extensible object, so any string key can be written; the
       instance reads each declared prop back off itself when it connects (spec.md §16.2). */
    const properties = element as HTMLElement & Record<string, JsonValue>;
    for (const [name, value] of Object.entries(props)) {
      properties[name] = value;
    }
    return element;
  }

  async function renderDocument(request: RenderDocumentRequest) {
    const { target, assets } = request;
    for (const entry of target.document.$elements ?? []) {
      const ref = refOf(entry);
      if (ref !== null) {
        await inTurn(() => defineElement(new URL(ref, target.base).href));
      }
    }
    const scope = await buildScope(target.document, {}, target.base);
    return drawn((container) => {
      /* A document names its media as the site does; the canvas's resolver says where this host
         serves them. Restored afterwards, because the next request is a different document. */
      setCanvasAssetResolver(assets ? (value) => resolveAssetRef(value, assets) : null);
      try {
        /* Scoped, and stopped once read: a page's effects, lifecycle timers and style rules would
           otherwise outlive its snapshot, and every later answer would carry its rules. */
        const { result, stop } = runScoped(() => renderNode(target.document, scope));
        container.append(result);
        return stop;
      } finally {
        setCanvasAssetResolver(null);
      }
    });
  }

  async function renderInstance(request: RenderInstanceRequest) {
    await trialRender(request.target, request.props);
    const tag = await define(request.target);
    return drawn((container) => {
      container.append(instance(tag, request.attributes, request.props));
      return null;
    });
  }

  function renderPackage(request: RenderPackageRequest) {
    return drawn((container) => {
      if (registry.get(request.tag)) {
        container.append(instance(request.tag, request.attributes));
        return null;
      }
      const box = doc.createElement("div");
      box.className = PREVIEW_FALLBACK_CLASS;
      box.textContent = `<${request.tag}>`;
      container.append(box);
      return null;
    });
  }

  async function answer(request: ToRealm): Promise<void> {
    try {
      if (request.kind === "trial") {
        await trialRender(request.target, request.props);
        channel.post({ id: request.id, kind: "trialed", tags: [...tags] });
        return;
      }
      const snapshot =
        request.kind === "document"
          ? await renderDocument(request)
          : request.kind === "instance"
            ? await renderInstance(request)
            : await renderPackage(request);
      channel.post({ id: request.id, kind: "rendered", snapshot, tags: [...tags] });
    } catch (error) {
      channel.post({
        id: request.id,
        kind: "failed",
        message: errorMessage(error),
        tags: [...tags],
      });
    }
  }

  const unlisten = channel.onMessage((request) => {
    void answer(request);
  });
  channel.post({ kind: "ready" });
  return unlisten;
}

// ─── Booting the frame ───────────────────────────────────────────────────────

/** The window surface {@link bootPreviewRealm} needs, injected so a test can hand it a fake. */
export interface PreviewRealmWindow {
  location: { search: string };
  document: Document;
  customElements: CustomElementRegistry;
  parent: { postMessage: (message: CanvasEnvelope<FromRealm>, targetOrigin: string) => void };
  addEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
}

/** Whether a frame's query string asks for the preview realm rather than the canvas. */
export function isPreviewRealmSearch(search: string): boolean {
  return new URLSearchParams(search).get(PREVIEW_REALM_PARAM) === PREVIEW_REALM_VALUE;
}

/**
 * Boot the realm in its frame: authenticate to the host's dev proxy as the canvas does, open the
 * token- and origin-gated channel to the shell (both ride the frame's URL, `iframe-host.ts`), and
 * announce `ready`.
 */
export function bootPreviewRealm(win: PreviewRealmWindow): () => void {
  const params = new URLSearchParams(win.location.search);
  setResolveToken(params.get("rpcToken"));
  // A shell on a custom scheme has no origin to round-trip; the token alone gates the channel then.
  const parentOrigin = params.get("parentOrigin") || "*";
  const channel = postMessageChannel<FromRealm, ToRealm>({
    acceptOrigin: parentOrigin,
    source: win,
    target: win.parent,
    targetOrigin: parentOrigin,
    token: params.get("token") ?? "",
  });
  const stop = startPreviewRealm({
    channel,
    document: win.document,
    registry: win.customElements,
  });
  return () => {
    stop();
    channel.dispose();
  };
}
