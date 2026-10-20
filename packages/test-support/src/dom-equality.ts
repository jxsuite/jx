/**
 * Refuses deep equality on DOM nodes in `bun test`, before Bun's diff printer can reach one.
 *
 * Why it exists: a failing `toEqual` / `toStrictEqual` between two distinct live kit elements does
 * not fail, it hangs. Its diff is drawn by a printer that ignores the compact inspect hook
 * (`inspect-dom.ts`) and walks everything reachable from each element (its reactive state, the
 * effect graph that state reaches, the document), and it was measured printing nothing for over 100
 * seconds before being killed. A passing comparison is no better a habit: two distinct elements are
 * equal only by accident of that walk, which is not a question a test means to ask.
 *
 * So the comparison is refused, pass or fail, whenever an operand IS a node or holds one within a
 * few levels: inside arrays, maps, sets, plain objects and class instances alike (an `Event`'s
 * target, a `MutationRecord`, a record class of a test's own), because Bun's diff prints the own
 * properties of every object it meets, symbol-keyed ones included. The refusal is thrown before Bun
 * formats anything. Everything else goes through to Bun's own matcher untouched, so a plain-object
 * `toEqual` still fails with Bun's own diff.
 *
 * Which operands a matcher compares deeply is per matcher, and was measured on Bun 1.4.2 against
 * two mounted `jx-tabs` (each hang was killed at 20 seconds with no output):
 *
 * - `toEqual`, `toStrictEqual`, `toMatchObject`, `toContainEqual`: received and expected.
 * - `toHaveProperty(path, value)`: the value at `path` and `value`. With no `value` it compares
 *   nothing, and `expect(element).toHaveProperty("tagName", "DIV")` prints the element compactly,
 *   so neither is refused.
 * - `toHaveBeenCalledWith` / `toBeCalledWith`: the expected arguments and EVERY recorded call,
 *   because the failure prints them all (`m(el); expect(m).toHaveBeenCalledWith("x")` hangs).
 *   `toHaveBeenLastCalledWith` / `lastCalledWith` print only the last call, and
 *   `toHaveBeenNthCalledWith` / `nthCalledWith` only the nth, so only that call is searched.
 *
 * The `toHaveReturnedWith` family and `toContain` print nodes through the compact hook and need no
 * guard (measured).
 *
 * The mechanism is `expect.extend`, which on Bun replaces a built-in matcher of the same name for
 * every later `expect(...)`, `.not`, `.resolves` and `.rejects`. Each guarded matcher keeps the
 * native one it replaced and delegates to it on a fresh `expect(received)`, so the native message
 * and diff are the ones a test sees. Measured on Bun 1.4.2 and 1.4.3. The two asymmetric containers
 * that recurse (`objectContaining`, `arrayContaining`) are wrapped where they are built, since a
 * container is opaque once made.
 *
 * @docs extending/contributing/monorepo
 */

import { describeNode } from "./inspect-dom.ts";
import type { InspectableNode, NodeClass } from "./inspect-dom.ts";

/** The first line of every refusal; tests and readers can match on it. */
export const DOM_EQUALITY_MESSAGE =
  "Deep equality on a DOM node: compare identity with toBe, or compare markup/attributes";

/** The built-in matchers whose failure prints a deep diff of their received and expected. */
export const OPERAND_MATCHERS = [
  "toEqual",
  "toStrictEqual",
  "toMatchObject",
  "toContainEqual",
] as const;

/** The mock-call matchers whose failure prints every recorded call. */
export const ALL_CALLS_MATCHERS = ["toHaveBeenCalledWith", "toBeCalledWith"] as const;

/** The mock-call matchers whose failure prints the last recorded call. */
export const LAST_CALL_MATCHERS = ["toHaveBeenLastCalledWith", "lastCalledWith"] as const;

/** The mock-call matchers whose failure prints the nth recorded call (`n` is the first argument). */
export const NTH_CALL_MATCHERS = ["toHaveBeenNthCalledWith", "nthCalledWith"] as const;

/** Every built-in matcher the guard replaces. */
export const GUARDED_MATCHERS = [
  ...OPERAND_MATCHERS,
  "toHaveProperty",
  ...ALL_CALLS_MATCHERS,
  ...LAST_CALL_MATCHERS,
  ...NTH_CALL_MATCHERS,
] as const;

/** One of {@link GUARDED_MATCHERS}. */
export type GuardedMatcherName = (typeof GUARDED_MATCHERS)[number];

/** The asymmetric containers that compare their sample deeply. */
export const GUARDED_CONTAINERS = ["objectContaining", "arrayContaining"] as const;

/** How many levels below an operand the search looks. */
const MAX_DEPTH = 4;
/** How many values the search visits per operand before it gives up looking. */
const MAX_VALUES = 256;

/** An object operand, class instances included: its properties, string- and symbol-keyed. */
export interface OperandRecord {
  [key: string]: Operand;
  [key: symbol]: Operand;
}

/**
 * A value a test hands to a deep-equality matcher. The search opens arrays, maps, sets and any
 * other object's own data properties; a function or a primitive is a leaf.
 */
export type Operand =
  | InspectableNode
  | OperandRecord
  | readonly Operand[]
  | ReadonlyMap<Operand, Operand>
  | ReadonlySet<Operand>
  | bigint
  | boolean
  | number
  | string
  | symbol
  | null
  | undefined;

/** Answers whether an operand is a DOM node: in the preload, `instanceof` happy-dom's `Node`. */
export type IsNode = (value: Operand) => value is InspectableNode;

/** The {@link IsNode} for one DOM implementation: an instance of its `Node` class. */
export function instanceOf(nodeClass: NodeClass): IsNode {
  return (value: Operand): value is InspectableNode => value instanceof nodeClass;
}

interface Pending {
  value: Operand;
  path: string;
  depth: number;
}

/** One operand to search, with the path its findings are named from (`received`, `expected[1]`). */
export type Searched = [value: Operand, root: string];

/**
 * The one place Bun's untyped operands enter. Every value is an {@link Operand} to the search: it
 * opens the containers that type names and treats anything else as a leaf it never reads, so there
 * is nothing to reject.
 */
function isOperand<Value>(value: Value): value is Value & Operand {
  return value !== isOperand;
}

/** `value` as an {@link Operand}; see {@link isOperand}. */
function operand<Value>(value: Value): Operand {
  return isOperand(value) ? value : undefined;
}

/** Whether an operand is an object of any kind, which is what the search opens. */
function isRecord(value: Operand): value is OperandRecord {
  return typeof value === "object" && value !== null;
}

function isString(value: Operand): value is string {
  return typeof value === "string";
}

function isNumber(value: Operand): value is number {
  return typeof value === "number";
}

/** A `bun:test` mock, as far as the guard reads it: the calls it recorded. */
interface RecordingMock {
  mock: { calls: readonly Operand[] };
}

function isMock<Value>(value: Value): value is Value & RecordingMock {
  if (typeof value !== "function" || !("mock" in value)) {
    return false;
  }
  const { mock } = value;
  return typeof mock === "object" && mock !== null && "calls" in mock && Array.isArray(mock.calls);
}

/**
 * The own data properties of an object, string- and symbol-keyed, which is what Bun's diff prints
 * of an object it does not know. Accessors are not called, a typed array's elements are not listed,
 * and an object whose reflection throws (a revoked proxy) has none.
 */
function ownValues(value: OperandRecord, path: string): [Operand, string][] {
  if (ArrayBuffer.isView(value)) {
    return [];
  }
  try {
    return Reflect.ownKeys(value)
      .slice(0, MAX_VALUES)
      .flatMap((key): [Operand, string][] => {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor)) {
          return [];
        }
        const name = isString(key) ? `.${key}` : `[${String(key)}]`;
        return [[value[key], `${path}${name}`]];
      });
  } catch {
    return [];
  }
}

/** The values one level inside a container, each with its path. */
function childrenOf(value: Operand, path: string): [Operand, string][] {
  if (!isRecord(value)) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_VALUES).map((item, index) => [item, `${path}[${index}]`]);
  }
  if (value instanceof Map) {
    return [...value].flatMap(([key, item]): [Operand, string][] => [
      [key, `${path} key`],
      [item, `${path}.get(…)`],
    ]);
  }
  if (value instanceof Set) {
    return [...value].map((item) => [item, `${path} member`]);
  }
  return ownValues(value, path);
}

/**
 * Where a DOM node sits inside `value`, as a path from `root` (`received.items[2]`), with the node
 * itself; undefined when there is none. Breadth-first, and bounded in depth and in values visited,
 * because walking an unbounded object graph is the very thing the guard exists to prevent.
 */
export function findNode<Value>(
  value: Value,
  isNode: IsNode,
  root: string,
): { node: InspectableNode; path: string } | undefined {
  const queue: Pending[] = [{ depth: 0, path: root, value: operand(value) }];
  // `for…of` over an array visits what is pushed onto it during the loop: this is the BFS queue.
  for (const next of queue) {
    if (isNode(next.value)) {
      return { node: next.value, path: next.path };
    }
    if (next.depth < MAX_DEPTH) {
      for (const [child, path] of childrenOf(next.value, next.path)) {
        if (queue.length < MAX_VALUES) {
          queue.push({ depth: next.depth + 1, path, value: child });
        }
      }
    }
  }
  return undefined;
}

/** The refusal for `matcher` when one of `operands` holds a node; undefined when none does. */
export function refusal(
  matcher: string,
  operands: readonly Searched[],
  isNode: IsNode,
): string | undefined {
  for (const [value, root] of operands) {
    const found = findNode(value, isNode, root);
    if (found !== undefined) {
      return `${DOM_EQUALITY_MESSAGE}.\n${matcher}: ${found.path} is ${describeNode(found.node)}.`;
    }
  }
  return undefined;
}

/** The path segments of a `toHaveProperty` path: `"a.b[0]"` and `["a", "b", 0]` alike. */
function pathKeys(path: Operand): string[] | undefined {
  if (isString(path)) {
    return path.split(/[.[\]]/u).filter((key) => key !== "");
  }
  if (Array.isArray(path)) {
    return Array.from(path, String);
  }
  return undefined;
}

/** The value `toHaveProperty` finds at `path` in `received`, as a {@link Searched}; none if absent. */
export function propertyAt(received: Operand, path: Operand): Searched[] {
  const keys = pathKeys(path);
  if (keys === undefined) {
    return [];
  }
  let current = received;
  for (const key of keys) {
    if (!isRecord(current) || !(key in current)) {
      return [];
    }
    current = current[key];
  }
  return [[current, `received.${keys.join(".")}`]];
}

/** The calls a mock recorded, or undefined when `received` is not a mock. */
export function recordedCalls<Received>(received: Received): readonly Operand[] | undefined {
  return isMock(received) ? received.mock.calls : undefined;
}

/** What one matcher's failure prints deeply, given the received value and the expected ones. */
type OperandSelector = (received: Operand, expected: readonly Operand[]) => Searched[];

/** Each expected value, named by its position: `expected[0]`. */
function positional(values: readonly Operand[]): Searched[] {
  return values.map((value, index): Searched => [value, `expected[${index}]`]);
}

const bothSides: OperandSelector = (received, expected) => [
  [received, "received"],
  ...expected.map((value): Searched => [value, "expected"]),
];

const propertyValue: OperandSelector = (received, [path, ...value]) =>
  value.length === 0 ? [] : [...propertyAt(received, path), [value[0], "expected"]];

const allCalls: OperandSelector = (received, expected) => [
  ...positional(expected),
  [recordedCalls(received), "received.mock.calls"],
];

const lastCall: OperandSelector = (received, expected) => {
  const calls = recordedCalls(received) ?? [];
  return [...positional(expected), [calls.at(-1), `received.mock.calls[${calls.length - 1}]`]];
};

const nthCall: OperandSelector = (received, [nth, ...expected]) => {
  const index = isNumber(nth) ? nth - 1 : -1;
  return [
    ...positional(expected),
    [recordedCalls(received)?.[index], `received.mock.calls[${index}]`],
  ];
};

/** What each guarded matcher's failure prints deeply. */
const SELECTORS: Record<GuardedMatcherName, OperandSelector> = {
  lastCalledWith: lastCall,
  nthCalledWith: nthCall,
  toBeCalledWith: allCalls,
  toContainEqual: bothSides,
  toEqual: bothSides,
  toHaveBeenCalledWith: allCalls,
  toHaveBeenLastCalledWith: lastCall,
  toHaveBeenNthCalledWith: nthCall,
  toHaveProperty: propertyValue,
  toMatchObject: bothSides,
  toStrictEqual: bothSides,
};

/** What the failure of matcher `name` prints deeply, given what the test handed it. */
export function searchedOperands<Received>(
  name: GuardedMatcherName,
  received: Received,
  expected: readonly Operand[],
): Searched[] {
  return SELECTORS[name](operand(received), expected);
}

/**
 * A native matcher, called with an `expect(...)` result as `this`. Each of Bun's takes its own
 * expected type (`toMatchObject` an object, `toEqual` the received type), so the one signature that
 * describes all of them is the one that accepts none of them; see the call in `guardMatcher`.
 */
type NativeMatcher = (this: Assertion, ...expected: never[]) => void;

/** What `expect(value)` returns, as far as the guard reads it. */
export type Assertion = Record<GuardedMatcherName, NativeMatcher> & { not: Assertion };

/** The parts of a Bun matcher's `this` the guard reads. */
interface MatcherContext {
  isNot: boolean;
}

/** What a guarded matcher returns to Bun when the native one it delegated to did not throw. */
export interface MatcherResult {
  pass: boolean;
  message: () => string;
}

/**
 * A matcher as `expect.extend` takes it. Generic in its operands because Bun hands a matcher
 * whatever the test passed; {@link findNode} is where they become {@link Operand}s.
 */
export type GuardedMatcher = <Received>(
  this: MatcherContext,
  received: Received,
  ...expected: Received[]
) => MatcherResult;

/** `expect.objectContaining`: one object sample, one asymmetric matcher back. */
export type ObjectContaining = <Sample extends object>(sample: Sample) => object;

/** `expect.arrayContaining`: one array sample, one asymmetric matcher back. */
export type ArrayContaining = <Item>(sample: readonly Item[]) => object;

/** The slice of Bun's `expect` the guard installs itself on. */
export interface GuardableExpect {
  <Value>(value: Value): Assertion;
  extend: (matchers: Record<GuardedMatcherName, GuardedMatcher>) => void;
  objectContaining: ObjectContaining;
  arrayContaining: ArrayContaining;
}

function guardMatcher(
  expectFn: GuardableExpect,
  name: GuardedMatcherName,
  isNode: IsNode,
): GuardedMatcher {
  // Read before `extend` runs: until then the method `expect(...)` inherits is the native one.
  const native = expectFn(null)[name];
  return function guarded<Received>(
    this: MatcherContext,
    received: Received,
    ...expected: Received[]
  ) {
    const refused = refusal(
      `expect(received).${this.isNot ? "not." : ""}${name}(expected)`,
      searchedOperands(
        name,
        received,
        expected.map((value) => operand(value)),
      ),
      isNode,
    );
    if (refused !== undefined) {
      throw new Error(refused);
    }
    // The code frame of a failure points here; the next stack line is the test's own `expect`.
    // `Error.captureStackTrace(error, guarded)` was tried and does not drop this frame on Bun.
    const target = expectFn(received);
    /* SAFETY: these are exactly the operands Bun handed this matcher for the native matcher of the
       same name, which Bun type-checks at the test's call site and accepts at run time. */
    native.call(this.isNot ? target.not : target, ...(expected as never[]));
    return { message: () => `${name} passed`, pass: !this.isNot };
  };
}

/** Throws the refusal for an asymmetric container built around a node. */
function refuseSample<Sample>(name: string, sample: Sample, isNode: IsNode): void {
  const refused = refusal(`expect.${name}(sample)`, [[operand(sample), "sample"]], isNode);
  if (refused !== undefined) {
    throw new Error(refused);
  }
}

const installed = new WeakSet<GuardableExpect>();

/**
 * Installs the guard on `expectFn` (the `expect` of `bun:test`). Idempotent: an `expect` that has
 * it keeps the one it has, so a preload that runs more than once in a realm cannot stack a guard on
 * a guard.
 */
export function installDomEqualityGuard(expectFn: GuardableExpect, isNode: IsNode): void {
  if (installed.has(expectFn)) {
    return;
  }
  installed.add(expectFn);
  /* SAFETY: built from GUARDED_MATCHERS, so it holds exactly one matcher per guarded name. */
  const matchers = Object.fromEntries(
    GUARDED_MATCHERS.map((name) => [name, guardMatcher(expectFn, name, isNode)]),
  ) as Record<GuardedMatcherName, GuardedMatcher>;
  expectFn.extend(matchers);
  const { arrayContaining, objectContaining } = expectFn;
  expectFn.objectContaining = <Sample extends object>(sample: Sample): object => {
    refuseSample("objectContaining", sample, isNode);
    return objectContaining(sample);
  };
  expectFn.arrayContaining = <Item>(sample: readonly Item[]): object => {
    refuseSample("arrayContaining", sample, isNode);
    return arrayContaining(sample);
  };
}
