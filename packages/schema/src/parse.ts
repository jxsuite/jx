/**
 * Typed parse boundary for Jx documents and configs.
 *
 * Raw `JSON.parse()` returns `any`, which silently disables checking for everything downstream.
 * These helpers are the single sanctioned crossing point: they parse, structurally verify, and
 * return the domain type — failures carry the source path.
 *
 * Being the single crossing point is also what makes it the right place to enforce I-JSON (RFC
 * 7493). `JSON.parse` accepts documents that mean something other than what they say — a repeated
 * key whose first value it discards, an integer it rounds — and a Jx document does not stay JSON:
 * it round-trips through markdown frontmatter and a CRDT, each rebuilding the object from the
 * parsed value. Whatever was dropped here is dropped for good.
 *
 * It is also where identifiers are normalized (UAX #31 §R4), for the same reason: a name that means
 * one thing on one keyboard and another thing on another is a defect nothing downstream can see.
 */

import type { JsonObject, JsonValue, JxClassDef, JxDocument, ProjectConfig } from "../types";
import { isJsonObject, isString } from "./guards";
import { describeIJsonProblem, findIJsonProblems } from "./ijson";

// ─── Error helpers ──────────────────────────────────────────────────────────────

/** Extract a human-readable message from a caught `unknown`. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Coerce a caught `unknown` to an Error without losing the original. */
export function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

// ─── Unicode normalization ──────────────────────────────────────────────────────

/**
 * Text outside ASCII, which is the only text whose normalization form can differ. Testing for it
 * first keeps this walk close to free on the pure-ASCII documents that are almost all of them.
 */
const NON_ASCII = /[^\p{ASCII}]/u;

/**
 * Recursively put every key and every string value into Normalization Form C.
 *
 * **The defect this fixes.** A state name is an identifier: `"état"` declared in `state`,
 * referenced as `${state.état}` in a template and as `#/state/état` in a `$ref`. Typed on macOS it
 * arrives decomposed (`e` + U+0301); typed on Windows or pasted from most of the web it arrives
 * precomposed (U+00E9). Those are two different JavaScript property names, so a document whose
 * declaration and reference were typed on different machines builds cleanly, emits a valid bundle,
 * and renders nothing — `state.état` is simply `undefined`. There is no error to see and no symptom
 * to search for. UAX #31 §R4 exists for exactly this, and NFC is the form the web platform assumes
 * everywhere else.
 *
 * **Why values are normalized too, and why that is not a content change.** Two canonically
 * equivalent strings are, by the definition in UAX #15, the same text: a conforming renderer must
 * display them identically, and no process may distinguish them. So normalizing a `textContent` is
 * a no-op for meaning. It is also unavoidable, because Jx has no syntactic boundary between content
 * and code — `"Café ${state.été}"` is one string carrying both, and normalizing only "identifier
 * positions" would mean parsing every template to find them.
 *
 * **Why here and not on the source text.** `"état"` is pure ASCII until `JSON.parse` turns the
 * escape into a combining mark, so normalizing the raw text would miss exactly the documents a
 * generator wrote.
 *
 * @param {JsonValue} value - Any parsed JSON value
 * @returns {JsonValue} The same shape, with all text in NFC
 */
function normalizeIdentifiers(value: JsonValue): JsonValue {
  if (isString(value)) {
    return NON_ASCII.test(value) ? value.normalize("NFC") : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeIdentifiers(item));
  }
  if (isJsonObject(value)) {
    return normalizeObject(value);
  }
  return value;
}

/** {@link normalizeIdentifiers} for an object, keeping the object type for the parse helpers. */
function normalizeObject(value: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    /*
     * A later key wins on collision, matching what `JSON.parse` does with a literal duplicate.
     * It cannot happen through this boundary — I-JSON already rejected duplicate keys, and two
     * keys differing only by normalization form are not duplicates to `JSON.parse` — so this is
     * a statement about which is authoritative rather than a branch anything reaches.
     */
    out[NON_ASCII.test(key) ? key.normalize("NFC") : key] = normalizeIdentifiers(entry);
  }
  return out;
}

// ─── Parse helpers ──────────────────────────────────────────────────────────────

function parseObject(text: string, sourcePath: string, what: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse ${what} at ${sourcePath}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  if (!isJsonObject(parsed)) {
    throw new Error(`Invalid ${what} at ${sourcePath}: expected a JSON object`);
  }
  /*
   * An error rather than a warning, because both problems are silent data loss and neither has a
   * reading under which the author got what they wrote. The whole repository — 375 documents —
   * was already clean when this landed, so this rejects mistakes rather than existing work.
   */
  const problems = findIJsonProblems(text);
  if (problems.length > 0) {
    const described = problems.map((problem) => describeIJsonProblem(problem)).join("; ");
    throw new Error(`Invalid ${what} at ${sourcePath}: ${described}`);
  }
  return normalizeObject(parsed);
}

/** Parse a Jx document (.json page/layout/component source). */
export function parseJxDocument(text: string, sourcePath: string): JxDocument {
  /*
   * SAFETY: every JxDocument member is optional, so any JSON object is a structurally admissible
   * document. This boundary verifies the object shape and I-JSON only; member-level checking is the
   * schema's job (`validateDocument`), which callers run when they need it.
   */
  return parseObject(text, sourcePath, "Jx document") as JxDocument;
}

/** Parse a project.json site configuration. */
export function parseProjectConfig(text: string, sourcePath: string): ProjectConfig {
  /*
   * SAFETY: every ProjectConfig member is optional, so any JSON object is a structurally admissible
   * config; member-level checking is `validateProject`'s job against the per-project schema.
   */
  return parseObject(text, sourcePath, "project config") as ProjectConfig;
}

/**
 * Parse a .class.json schema-defined class. Note: `$prototype: "Class"` is the canonical
 * discriminator but is not required — existing class files omit it.
 */
export function parseClassDef(text: string, sourcePath: string): JxClassDef {
  /*
   * SAFETY: only the object shape is verified here. The type states the canonical form, and a class
   * file that omits `$prototype` (accepted on purpose, see above) is the one known deviation from it.
   */
  return parseObject(text, sourcePath, "class definition") as JxClassDef;
}
