/**
 * Command-args.ts — loud coercion for the arguments a command record declares.
 *
 * Every scriptable command carries an `args` JSON Schema (studio.md §13.1): the palette prompts
 * from it, the AI tool's parameters are it, and `scripts/check-shot-contract.ts` validates every
 * manifest step against it in the `checks` job. This module is the RUNTIME half of that same
 * declaration, twice over: the typed readers a `run` body calls (`stringArg(...)` and its family),
 * and {@link coerceArgs}, which `registry.run` applies to the received record BEFORE `run` for
 * every caller — the palette, `__jxAutomation`, the assistant and a chord alike. The coercion
 * dispatches each declared property to the reader its shape names, so a caller reads the same
 * refusal sentence whether the schema or the `run` body caught it: they are the same functions
 * reading the same values, and cannot disagree.
 *
 * Two rules, and they are the reason this is a module rather than twelve copies of `String(x)`:
 *
 * 1. **Reject loudly, never clamp.** An unknown panel id, a mode the tab cannot enter, a selection
 *    path that is not in the document — each throws. A no-op would photograph the previous state
 *    and a docs build would accept it; a clamp would photograph a state the caller did not ask for.
 *    The shot contract (`scripts/screenshots/README.md`, `steps`) makes this a tested property.
 * 2. **The failure names the fix.** `{@link enumArg}` prints the declared values, which is what makes
 *    the screenshot gate's headline failure (`scripts/screenshots/README.md`, "The gate") —
 *    _manifest shot "properties-bar" names panel "head"; the registry declares "page"_ — a sentence
 *    a reader can act on rather than a stack trace. Nothing else in this file matters as much as
 *    that message.
 *
 * `RangeError` (not a bespoke class) because `services/profile.ts` already throws it for exactly
 * this — an id outside a declared set — and one refusal shape is easier to catch than two.
 */

/** Arguments as they arrive from a palette prompt, a manifest step or an AI tool call. */
export type CommandArgValues = Record<string, unknown>;

/** `command "<id>" argument "<key>": <problem>` — the one sentence shape every failure here uses. */
function refuse(commandId: string, key: string, problem: string): RangeError {
  return new RangeError(`command "${commandId}" argument "${key}": ${problem}`);
}

/** How a received value is quoted back to the caller. Strings keep their quotes; nothing is elided. */
function describe(value: unknown): string {
  if (value === undefined) {
    return "missing";
  }
  return typeof value === "string" ? `"${value}"` : `${typeof value} ${JSON.stringify(value)}`;
}

/** A required string argument. */
export function stringArg(commandId: string, args: CommandArgValues, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value === "") {
    throw refuse(commandId, key, `expected a non-empty string, got ${describe(value)}`);
  }
  return value;
}

/** An optional string argument — `undefined` when absent, never coerced from another type. */
export function optionalStringArg(
  commandId: string,
  args: CommandArgValues,
  key: string,
): string | undefined {
  if (args[key] === undefined) {
    return undefined;
  }
  return stringArg(commandId, args, key);
}

/** A required finite number argument. `NaN` and `Infinity` are refusals, not values. */
export function numberArg(commandId: string, args: CommandArgValues, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw refuse(commandId, key, `expected a finite number, got ${describe(value)}`);
  }
  return value;
}

/**
 * A required integer argument. `1.5` is a refusal, not a value to round: a caller naming an index
 * or a count with a fraction in it has said something the app cannot mean.
 *
 * Its own reader rather than `numberArg` plus a check in `run`, because `coerceArgs` routes a bare
 * `type: "integer"` here — without it the row read as a plain number and `1.5` passed the schema
 * pass to fail, or not, in whatever `run` did with it. `typedArg` already held a type LIST to
 * integrality; this is the same rule for the bare form.
 */
export function integerArg(commandId: string, args: CommandArgValues, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw refuse(commandId, key, `expected an integer, got ${describe(value)}`);
  }
  return value;
}

/**
 * A required number argument inside a closed interval.
 *
 * REJECTS out of range rather than clamping, which is the difference between a shot that fails and
 * a shot that photographs 500% when it asked for 1000% — the second is a wrong picture the docs
 * build accepts. The interactive controls still clamp: dragging a slider past its end is a gesture
 * with an obvious meaning, whereas a caller naming a number outside the range is stating something
 * untrue about the app.
 */
export function boundedNumberArg(
  commandId: string,
  args: CommandArgValues,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const value = numberArg(commandId, args, key);
  if (value < minimum || value > maximum) {
    throw refuse(commandId, key, `${value} is outside the supported range ${minimum}–${maximum}`);
  }
  return value;
}

/** A required boolean argument. A setter's whole point is that `false` is a value, so no default. */
export function booleanArg(commandId: string, args: CommandArgValues, key: string): boolean {
  const value = args[key];
  if (typeof value !== "boolean") {
    throw refuse(commandId, key, `expected a boolean, got ${describe(value)}`);
  }
  return value;
}

/**
 * A required argument drawn from a declared set.
 *
 * The `declared:` clause is the point — see the module header. It is printed in full rather than
 * truncated: these sets are panel ids and tab ids, never long enough to be a wall, and a reader
 * comparing a stale id against the current list needs the whole list.
 */
export function enumArg<T extends string>(
  commandId: string,
  args: CommandArgValues,
  key: string,
  declared: readonly T[],
): T {
  const value = args[key];
  if (typeof value !== "string" || !(declared as readonly string[]).includes(value)) {
    // `none` for an empty set: a derived enum (`derivedEnumProperty`) is honestly empty before the
    // Project supplies its values, and "declared: " with nothing after it reads as a truncation.
    throw refuse(
      commandId,
      key,
      `${describe(value)} is not declared — declared: ${declared.join(", ") || "none"}`,
    );
  }
  return value as T;
}

/**
 * A document path (`JxPath`) argument: an array of strings and numbers.
 *
 * The empty array is the document root and therefore VALID — `selection.set { path: [] }` is how a
 * shot selects the root element, and treating `[]` as "no path" would silently deselect instead.
 */
export function pathArg(
  commandId: string,
  args: CommandArgValues,
  key: string,
): (string | number)[] {
  const value = args[key];
  if (
    !Array.isArray(value) ||
    !value.every((s) => typeof s === "string" || typeof s === "number")
  ) {
    throw refuse(
      commandId,
      key,
      `expected an array of path segments (strings or numbers), got ${describe(value)}`,
    );
  }
  return value as (string | number)[];
}

/** A path argument that may be `null` — "select nothing" is a state a user can be in. */
export function nullablePathArg(
  commandId: string,
  args: CommandArgValues,
  key: string,
): (string | number)[] | null {
  if (args[key] === null) {
    return null;
  }
  return pathArg(commandId, args, key);
}

/**
 * A LIST of document paths — the whole selection set (§6.7).
 *
 * Every element is validated as a path, so a caller that passes one bare path by mistake
 * (`["children", 0]` rather than `[["children", 0]]`) is refused by name instead of selecting two
 * nodes called "children" and "0". `[]` is legal and means "select nothing", which is the same
 * thing `selection.set { path: null }` means.
 */
export function pathListArg(
  commandId: string,
  args: CommandArgValues,
  key: string,
): (string | number)[][] {
  const value = args[key];
  if (!Array.isArray(value)) {
    throw refuse(commandId, key, `expected an array of document paths, got ${describe(value)}`);
  }
  return value.map((entry, i) => {
    if (
      !Array.isArray(entry) ||
      !entry.every((s) => typeof s === "string" || typeof s === "number")
    ) {
      throw refuse(
        commandId,
        key,
        `entry ${i} is not a document path — expected an array of segments, got ${describe(entry)}`,
      );
    }
    return entry as (string | number)[];
  });
}

// ─── Schema fragments ─────────────────────────────────────────────────────────
// The readers above are what a `run` body calls; these are the same facts in the form the palette
// Prompt, the AI tool's parameter list and the shot-contract check read. The pair used to be kept
// Adjacent so a reviewer could see that a schema agreed with its coercion; `coerceArgs` below made
// Them ONE call site, so a schema that disagrees with its coercion is now a refusal rather than a
// Defect a reviewer has to spot — which is what this module exists to prevent.

/** `{ type: "object", properties, required, additionalProperties: false }` in one call. */
export function argsSchema(
  properties: Record<string, object>,
  required: readonly string[] = Object.keys(properties),
): object {
  return {
    additionalProperties: false,
    properties,
    required: [...required],
    type: "object",
  };
}

/** A string property constrained to a declared set, with the human sentence the palette shows. */
export function enumProperty(declared: readonly string[], description: string): object {
  return { description, enum: [...declared], type: "string" };
}

/**
 * An enum property whose values are derived WHEN THE SCHEMA IS READ, not when the record is
 * defined.
 *
 * `enumProperty(collections(), …)` looks identical and is wrong for anything a PROJECT supplies,
 * and the difference is invisible in a unit test: a command record is built at module scope —
 * `commands/app-commands.ts` and `studio.ts` both build theirs before a project is open — so the
 * array freezes at `[]`, and `panels/quick-search.ts`'s `paletteArgs` offers an empty choice list
 * forever after. `run` re-derives the list, which is why the programmatic call works and the
 * palette does not: two answers to "what is there", one of them a snapshot of the empty boot
 * state.
 *
 * A getter is the whole fix — the palette reads `property.enum` when it opens the prompt, the AI
 * tool's parameters serialise it when the tool list is built, and `scripts/check-shot-contract.ts`
 * reads it in a bare Bun process where the honest answer really is "none declared".
 */
export function derivedEnumProperty(
  declared: () => readonly string[],
  description: string,
): object {
  return {
    description,
    get enum() {
      return [...declared()];
    },
    type: "string",
  };
}

/** A number property, optionally bounded — the bounds a control already enforces, written down. */
export function numberProperty(
  description: string,
  bounds: { minimum?: number; maximum?: number } = {},
): object {
  return { description, type: "number", ...bounds };
}

/** A boolean property. Named `open`/`enabled`/… by the caller; the description carries the sense. */
export function booleanProperty(description: string): object {
  return { description, type: "boolean" };
}

/** A `JxPath` property — an array of string keys and numeric indexes. */
export function pathProperty(description: string, nullable = false): object {
  const path = {
    items: { type: ["string", "number"] },
    type: "array",
  };
  return nullable ? { description, oneOf: [path, { type: "null" }] } : { description, ...path };
}

/** A property holding a LIST of `JxPath`s — an array of arrays of segments. */
export function pathListProperty(description: string): object {
  return {
    description,
    items: { items: { type: ["string", "number"] }, type: "array" },
    type: "array",
  };
}

/** A free-form string property. */
export function stringProperty(description: string): object {
  return { description, type: "string" };
}

// ─── Schema-driven coercion ───────────────────────────────────────────────────
// `registry.run` applies a record's `args` schema to the received values before `run`, for every
// Caller. Each property is handed to the reader its SHAPE names, so the sentence a caller reads is
// The one the `run` body would have produced — the readers are the same functions, not a second
// Validator that agrees with them today. What the schema cannot say (a breakpoint the document
// Defines, a path that addresses a node) stays in `run`; the schema owns the shape.

/** The JSON Schema keywords a command property uses. Read loosely; unknown keywords are ignored. */
interface PropertySchema {
  type?: string | readonly string[];
  enum?: readonly unknown[];
  const?: unknown;
  oneOf?: readonly PropertySchema[];
  items?: PropertySchema;
  minimum?: number;
  maximum?: number;
}

/** The object schema `argsSchema` writes, as {@link coerceArgs} reads it. */
interface ArgsSchemaShape {
  properties?: Record<string, PropertySchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

/**
 * The rows of {@link coerceArgs}'s dispatch table, by name.
 *
 * Exported so a test can assert which row every shipped property lands in — `pass-through` is the
 * row for a shape no reader exists for, and the sweep in `tests/command-args.test.ts` asserts no
 * record in `appCommandSet()` reaches it. A property that would is a schema nothing coerces, which
 * is the disagreement this section exists to close.
 */
export type CoercionRow =
  | "enum"
  | "const"
  | "one-of"
  | "typed"
  | "boolean"
  | "bounded-number"
  | "number"
  | "integer"
  | "string"
  | "path"
  | "path-list"
  | "pass-through";

/** Whether an `items.type` list is `JxPath`'s `["string", "number"]`, in either order. */
function isPathSegmentTypes(types: readonly string[]): boolean {
  return types.length === 2 && types.includes("string") && types.includes("number");
}

/** A single JSON type name, or the list form `["number", "null"]`, as a list. */
function typesOf(type: string | readonly string[]): readonly string[] {
  return Array.isArray(type) ? type : [type as string];
}

/**
 * Which reader a property's shape names.
 *
 * `"enum" in property`, not `property.enum`: a `derivedEnumProperty` carries its values behind a
 * getter, and this function only classifies. The getter is read by the `enum` row when the value is
 * coerced, which is what makes the list live at that moment rather than at classification.
 */
export function describeShape(property: object): CoercionRow {
  const p = property as PropertySchema;
  if ("enum" in p) {
    return "enum";
  }
  if ("const" in p) {
    return "const";
  }
  if (Array.isArray(p.oneOf)) {
    return "one-of";
  }
  if (Array.isArray(p.type)) {
    return "typed";
  }
  switch (p.type) {
    case "boolean": {
      return "boolean";
    }
    case "number":
    case "integer": {
      // Both bounds, as `numberProperty` writes them. A half-open interval is not a shape any
      // Record declares, so it reads as a plain number and `run` owns the bound. A bounded integer
      // Is the `bounded-number` row too, which holds it to integrality before the interval; only
      // The BARE integer goes to `integerArg`, whose whole rule is integrality.
      if (p.minimum !== undefined && p.maximum !== undefined) {
        return "bounded-number";
      }
      return p.type === "integer" ? "integer" : "number";
    }
    case "string": {
      return "string";
    }
    case "array": {
      const items = p.items?.type;
      // The `path` row is the `JxPath` shape `pathProperty` writes — segments that are strings or
      // Numbers, exactly — not any array whose items carry a type list. `pathArg` refuses a null
      // Segment, so `items: { type: ["string", "null"] }` would be read by the wrong reader; it
      // Lands in `pass-through` instead, where the sweep names it.
      if (Array.isArray(items)) {
        return isPathSegmentTypes(items) ? "path" : "pass-through";
      }
      return items === "array" ? "path-list" : "pass-through";
    }
    case "null":
    case "object": {
      return "typed";
    }
    default: {
      break;
    }
  }
  // No `type` at all (a description alone), or one no reader exists for: the sweep names it.
  return "pass-through";
}

/** Whether a value is of one JSON type. `number` means FINITE, as {@link numberArg} already insists. */
function isJsonType(type: string, value: unknown): boolean {
  switch (type) {
    case "null": {
      return value === null;
    }
    case "boolean": {
      return typeof value === "boolean";
    }
    case "string": {
      return typeof value === "string";
    }
    case "number": {
      return typeof value === "number" && Number.isFinite(value);
    }
    case "integer": {
      return typeof value === "number" && Number.isInteger(value);
    }
    case "array": {
      return Array.isArray(value);
    }
    case "object": {
      return typeof value === "object" && value !== null && !Array.isArray(value);
    }
    default: {
      break;
    }
  }
  // A type name JSON Schema does not define admits nothing, and the sentence prints it back.
  return false;
}

/** `number or null`, `string, number, boolean, array, object or null` — a type list as prose. */
function listTypes(types: readonly string[]): string {
  if (types.length <= 1) {
    return types.join("");
  }
  return `${types.slice(0, -1).join(", ")} or ${types.at(-1)}`;
}

/**
 * A required argument admitted by JSON-type membership — the `type: ["number", "null"]` shape.
 *
 * `null` is admitted only when listed, which is the whole difference from a reader that treats it
 * as "absent": `canvas.setEditWidth { width: null }` MEANS "back to the breakpoint's width", and
 * `canvas.setTestProp { value: null }` means "clear it". Nothing is coerced between types.
 */
export function typedArg(
  commandId: string,
  args: CommandArgValues,
  key: string,
  types: readonly string[],
): unknown {
  const value = args[key];
  if (!types.some((type) => isJsonType(type, value))) {
    throw refuse(commandId, key, `expected ${listTypes(types)}, got ${describe(value)}`);
  }
  return value;
}

/** One line per row, for the sentence a `oneOf` refusal prints when no branch admits the value. */
function shapeOf(property: PropertySchema): string {
  switch (describeShape(property)) {
    case "enum": {
      return `one of ${(property.enum ?? []).map((v) => describe(v)).join(" | ")}`;
    }
    case "const": {
      return `the constant ${describe(property.const)}`;
    }
    case "one-of": {
      return (property.oneOf ?? []).map((branch) => shapeOf(branch)).join(" or ");
    }
    case "typed": {
      return listTypes(typesOf(property.type ?? []));
    }
    case "boolean": {
      return "a boolean";
    }
    case "bounded-number": {
      return `a number from ${property.minimum} to ${property.maximum}`;
    }
    case "number": {
      return "a finite number";
    }
    case "integer": {
      return "an integer";
    }
    case "string": {
      return "a non-empty string";
    }
    case "path": {
      return "a document path";
    }
    case "path-list": {
      return "a list of document paths";
    }
    default: {
      // The pass-through row. A branch with NO shape admits every value, so this is composed only
      // For a shaped branch no reader exists for — an array of strings, say — whose pre-check
      // Skipped it without a refusal of its own to print.
      return "anything";
    }
  }
}

/**
 * A required argument matching one of several shapes — `canvas.setFit`'s word-or-number,
 * `selection.set`'s path-or-null.
 *
 * A branch is TRIED only when it admits the value's JSON type, so the refusal a caller reads is
 * that branch's own: `canvas.setFit { fit: 10 }` reads {@link boundedNumberArg}'s range sentence,
 * `style.setSelector { selector: "" }` reads {@link stringArg}'s, exactly as the `run` bodies
 * printed them. Only a value no branch could take is answered with the list of shapes.
 */
function oneOfArg(
  commandId: string,
  args: CommandArgValues,
  key: string,
  branches: readonly PropertySchema[],
): unknown {
  const value = args[key];
  const refusals: unknown[] = [];
  for (const branch of branches) {
    if (
      branch.type !== undefined &&
      !typesOf(branch.type).some((type) => isJsonType(type, value))
    ) {
      continue;
    }
    try {
      return coerceProperty(commandId, args, key, branch);
    } catch (error) {
      refusals.push(error);
    }
  }
  if (refusals.length === 1) {
    throw refusals[0];
  }
  throw refuse(
    commandId,
    key,
    `expected ${branches.map((branch) => shapeOf(branch)).join(" or ")}, got ${describe(value)}`,
  );
}

/** One property through the reader its row names. The value comes back as the reader returns it. */
function coerceProperty(
  commandId: string,
  args: CommandArgValues,
  key: string,
  property: PropertySchema,
): unknown {
  switch (describeShape(property)) {
    case "enum": {
      // The read of `property.enum` is HERE — a derived list is resolved at coercion time.
      return enumArg(commandId, args, key, (property.enum ?? []) as readonly string[]);
    }
    case "const": {
      const value = args[key];
      if (value !== property.const) {
        throw refuse(
          commandId,
          key,
          `expected the constant ${describe(property.const)}, got ${describe(value)}`,
        );
      }
      return value;
    }
    case "one-of": {
      return oneOfArg(commandId, args, key, property.oneOf ?? []);
    }
    case "typed": {
      return typedArg(commandId, args, key, typesOf(property.type ?? []));
    }
    case "boolean": {
      return booleanArg(commandId, args, key);
    }
    case "bounded-number": {
      // Integrality first, so `{ type: "integer", minimum: 1, maximum: 9 }` refuses `1.5` by name
      // Rather than admitting it as a number inside the interval — the static check's `type` row
      // Already refused it, and the two passes must agree.
      if (property.type === "integer") {
        integerArg(commandId, args, key);
      }
      return boundedNumberArg(commandId, args, key, property.minimum!, property.maximum!);
    }
    case "number": {
      return numberArg(commandId, args, key);
    }
    case "integer": {
      return integerArg(commandId, args, key);
    }
    case "string": {
      return stringArg(commandId, args, key);
    }
    case "path": {
      return pathArg(commandId, args, key);
    }
    case "path-list": {
      return pathListArg(commandId, args, key);
    }
    default: {
      // `pass-through`: a shape no reader exists for. The sweep in `tests/command-args.test.ts`
      // Asserts no shipped record reaches it, so this is a hand-built schema being handed on.
      return args[key];
    }
  }
}

/**
 * Apply a declared `args` schema to received values: every property to the reader its shape names.
 *
 * The rules, in the order they are applied:
 *
 * - A key the schema does not declare is refused when `additionalProperties` is `false` (every record
 *   `argsSchema` writes), and the sentence lists what IS declared — the same family as
 *   {@link enumArg}'s, because a misspelt key and a misspelt value are the same mistake.
 * - A declared key that is absent is skipped when it is not `required`, and handed to its reader when
 *   it is: the reader already says `missing`.
 * - A present value goes through its row. An explicit `undefined` counts as absent — JSON cannot
 *   carry one, and every reader above already treats it so.
 *
 * Returns a fresh record with the same present keys, each holding what its reader returned. The
 * `run` body keeps its own `stringArg(...)` lines as typed readers and can never disagree with this
 * pass, because they are the same functions reading the same values.
 */
export function coerceArgs(
  commandId: string,
  schema: object,
  args: CommandArgValues,
): CommandArgValues {
  const spec = schema as ArgsSchemaShape;
  const properties = spec.properties ?? {};
  const declared = Object.keys(properties);
  const required = spec.required ?? [];
  const coerced: CommandArgValues = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || Object.hasOwn(properties, key)) {
      continue;
    }
    if (spec.additionalProperties === false) {
      throw refuse(commandId, key, `not declared — declared: ${declared.join(", ") || "none"}`);
    }
    coerced[key] = value;
  }
  for (const key of declared) {
    if (args[key] === undefined && !required.includes(key)) {
      continue;
    }
    coerced[key] = coerceProperty(commandId, args, key, properties[key]!);
  }
  return coerced;
}
