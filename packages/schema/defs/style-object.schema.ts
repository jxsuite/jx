export const styleObjectSchema = {
  /* AnyOf, not oneOf, for the reason `propsObjectSchema` gives: a `{ $ref }` legitimately matches
     both branches. It is a reactive VALUE, and it is also — vacuously — a nested block holding one
     declaration named `$ref`, because a block admits a string under any key. Exclusive matching
     rejects it as ambiguous, which is what `oneOf` did the moment RefObject was added here. The
     ambiguity is harmless: the runtime reads an object carrying `$ref` as a value, and nothing
     else can. */
  additionalProperties: {
    anyOf: [
      { type: "string" },
      { type: "number" },
      { $ref: "#/$defs/RefObject" },
      { $ref: "#/$defs/StyleObject" },
    ],
  },
  description:
    "CSS style definition. camelCase property names follow CSSOM convention. " +
    "Keys starting with :, ., &, or [ are treated as nested CSS selectors. " +
    "Keys matching $media breakpoint names (or other @-prefixed at-rules) group nested rules. " +
    "Nesting is recursive: selector and at-rule groups may nest to arbitrary depth " +
    "(e.g. breakpoint → selector → pseudo-class), mirroring the compiler's recursive emission. " +
    "An object carrying $ref is a reactive VALUE, and the runtime reads it as one. It also " +
    "matches the nested-block branch vacuously, since a block admits a string under any key, " +
    "which is why these branches are anyOf rather than oneOf. " +
    "A DECLARATION at-rule (@font-face, @property, @position-try, @counter-style) may hold an " +
    "ARRAY of blocks, which is that key written more than once, in order: an object's keys are " +
    "unique, so @font-face — the at-rule whose identity is not in its key — could not otherwise " +
    "state a family's second weight at all.",
  patternProperties: {
    /*
     * A DECLARATION at-rule, and only one of those four, may hold several blocks.
     *
     * `additionalProperties` below admits no array, so this is the whole of it. The builder scopes
     * the form the same way (`blocksOf` in `packages/runtime/src/css.ts`), and the two must agree:
     * a schema that admitted an array under a selector would validate a document the builder
     * silently drops, which is the same trap `staticStyleObjectSchema` exists to avoid one level up.
     */
    "^@(font-face|property|position-try|counter-style)": {
      anyOf: [
        { $ref: "#/$defs/StyleObject" },
        { items: { $ref: "#/$defs/StyleObject" }, minItems: 1, type: "array" },
      ],
    },
  },
  properties: {},
  type: "object",
} as const;
