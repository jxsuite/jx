/**
 * The hold axis (site-architecture.md §7.6): what a project says keeps an entry back, what state an
 * entry is in by those rules, and whether held entries are listed. One place, every list.
 *
 * Jx gives no field a meaning of its own. A project names its fields and writes `hold` rules on a
 * content type, so everything here reads those rules and nothing here knows the word "draft". The
 * loader answers the same rules with the same code (`@jxsuite/schema/content-query`), which is what
 * lets a badge here say what the build will actually do.
 *
 * It is deliberately its own module rather than a field on a pane's state and rather than a section
 * of `entry-model.ts`. Two reasons, and the second is why the definitions live here beside the
 * flag:
 *
 * 1. **The perspective is a fact about the AUTHOR, not the surface.** A filter that belonged to the
 *    Library would answer for the Library only, and the same author would then be shown a held
 *    entry in the collection grid, in the pages grid and in Quick Open a second later.
 * 2. **Every list that must obey it has to be able to import it.** `entry-model.ts` asks
 *    `grid/sources/content-source.ts` where a collection's entries live, so the grid source cannot
 *    ask `entry-model.ts` back what a hold is: `import/no-cycle` is an error in this repo, and the
 *    cycle would be real.
 *
 * @docs studio/projects/content-types
 */

import { compileHold } from "@jxsuite/schema/content-query";
import type { HoldPredicate } from "@jxsuite/schema/content-query";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";
import { reactive } from "../reactivity";
import type { ContentSectionEntry } from "../types";
import type { EntryFields } from "./entry-fields";

/** What this module reads off a content type's definition. */
export type HoldBearer = Pick<ContentSectionEntry, "hold">;

/** The word for an entry no rule holds, on a collection that has rules. */
export const NOT_HELD = "Published";

/** The rules a definition states, or none: a value that is not a list has no rules to read. */
function rulesOf(def: HoldBearer | null | undefined): JsonValue[] {
  /* SAFETY: `hold` is read straight out of `project.json`, so whatever it holds is JSON. */
  return Array.isArray(def?.hold) ? (def.hold as JsonValue[]) : [];
}

/** Each rules list's compiled answer, kept for as long as the list itself is. */
const compiled = new WeakMap<object, HoldPredicate>();

/** The compiled rules, answering nothing if they cannot compile: the build is who reports those. */
function predicateOf(def: HoldBearer | null | undefined): HoldPredicate {
  const rules = rulesOf(def);
  const known = compiled.get(rules);
  if (known) {
    return known;
  }
  let predicate: HoldPredicate;
  try {
    predicate = compileHold(rules);
  } catch {
    predicate = () => {};
  }
  compiled.set(rules, predicate);
  return predicate;
}

/** Whether this collection has rules at all. With none, it has no state to show. */
export function hasHold(def: HoldBearer | null | undefined): boolean {
  return rulesOf(def).length > 0;
}

/**
 * The label of the rule holding this entry, or null. Takes the entry's FIELDS, whichever record
 * they live in: `content/entry-fields.ts` answers that, because a JSON collection's entry has no
 * frontmatter and its fields are the document.
 */
export function holdOf(
  def: HoldBearer | null | undefined,
  fields: EntryFields | null | undefined,
): string | null {
  if (!hasHold(def)) {
    return null;
  }
  /* SAFETY: an entry's fields are its parsed frontmatter or its JSON, which is what a query reads
     from the loader too. */
  return predicateOf(def)((fields ?? {}) as Parameters<HoldPredicate>[0]) ?? null;
}

/** What an entry's status reads: its rule's label, {@link NOT_HELD}, or "" with no rules. */
export function holdStatus(
  def: HoldBearer | null | undefined,
  fields: EntryFields | null | undefined,
): string {
  return hasHold(def) ? (holdOf(def, fields) ?? NOT_HELD) : "";
}

/** A rule an author can flip: one field, equal to `true`. */
export interface HoldSwitch {
  field: string;
  label: string;
}

/**
 * The switch a collection's rules offer, or null. A rule on one boolean field is a thing an author
 * can flip. A rule on a date or a list of values has no single other state to flip to, so it is
 * shown as a status and set by editing its field.
 */
export function holdSwitch(def: HoldBearer | null | undefined): HoldSwitch | null {
  for (const rule of rulesOf(def)) {
    if (isJsonObject(rule) && isString(rule.label) && isJsonObject(rule.when)) {
      const fields = Object.entries(rule.when);
      const [first] = fields;
      if (fields.length === 1 && first?.[1] === true) {
        return { field: first[0], label: rule.label };
      }
    }
  }
  return null;
}

/** The fields a collection's rules read, which is what a surface must repaint on. */
export function holdFields(def: HoldBearer | null | undefined): string[] {
  return rulesOf(def).flatMap((rule) =>
    isJsonObject(rule) && isJsonObject(rule.when) ? Object.keys(rule.when) : [],
  );
}

/** What being held means, in one sentence, for every surface that shows the state. */
export function holdMeaning(label: string | null): string {
  return label === null
    ? "No hold rule matches this entry, so a production build publishes it."
    : `Held: ${label}. A production build leaves it out; jx dev, the canvas and preview builds keep it.`;
}

// ─── The perspective ─────────────────────────────────────────────────────────

/** The perspective. `includeHeld` false, the default, hides entries a rule holds. */
export const holdView = reactive({ includeHeld: false });

/** Whether held entries are currently listed. */
export function includingHeld(): boolean {
  return holdView.includeHeld;
}

/**
 * Set the perspective.
 *
 * A setter, never a toggle: `content.setIncludeHeld` names the STATE it reaches, so a manifest
 * step, an assistant call and a checkbox all land on the same value however many times they run
 * (§13.5's idempotence rule, which `tests/app-commands.test.ts` enforces).
 *
 * Setting the flag is all this does. Repainting the lists that read it belongs to the command, in
 * `content/entry-commands.ts`, because a data module may not reach into the workspace.
 */
export function setIncludeHeld(include: boolean): void {
  holdView.includeHeld = include;
}

/**
 * Apply the perspective to a list.
 *
 * `includeHeld` true, or a collection with no rules, returns the input array unchanged (identity,
 * not a copy), so a caller can cheaply tell that nothing was filtered.
 */
export function applyHoldFilter<T>(
  items: readonly T[],
  def: HoldBearer | null | undefined,
  fieldsOf: (item: T) => EntryFields | null | undefined,
  includeHeld: boolean,
): readonly T[] {
  return includeHeld || !hasHold(def)
    ? items
    : items.filter((item) => holdOf(def, fieldsOf(item)) === null);
}
