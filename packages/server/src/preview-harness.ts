/**
 * A component or a layout, run on its own on the live preview origin (`specs/server.md` §3.4).
 *
 * A page has a route and a component does not, so until now the only place a component's handlers
 * ran was the canvas. This gives one an address: `/__jx_live__/harness/<project path>`, answered
 * with a page nobody wrote, which uses the component once, or wraps placeholder content in the
 * layout.
 *
 * **There is no second rendering path.** The host page is a document handed to the same
 * `composePage` a route is composed by, through a reader that answers one extra path. So the
 * project's `<head>`, its `style`, its `$elements`, `$site`/`$page` and the reload client all
 * arrive the way they do for a page, and whatever a page gains later this gains with it.
 *
 * **Test props travel in the address, as a `props` query parameter holding JSON.** The alternative
 * was a store the editor POSTs into, and it loses on every count that matters here: a reload, the
 * live-reload stream and a retarget all re-request the URL, so an address that carries its own
 * inputs keeps rendering the same thing where a store has to outlive the tab that reads it; and a
 * store needs a new route on every backend, where the address needs none. What an address costs is
 * that anyone can write one, so the values are held to four rules:
 *
 * - **Keyed.** A component that binds a prop into `innerHTML` or an `href` runs what the value says,
 *   and this origin's pages hold its resolver credential. So values are applied only when the
 *   address also carries this origin's harness key ({@link HARNESS_KEY_PARAM}), which the server
 *   mints per origin and adds itself to an address its own opener asked for (`live-preview.ts`).
 *   Without it the component renders with its declared defaults and the page says why. An address
 *   with no values reflects nothing, so it needs no key.
 * - **Bounded.** The query is refused past {@link HARNESS_QUERY_MAX} characters, well inside what an
 *   HTTP request line carries.
 * - **Plain data only.** A value reaches the instance as `$props`, where the runtime reads a string
 *   holding `${` as a template and an object holding `$ref` as a binding. Either would let an
 *   address run an expression on this origin, so a value holding one anywhere is left out and the
 *   page says which prop was.
 * - **Never echoed.** A value is serialized into the page's `application/json` block by the shell,
 *   which escapes `<`, and nowhere else. The note this module writes names only props the
 *   component's own file declares, so nothing from the address becomes markup or a template.
 *
 * **Only the project's own components and layouts are addressable.** The path must be one the tree
 * already lists under `components/` or `layouts/`, both of which this origin serves as files
 * anyway, so the harness reads nothing a reader could not already fetch.
 *
 * @docs framework/build/dev-server
 * @docs studio/design/components
 */

import { ComposeError, composePage } from "@jxsuite/site/compose";
import type { ComposedPage, PageRoute, SiteIO } from "@jxsuite/site/compose";
import { normalizeRequestPath } from "@jxsuite/site/paths";
import {
  isNonNullObject,
  isPrivateStateKey,
  isString,
  isTemplateString,
} from "@jxsuite/schema/guards";
import { isNativeDocumentPath, parseNativeDocument } from "@jxsuite/schema/jxn";
import { errorMessage } from "@jxsuite/schema/parse";
import { HARNESS_QUERY_MAX } from "@jxsuite/protocol/preview-harness";
import type {
  JsonValue,
  JxDocument,
  JxElement,
  JxStateDefinition,
  ProjectConfig,
} from "@jxsuite/schema/types";

/**
 * The query parameter a harness address carries this origin's key in.
 *
 * Read and written by the server alone. Studio never builds it: it asks for an address without one,
 * and the origin adds the key on the way to the tab.
 */
export const HARNESS_KEY_PARAM = "key";

/** What the page says when an address carried values and not the key. */
export const UNKEYED_NOTE =
  "Test values were not applied, because this address was not opened from Studio. Open the component from Studio to run it with them.";

/**
 * A harness query without the key the origin appended to it.
 *
 * The bound on a query is the one `@jxsuite/protocol` holds an address to before the key exists, so
 * the key is not counted against it.
 */
export function withoutHarnessKey(search: string): string {
  return search.replace(new RegExp(`&${HARNESS_KEY_PARAM}=[^&]*$`), "");
}

/** The path the host page is read from. It names no file, and no route table ever lists it. */
const HOST_PAGE = "pages/__jx_live__/harness.json";

/**
 * Whether a string would be read as a template wherever the runtime meets it.
 *
 * `isTemplateString` asks the same question as a type guard, which narrows a string it refuses to
 * `never`; this one is for a value already known to be a string.
 */
function holdsTemplate(text: string): boolean {
  return text.includes("${");
}

/** What a harness address names. */
export interface HarnessTarget {
  kind: "component" | "layout";
  /** The document's project path, e.g. `components/user-card.json`. */
  path: string;
}

/**
 * The document a harness address names, or null when it names none this origin will run.
 *
 * Membership in `paths` is the whole check that matters: that list is the tree's servable files
 * plus the editor's unsaved ones, so a path outside the project, a dotfile and `project.json` are
 * all absent from it. The normalization ahead of it refuses traversal rather than resolving it, as
 * every other read on this origin does.
 *
 * @param surfacePath What follows `/__jx_live__/harness/`, still URL-encoded.
 * @param paths Every path the tree lists.
 */
export function harnessTarget(surfacePath: string, paths: readonly string[]): HarnessTarget | null {
  const path = normalizeRequestPath(surfacePath);
  if (path === null || holdsTemplate(path) || !paths.includes(path)) {
    return null;
  }
  if (path.startsWith("components/")) {
    return { kind: "component", path };
  }
  if (path.startsWith("layouts/")) {
    return { kind: "layout", path };
  }
  return null;
}

/** The object shapes a state entry takes when it is neither a primitive nor an array. */
function isStateObject(def: JxStateDefinition | undefined): def is Record<string, JsonValue> {
  return isNonNullObject(def) && !Array.isArray(def);
}

/**
 * A component's props and their declared defaults: its public, plain-data state entries.
 *
 * The same subset Studio offers test values for (`packages/studio/src/component-props.ts`): never a
 * private entry, an expression, a computed, a handler, a data source or a template, because
 * overriding one of those would replace behavior with a value.
 */
export function declaredProps(doc: JxDocument): Map<string, JsonValue | undefined> {
  const props = new Map<string, JsonValue | undefined>();
  for (const [name, def] of Object.entries(doc.state ?? {})) {
    if (isPrivateStateKey(name) || holdsTemplate(name) || isTemplateString(def)) {
      continue;
    }
    if (!isStateObject(def)) {
      /* SAFETY: a state entry that is no object is a JSON primitive or an array of JSON values,
         which is the document's own literal for the prop. */
      props.set(name, def as JsonValue);
      continue;
    }
    if (def.$expression || def.$compute || def.$prototype || def.$handler) {
      continue;
    }
    props.set(name, "default" in def || "type" in def ? def.default : def);
  }
  return props;
}

/**
 * Whether a value is data all the way down: no template string, and no `$`-prefixed key.
 *
 * Deeper than the runtime strictly needs, which reads only the top of a `$props` value. The rule is
 * the cheap one to state and to keep true if a later reader looks further in.
 */
function isPlainData(value: JsonValue): boolean {
  if (isString(value)) {
    return !holdsTemplate(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => isPlainData(item));
  }
  if (isNonNullObject(value)) {
    return Object.entries(value).every(
      ([key, member]) => !key.startsWith("$") && isPlainData(member),
    );
  }
  return true;
}

/** What an address's query gave, sorted into what is applied and what the page must say. */
export interface HarnessProps {
  /** Values for declared props, each plain data. */
  applied: Record<string, JsonValue>;
  /** Declared props whose value was left out because it was not plain data. */
  refused: string[];
  /** Why no value was read at all, when none was. */
  unread: string | null;
}

/**
 * Read the `props` query parameter against what the component declares.
 *
 * A name the component does not declare is dropped without a word: it changes nothing about the
 * render, and repeating it on the page would be the one way text from an address could reach a
 * reader.
 *
 * @param search The request's query string, as sent.
 * @param declared The component's props.
 * @param keyed Whether the address carried this origin's harness key. Without it no value is
 *   applied or even parsed, whatever the query holds.
 */
export function readHarnessProps(
  search: string,
  declared: ReadonlyMap<string, JsonValue | undefined>,
  keyed: boolean,
): HarnessProps {
  const result: HarnessProps = { applied: {}, refused: [], unread: null };
  if (withoutHarnessKey(search).length > HARNESS_QUERY_MAX) {
    result.unread = "The test values in this address are too large, so none were applied.";
    return result;
  }
  const raw = new URLSearchParams(search).get("props");
  if (raw === null) {
    return result;
  }
  if (!keyed) {
    result.unread = UNKEYED_NOTE;
    return result;
  }
  let parsed: JsonValue;
  try {
    /* SAFETY: trust boundary. Anyone can write an address, so the value is used below only once
       it is seen to be an object, and each member only once it is seen to be plain data. */
    parsed = JSON.parse(raw) as JsonValue;
  } catch {
    parsed = null;
  }
  if (!isNonNullObject(parsed) || Array.isArray(parsed)) {
    result.unread = "The test values in this address could not be read, so none were applied.";
    return result;
  }
  for (const [name, value] of Object.entries(parsed)) {
    if (!declared.has(name)) {
      continue;
    }
    if (isPlainData(value)) {
      result.applied[name] = value;
    } else {
      result.refused.push(name);
    }
  }
  return result;
}

/** The sentences a component's host page opens with, or none when there is nothing to say. */
export function harnessNotes(
  declared: ReadonlyMap<string, JsonValue | undefined>,
  props: HarnessProps,
): string[] {
  const notes: string[] = [];
  if (props.unread) {
    notes.push(props.unread);
  }
  if (props.refused.length > 0) {
    notes.push(
      `Left out, because an address carries plain values and not expressions: ${props.refused.join(", ")}.`,
    );
  }
  const missing = [...declared].flatMap(([name, value]) =>
    (value === undefined || value === null) && !Object.hasOwn(props.applied, name) ? [name] : [],
  );
  if (missing.length > 0) {
    notes.push(
      `Shown with its declared defaults. No test value is set for: ${missing.join(", ")}. Set them in Studio's "resolving with" popover and open this again.`,
    );
  }
  return notes;
}

/** How the note above a harnessed component is drawn: apart from the component, and plainly. */
const NOTE_STYLE = {
  background: "#fff8e1",
  borderBottom: "1px solid #e0c36a",
  color: "#3d3200",
  font: "13px/1.5 system-ui, sans-serif",
  margin: "0",
  padding: "8px 12px",
};

/** How a layout's placeholder content is drawn: visibly a stand-in, never mistaken for the site. */
const PLACEHOLDER_STYLE = {
  border: "1px dashed currentColor",
  font: "13px/1.5 system-ui, sans-serif",
  opacity: "0.7",
  padding: "24px 12px",
  textAlign: "center",
};

/** Read one of the project's documents in a native format, or null when it is not one. */
async function readNative(io: SiteIO, path: string): Promise<JxDocument | null> {
  const text = await io.read(path);
  if (text === null || !isNativeDocumentPath(path)) {
    return null;
  }
  try {
    return parseNativeDocument(text, path);
  } catch (error) {
    throw new ComposeError(`${path} could not be read: ${errorMessage(error)}`);
  }
}

/** The page that uses a component once, with its test props. */
async function componentHost(
  io: SiteIO,
  path: string,
  search: string,
  keyed: boolean,
): Promise<JxDocument> {
  const definition = await readNative(io, path);
  if (!definition) {
    /* The browser registers a component by fetching its file and reading it as a document, so one
       in a format that needs an extension's parser cannot be registered from here by anyone. */
    throw new ComposeError(
      `${path} could not be run on its own. Only .json and .jxn components run here; other formats need their extension's parser, which a browser does not have.`,
    );
  }
  const { tagName } = definition;
  if (!isString(tagName) || !tagName.includes("-") || holdsTemplate(tagName)) {
    throw new ComposeError(
      `${path} does not define a custom element, so there is nothing to run on its own.`,
    );
  }
  const declared = declaredProps(definition);
  const props = readHarnessProps(search, declared, keyed);
  const instance: JxElement = { tagName };
  if (Object.keys(props.applied).length > 0) {
    instance.$props = props.applied;
  }
  const notes: JxElement[] = harnessNotes(declared, props).map((textContent) => ({
    attributes: { "data-jx-harness-note": "", role: "status" },
    style: NOTE_STYLE,
    tagName: "p",
    textContent,
  }));
  return {
    $elements: [{ $ref: `./${path}` }],
    attributes: { "data-jx-harness": "component" },
    children: [...notes, instance],
    tagName: "main",
    title: tagName,
  };
}

/** Every named slot a layout declares, in document order, each once. */
function namedSlots(node: JxElement | string, into: Set<string>): Set<string> {
  if (!isNonNullObject(node)) {
    return into;
  }
  const name = node.tagName === "slot" ? node.attributes?.name : undefined;
  if (isString(name) && name !== "" && !holdsTemplate(name)) {
    into.add(name);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      namedSlots(child, into);
    }
  }
  return into;
}

/** The page that wraps placeholder content in a layout: one stand-in per slot it declares. */
async function layoutHost(io: SiteIO, path: string): Promise<JxDocument> {
  const layout = await readNative(io, path);
  const placeholder = (label: string, slot?: string): JxElement => ({
    attributes:
      slot === undefined ? { "data-jx-harness-slot": "" } : { "data-jx-harness-slot": slot, slot },
    style: PLACEHOLDER_STYLE,
    tagName: "div",
    textContent: label,
  });
  const named = layout ? [...namedSlots(layout, new Set())] : [];
  return {
    $layout: `./${path}`,
    children: [
      placeholder("Page content goes here"),
      ...named.map((slot) => placeholder(`Content for the "${slot}" slot goes here`, slot)),
    ],
    title: path,
  };
}

/**
 * Compose the page a harness address asks for.
 *
 * Throws a `ComposeError` for anything the author can act on, exactly as composing a route does, so
 * the caller reports both through one page.
 *
 * @param io Reads the working tree, unsaved documents first.
 * @param config The project's configuration.
 * @param target The component or layout to run.
 * @param search The request's query string, as sent.
 * @param keyed Whether the address carried this origin's harness key.
 */
export async function composeHarness(
  io: SiteIO,
  config: ProjectConfig,
  target: HarnessTarget,
  search: string,
  keyed: boolean,
): Promise<ComposedPage> {
  /* A component's host says `$layout: false`, the authored way to say no layout wraps a page
     (`site-architecture.md` §5): without it the project's default layout would wrap the component,
     and it would no longer be on its own. It is written here, into the text, because the declared
     type spells `$layout` as a string alone. */
  const text =
    target.kind === "component"
      ? JSON.stringify({ ...(await componentHost(io, target.path, search, keyed)), $layout: false })
      : JSON.stringify(await layoutHost(io, target.path));
  const route: PageRoute = {
    isCatchAll: false,
    isDynamic: false,
    params: [],
    sourcePath: HOST_PAGE,
    /* A fixed pattern, not the address: it becomes `$page.url`, a state string, and a state string
       holding `${` is a template. */
    urlPattern: "/__jx_live__/harness",
  };
  const hostIO: SiteIO = {
    ...io,
    read: (path) => (path === HOST_PAGE ? Promise.resolve(text) : io.read(path)),
  };
  return composePage(hostIO, route, config, {});
}
