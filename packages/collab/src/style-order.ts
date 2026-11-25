/**
 * The canonical key order of a style block (specs/collab.md §3.1).
 *
 * A `Y.Map` has no key order, so the shared document stores none: a style block is read in an order
 * that is a pure function of its keys, and two peers holding the same declarations read the same
 * block whatever order each wrote them in.
 *
 * Declarations come first. A shorthand sorts before every longhand it sets, directly or through
 * another shorthand (`border` before `border-color` before `border-bottom-color`), and property
 * name ascending breaks every other tie. Nested blocks (`&:hover`, `& a`, `@--sm`) follow, by key
 * name: the repository has no selector-specificity helper, so specificity is not what orders them.
 * The one exception is a breakpoint block, a nested key named `@--sm`, `@--dark` and the like: two
 * breakpoints can set the same property, so name order would change the rendered style. Those
 * follow the position of their key in the document's `$media` map, which keeps the author's order.
 */

import type { JxDocumentValue } from "@jxsuite/schema/types";
import { isJsonObject } from "@jxsuite/schema/guards";
import { SHORTHAND_LONGHANDS } from "./css-shorthands.ts";

/** Each longhand's shorthands, transitively, inverted from {@link SHORTHAND_LONGHANDS} once. */
const ANCESTORS: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const parents = new Map<string, Set<string>>();
  for (const [shorthand, longhands] of Object.entries<readonly string[]>(SHORTHAND_LONGHANDS)) {
    for (const longhand of longhands) {
      const set = parents.get(longhand) ?? new Set<string>();
      set.add(shorthand);
      parents.set(longhand, set);
    }
  }
  const closed = new Map<string, Set<string>>();
  const close = (name: string, seen: Set<string>): Set<string> => {
    const known = closed.get(name);
    if (known) {
      return known;
    }
    const all = new Set<string>();
    for (const parent of parents.get(name) ?? []) {
      if (!seen.has(parent)) {
        all.add(parent);
        for (const up of close(parent, new Set([...seen, name, parent]))) {
          all.add(up);
        }
      }
    }
    closed.set(name, all);
    return all;
  };
  for (const name of parents.keys()) {
    close(name, new Set([name]));
  }
  return closed;
})();

/** The kebab-case property name a style key stands for: `marginLeft` and `margin-left` alike. */
function propertyName(key: string): string {
  if (key.startsWith("--") || key.includes("-")) {
    return key;
  }
  const kebab = key.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return /^(webkit|moz|ms|o)-/.test(kebab) ? `-${kebab}` : kebab;
}

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Order declaration keys: shorthands before their longhands, then name ascending. Repeatedly takes
 * the first remaining name that no other remaining name is a shorthand of, which is the
 * lexicographically smallest topological order.
 */
function orderDeclarations(keys: readonly string[]): string[] {
  const remaining = keys.toSorted(byName).map((key) => ({ key, name: propertyName(key) }));
  const out: string[] = [];
  while (remaining.length > 0) {
    let pick = remaining.findIndex(({ name }) => {
      const above = ANCESTORS.get(name);
      return !above || !remaining.some((other) => other.name !== name && above.has(other.name));
    });
    if (pick < 0) {
      pick = 0;
    }
    out.push(remaining.splice(pick, 1)[0]!.key);
  }
  return out;
}

/** The at-rule key a `$media` entry names: `$media` key `--sm` is written `@--sm` in a style block. */
const BREAKPOINT_PREFIX = "@--";

/**
 * Order nested keys: by name, except that the `@--` breakpoint keys, which sort as one contiguous
 * run by name, are reordered within that run. Those in `media` come first, in the position of their
 * `$media` key (`@--sm` for `--sm`); any other `@--` key follows them, by name.
 */
function orderNested(nested: readonly string[], media: readonly string[]): string[] {
  const sorted = nested.toSorted(byName);
  const rank = new Map(media.map((key, index) => [`@${key}`, index]));
  const breakpoints = sorted
    .filter((key) => key.startsWith(BREAKPOINT_PREFIX))
    .toSorted((a, b) => {
      const ra = rank.get(a);
      const rb = rank.get(b);
      if (ra !== undefined && rb !== undefined) {
        return ra - rb;
      }
      return ra !== undefined ? -1 : rb !== undefined ? 1 : byName(a, b);
    });
  const queue = [...breakpoints];
  return sorted.map((key) => (key.startsWith(BREAKPOINT_PREFIX) ? queue.shift()! : key));
}

/**
 * The keys of a style block in canonical order: declarations, then nested blocks. `media` is the
 * key order of the document's `$media` map (`["--sm", "--md"]`), which orders `@--` breakpoints.
 */
export function canonicalStyleKeys(
  block: Readonly<Record<string, JxDocumentValue | undefined>>,
  media: readonly string[] = [],
): string[] {
  const declarations: string[] = [];
  const nested: string[] = [];
  for (const [key, value] of Object.entries(block)) {
    if (value === undefined) {
      continue;
    }
    (isJsonObject(value) ? nested : declarations).push(key);
  }
  return [...orderDeclarations(declarations), ...orderNested(nested, media)];
}

/** A style block, nested blocks included. */
export type StyleBlock = Record<string, JxDocumentValue>;

/** A style block with its keys, and those of every nested block, in canonical order. */
export function canonicalStyle(
  block: Readonly<Record<string, JxDocumentValue | undefined>>,
  media: readonly string[] = [],
): StyleBlock {
  return Object.fromEntries(
    canonicalStyleKeys(block, media).map((key) => {
      const value = block[key]!;
      return [key, isJsonObject(value) ? canonicalStyle(value, media) : value];
    }),
  );
}
