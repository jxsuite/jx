/**
 * Compact printing for DOM nodes in `bun test` failure output. A test-only module, exported as
 * `@jxsuite/ui/testing/inspect-dom` and installed by a workspace's `bunfig.toml` preload, so every
 * test file in that workspace gets it whether or not it goes through a shared harness.
 *
 * Why it exists: Bun prints a failing `expect(a).toBe(b)` by inspecting both operands, and a
 * happy-dom element is an object with hundreds of symbol-keyed slots. A kit element also carries
 * its reactive state (`_state`, computed refs, their dependency links, the whole effect graph they
 * reach), and the inspector walks all of it. One failing `toBe(liveElement)` in the Studio suite
 * printed 2.8 million lines in three and a half minutes and then left the CI job silent until its
 * 25-minute timeout; locally the same walk took 13 seconds. A failure message needs to say WHICH
 * element, not everything reachable from it.
 *
 * Bun's inspector honours `Symbol.for("nodejs.util.inspect.custom")` (which is
 * `Bun.inspect.custom`) on a prototype, and `toBe`'s message is built by that inspector, so the
 * hook is defined once on happy-dom's `Node.prototype` and every element, text node, comment and
 * document inherits it. The printed form is the node's opening tag with a few attributes and an
 * identity marker (`#7`): two distinct elements with the same markup print differently, which is
 * the whole question a failing `toBe` between elements asks.
 *
 * NOT covered: a failing `toEqual` / `toStrictEqual` between two distinct live kit elements. Its
 * diff is drawn by a separate printer that ignores the hook and walks the same graph, and it was
 * measured hanging with no output for over 100 seconds. Compare elements by identity (`toBe`) or by
 * the property you mean, never by deep equality; CI's per-run deadline is the only net under it.
 */

import { dirname } from "node:path";

/** The well-known symbol both Node's and Bun's inspectors call. */
export const INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");

/** How many attributes an element's printed tag shows before eliding the rest. */
const MAX_ATTRIBUTES = 4;
/** How long an attribute value or a text node's data may run before it is cut. */
const MAX_VALUE = 40;

export interface InspectableNode {
  nodeType: number;
  nodeName: string;
  localName?: string | null;
  attributes?: Iterable<{ name: string; value: string }>;
  childNodes?: ArrayLike<unknown>;
  data?: string;
  isConnected?: boolean;
}

/** The prototype the printer is defined on: happy-dom's `Node.prototype`, or a stand-in for it. */
export interface NodePrototype {
  [INSPECT_CUSTOM]?: (this: InspectableNode) => string;
}

const ids = new WeakMap<InspectableNode, number>();
let nextId = 1;

/** A stable per-node number, so two nodes with identical markup are told apart. */
export function nodeId(node: InspectableNode): number {
  let id = ids.get(node);
  if (id === undefined) {
    id = nextId;
    nextId += 1;
    ids.set(node, id);
  }
  return id;
}

function cut(text: string): string {
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
}

function openingTag(node: InspectableNode): string {
  const attributes = node.attributes ? [...node.attributes] : [];
  const shown = attributes
    .slice(0, MAX_ATTRIBUTES)
    .map((attribute) => ` ${attribute.name}="${cut(attribute.value)}"`)
    .join("");
  const more = attributes.length > MAX_ATTRIBUTES ? " …" : "";
  const children = node.childNodes?.length ?? 0;
  const body = children > 0 ? `…${children} child${children === 1 ? "" : "ren"}` : "";
  return `<${node.localName ?? node.nodeName.toLowerCase()}${shown}${more}>${body}`;
}

/** The one-line form a node prints as: `<jx-tabs part="workspaces" …> #3`. */
export function describeNode(node: InspectableNode): string {
  let head: string;
  switch (node.nodeType) {
    case 1: {
      head = openingTag(node);
      break;
    }
    case 3:
    case 8: {
      head = `${node.nodeName} ${JSON.stringify(cut(node.data ?? ""))}`;
      break;
    }
    default: {
      head = node.nodeName;
    }
  }
  const detached = node.isConnected === false ? " (detached)" : "";
  return `${head} #${nodeId(node)}${detached}`;
}

/**
 * Defines the compact printer on `nodePrototype`, the prototype every DOM node inherits.
 * Idempotent: a prototype that already has it keeps the one it has.
 */
export function installCompactInspect(nodePrototype: NodePrototype): void {
  if (Object.hasOwn(nodePrototype, INSPECT_CUSTOM)) {
    return;
  }
  Object.defineProperty(nodePrototype, INSPECT_CUSTOM, {
    configurable: true,
    value(this: InspectableNode): string {
      return describeNode(this);
    },
  });
}

/**
 * Installs the printer on the happy-dom that `@happy-dom/global-registrator` registers. happy-dom
 * is resolved from the registrator's own location rather than by bare name, so the prototype
 * patched is the one the registered window's nodes are built from, and so no workspace has to
 * declare happy-dom just to reach it. The window need not be registered yet: the classes are
 * module-level.
 */
export async function installCompactDomInspect(): Promise<void> {
  const registrator = Bun.resolveSync("@happy-dom/global-registrator", import.meta.dir);
  const happyDom = Bun.resolveSync("happy-dom", dirname(registrator));
  /* SAFETY: happy-dom's entry exports its `Node` class; only its prototype is used here. */
  const { Node } = (await import(happyDom)) as { Node: { prototype: NodePrototype } };
  installCompactInspect(Node.prototype);
}
