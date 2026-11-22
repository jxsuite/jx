/// <reference lib="dom" />
/**
 * What a surface asks the preview realm, by document (`project-state.md` §11.2): a component's
 * preview, whether a definition renders with its sample props, and the definition itself, read from
 * the content store. Apart from `browse/library-preview.ts` because the palette (`panels/dnd.ts`)
 * and Project Styles (`style/stylebook-specimens.ts`) ask the same questions without the Library's
 * cache, its format host or its document reads.
 *
 * @docs studio/interface
 */

import { isNativeDocumentPath, parseNativeDocument } from "@jxsuite/schema/jxn";
import { isNonNullObject } from "@jxsuite/schema/guards";
import { documentBase } from "../canvas/canvas-origin";
import { componentExampleProps } from "../browse/component-examples";
import { projectState } from "../store";
import { previewRealm, realmDocId, storedText } from "./client";
import type { PreviewSnapshot, RealmAnswer } from "./host";
import { PREVIEW_FALLBACK_CLASS } from "./protocol";
import type { RealmDocument } from "./protocol";
import type { ComponentEntry } from "../files/components";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";

/** The failures already reported, one line each, so a repaint does not repeat them. */
const _reported = new Set<string>();

/**
 * Report a preview failure on the console, once per file and message.
 *
 * Not a Problem: a document mid-edit that does not render yet is a real state of the project, not
 * something the author must act on. But a failure nobody can see is how "the cards have no
 * previews" went undiagnosed, so the reason is written where a developer looks.
 */
export function reportPreviewFailure(path: string, message: string): void {
  const key = `${path}\n${message}`;
  if (_reported.has(key)) {
    return;
  }
  _reported.add(key);
  console.warn(`Jx Studio: no preview for ${path}: ${message}`);
}

/**
 * The URL a previewed document's relative refs resolve against: the file's own URL under the
 * project, as the canvas spells it. A shell with an opaque origin (a custom-scheme shell such as
 * `views://`) has no such URL to build, and keeps the shell's own address.
 */
function previewBase(filePath: string): string {
  const base = documentBase(projectState?.projectRoot);
  return URL.canParse(base) ? new URL(filePath, base).href : location.href;
}

/** A document as the realm is handed it: by `DocId`, at its path, under its own URL. */
export function realmTarget(path: string, document_: JxDocument): RealmDocument {
  return { base: previewBase(path), docId: realmDocId(path), document: document_, path };
}

/** The realm's answer as a snapshot, or null when it drew nothing. */
export function snapshotOf(answer: RealmAnswer): PreviewSnapshot | null {
  return answer.kind === "rendered" ? answer.snapshot : null;
}

/** The attribute defaults the registry lists for a component, as its preview instance carries them. */
function attributeDefaults(component: ComponentEntry) {
  const attributes: Record<string, string> = {};
  for (const p of component.props ?? []) {
    if (p.default !== undefined && p.default !== "false" && p.default !== "''") {
      attributes[p.name] = String(p.default).replaceAll(/^'|'$/g, "");
    }
  }
  return attributes;
}

/** An inert document markup is built in: nothing made in it is upgraded or loads anything. */
let _inert: Document | null = null;
function inertDocument(): Document {
  _inert ??= document.implementation.createHTMLDocument("");
  return _inert;
}

/**
 * The markup of one element of `tag` carrying `attributes`, or of the box that names `tag` when
 * `fallback` is set; built in an inert document, so nothing is constructed to build it.
 */
function markupOf(tag: string, attributes: Readonly<Record<string, string>>, fallback = false) {
  const doc = inertDocument();
  if (fallback) {
    const box = doc.createElement("div");
    box.className = PREVIEW_FALLBACK_CLASS;
    box.textContent = `<${tag}>`;
    return box.outerHTML;
  }
  const element = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element.outerHTML;
}

/** The box naming `tag` that a card shows when the realm cannot draw its component. */
export function fallbackSnapshot(tag: string): PreviewSnapshot {
  return { html: markupOf(tag, {}, true), sheet: null };
}

/**
 * A component's preview, asked of the realm: a project definition's instance given its declared
 * sample props (`component-examples.ts`), after the realm has checked it renders with them; any
 * other component (a package's, a format-class source) as the realm can draw its tag, which it
 * never imports a package to do.
 *
 * One exception: a package component whose tag Studio's own window already defines (the
 * `@jxsuite/ui` kit Studio is drawn with) is answered here, as one element of that tag, since the
 * shell's registry draws it once the card mounts it and nothing a project wrote runs to do so.
 */
export async function componentPreview(component: ComponentEntry): Promise<RealmAnswer> {
  const { path } = component;
  const attributes = attributeDefaults(component);
  if (component.source === "npm" && customElements.get(component.tagName)) {
    return {
      kind: "rendered",
      snapshot: { html: markupOf(component.tagName, attributes), sheet: null },
    };
  }
  if (component.source === "npm" || path === undefined || !isNativeDocumentPath(path)) {
    return previewRealm().ask({ attributes, kind: "package", tag: component.tagName });
  }
  const definition = await readDefinition(path);
  if (!definition) {
    return { kind: "failed", message: "its definition could not be read" };
  }
  const props = Object.fromEntries(componentExampleProps(definition));
  return previewRealm().ask({
    attributes,
    kind: "instance",
    props,
    target: realmTarget(path, definition),
  });
}

/**
 * A component's preview by itself, uncached: what a card that is not in a cached view (the palette
 * row, `panels/dnd.ts`) mounts. A component the realm cannot draw is the box naming its tag, and
 * why is written to the console once. Null when the realm went away before it answered
 * (`RealmAnswer`'s `lost`), which says nothing about the component: the card asks again.
 */
export async function cardSnapshot(component: ComponentEntry): Promise<PreviewSnapshot | null> {
  const answer = await componentPreview(component);
  if (answer.kind === "rendered") {
    return answer.snapshot;
  }
  if (answer.kind === "failed" && answer.lost === true) {
    return null;
  }
  if (answer.kind === "failed") {
    reportPreviewFailure(component.path ?? component.tagName, answer.message);
  }
  return fallbackSnapshot(component.tagName);
}

/** A project component's definition, from the content store, or null when its file is not one. */
export async function readDefinition(path: string): Promise<JxDocument | null> {
  try {
    const parsed: unknown = parseNativeDocument(await storedText(path), path);
    /* SAFETY: a project component's file is its definition, a Jx element document; a shape the
       realm cannot draw is answered `failed`, which is "does not render". */
    return isNonNullObject(parsed) && !Array.isArray(parsed) ? (parsed as JxDocument) : null;
  } catch {
    return null;
  }
}

/**
 * Whether `definition` renders given `props` (its sample props, `component-examples.ts`), asked of
 * the preview realm, which tries it on a detached copy (`preview-realm/frame.ts`'s `trialRender`).
 *
 * A definition may not render with the values it is given: the museum starter's
 * `<mu-exhibition-card>` formats a `date` that defaults to `""`, and `Intl/formatDate` of an empty
 * date is a `RangeError`, exactly as `new Intl.DateTimeFormat().format(new Date(""))` is (`spec.md`
 * §19.4c). The reason a definition did not render is written to the console once.
 *
 * Rejects when the realm went away before it answered (replaced mid-trial, not started, none
 * installed): that is no answer about the definition, and a caller that remembers answers must not
 * remember it as "does not render".
 */
export async function rendersWith(
  definition: JxDocument,
  path: string,
  props: ReadonlyMap<string, JsonValue>,
): Promise<boolean> {
  const answer = await previewRealm().ask({
    kind: "trial",
    props: Object.fromEntries(props),
    target: realmTarget(path, definition),
  });
  if (answer.kind === "failed" && answer.lost === true) {
    throw new Error(answer.message);
  }
  if (answer.kind === "failed") {
    reportPreviewFailure(path, answer.message);
    return false;
  }
  return true;
}
