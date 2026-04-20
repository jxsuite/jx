/**
 * jx-schema.js — Jx JSON Schema 2020-12 meta-schema generator
 * @version 1.0.0
 * @license MIT
 *
 * Generates a comprehensive JSON Schema 2020-12 document that validates Jx
 * source files. All HTML element names, CSS property names, and DOM event
 * handler names are derived at generation time from upstream web standards via:
 *
 *   webref/elements — HTML element tag names
 *   webref/css      — CSS property names (camelCase CSSOM)
 *   webref/idl      — DOM EventHandler attribute names
 *
 * Usage:
 *   import { generateSchema } from './schema.js';
 *   const schema = await generateSchema();
 *   fs.writeFileSync('schema.json', JSON.stringify(schema, null, 2));
 *
 * CLI:
 *   bun run schema.js [output-path]
 *
 * @module jx-schema
 */

import { listAll as listElements } from "@webref/elements";
import css from "@webref/css";
import idl from "@webref/idl";

// ─── Built-in $prototype values (Jx-specific, not from web standards) ─────

const BUILT_IN_PROTOTYPES = [
  "Function",
  "Request",
  "URLSearchParams",
  "FormData",
  "LocalStorage",
  "SessionStorage",
  "Cookie",
  "IndexedDB",
  "Array",
  "Set",
  "Map",
  "Blob",
  "ReadableStream",
];

// ─── Web standards data loader ────────────────────────────────────────────────

/**
 * Fetch and normalise the three webref datasets in parallel.
 *
 * @returns {Promise<{ tagExamples: string[]; cssProps: string[]; eventHandlers: string[] }>}
 */
async function loadWebData() {
  const [elementsData, cssData, idlData] = await Promise.all([
    listElements(),
    css.listAll(),
    idl.parseAll(),
  ]);

  // ── Tag names ──────────────────────────────────────────────────────────────
  const tagSet = new Set();
  for (const { elements } of Object.values(elementsData)) {
    for (const el of elements) {
      if (!el.obsolete) tagSet.add(el.name);
    }
  }
  const tagExamples = [...tagSet].sort();

  // ── CSS camelCase property names (CSSOM styleDeclaration) ─────────────────
  const cssSet = new Set();
  for (const prop of cssData.properties) {
    for (const decl of prop.styleDeclaration ?? []) {
      cssSet.add(decl);
    }
  }
  const cssProps = [...cssSet].sort();

  // ── EventHandler attribute names from IDL ─────────────────────────────────
  const handlerSet = new Set();
  for (const ast of Object.values(idlData)) {
    for (const def of ast) {
      if (def.type !== "interface" && def.type !== "interface mixin") continue;
      for (const member of def.members) {
        if (
          member.type === "attribute" &&
          member.name?.startsWith("on") &&
          typeof member.idlType?.idlType === "string" &&
          member.idlType.idlType === "EventHandler"
        ) {
          handlerSet.add(member.name);
        }
      }
    }
  }
  const eventHandlers = [...handlerSet].sort();

  return { tagExamples, cssProps, eventHandlers };
}

// ─── Generator ────────────────────────────────────────────────────────────────

/**
 * Generate the full Jx meta-schema as a plain JavaScript object. Derives HTML elements, CSS
 * properties, and event handlers from upstream web standards data at generation time.
 *
 * @returns {Promise<object>} JSON Schema 2020-12 document
 */
export async function generateSchema() {
  const { tagExamples, cssProps, eventHandlers } = await loadWebData();

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://jxplatform.net/schema/v1",
    title: "Jx Document",
    description:
      "Schema for Jx component files. " +
      "A Jx document is a JSON object that declaratively describes a reactive " +
      "web component: its structure (DOM tree), styling, type definitions ($defs), " +
      "runtime state, and inline or external functions. Reactivity is powered by @vue/reactivity.",
    type: "object",
    required: ["tagName"],

    // ── Top-level properties ────────────────────────────────────────────────
    properties: {
      $schema: {
        description: "URI identifying the Jx dialect version. Enables schema-aware IDE tooling.",
        type: "string",
        examples: ["https://jxplatform.net/schema/v1"],
      },
      $id: {
        description: "Component identifier string. Used by tooling and the builder.",
        type: "string",
        examples: ["Counter", "TodoApp", "UserCard"],
      },
      $defs: {
        description:
          "Pure JSON Schema type definitions for this component. " +
          "All entries are reusable type schemas — no runtime artifacts are produced. " +
          "Referenced from state entries via $ref. Naming convention: PascalCase.",
        $ref: "#/$defs/DefsMap",
      },
      state: {
        description:
          "Runtime variables for this component. All entries are reactive by default. " +
          "Entry shape is determined by value type: " +
          "scalar/array → reactive property, string with ${} → computed, " +
          "object with $prototype → function or data source, " +
          "object with type and default → typed reactive property.",
        $ref: "#/$defs/StateMap",
      },
      $media: {
        description:
          "Named media breakpoints following CSS @custom-media convention. " +
          "Keys use the CSS custom property -- prefix.",
        type: "object",
        additionalProperties: { type: "string" },
        examples: [
          {
            "--sm": "(min-width: 640px)",
            "--md": "(min-width: 768px)",
            "--dark": "(prefers-color-scheme: dark)",
          },
        ],
      },
      tagName: { $ref: "#/$defs/TagName" },
      children: { $ref: "#/$defs/ChildrenValue" },
      style: { $ref: "#/$defs/StyleObject" },
      attributes: { $ref: "#/$defs/AttributesObject" },
    },
    additionalProperties: { $ref: "#/$defs/ElementPropertyValue" },

    // ── Reusable sub-schemas ────────────────────────────────────────────────
    $defs: {
      // ── $defs map (type definitions only) ────────────────────────────────
      DefsMap: {
        description:
          "Map of reusable JSON Schema type definitions. " +
          "Keys are PascalCase type names. No runtime artifacts are produced.",
        type: "object",
        additionalProperties: { $ref: "#/$defs/TypeDefEntry" },
      },

      TypeDefEntry: {
        description:
          "A $defs type definition entry. Must be a pure JSON Schema type " +
          "definition or a class definition (.class.json format).",
        oneOf: [{ $ref: "#/$defs/PureTypeDef" }, { $ref: "#/$defs/ClassDef" }],
      },

      // ── state map (runtime variables) ───────────────────────────────────
      StateMap: {
        description:
          "Map of runtime variables. Keys are camelCase (public) or #-prefixed (private). " +
          "All entries are reactive by default.",
        type: "object",
        additionalProperties: { $ref: "#/$defs/StateEntry" },
      },

      StateEntry: {
        description:
          "A single state entry. Shape is determined by value type: " +
          "scalar/array → naked reactive property, string with ${} → computed, " +
          'object with $prototype: "Function" → function, ' +
          "object with $prototype: <other> → data source, " +
          "object with type and default → typed reactive property, " +
          "plain object → naked object reactive property.",
        oneOf: [
          // Shape 1: Naked value (scalar)
          { type: "number" },
          { type: "boolean" },
          { type: "null" },
          { type: "string" },
          { type: "array" },
          // Shape 2: Typed value (object with type and default, no $prototype)
          { $ref: "#/$defs/TypedStateDef" },
          // Shape 3: Function ($prototype: "Function")
          { $ref: "#/$defs/FunctionDef" },
          // Shape 4: External class / data source ($prototype: <other>)
          { $ref: "#/$defs/ExternalClassDef" },
          // Shape 1: Naked object (plain object, no reserved keys)
          {
            type: "object",
            not: {
              anyOf: [
                { required: ["$prototype"] },
                { required: ["default"] },
                { required: ["type"] },
              ],
            },
          },
        ],
      },

      // ── Shape 2: Typed State Variable ──────────────────────────────────
      TypedStateDef: {
        description:
          "A typed reactive state variable with explicit type and default value. " +
          "The type property is a JSON Schema or $ref to a $defs type definition. " +
          "The default property is the initial runtime value.",
        type: "object",
        required: ["default"],
        properties: {
          default: { description: "Initial state value." },
          type: {
            description:
              "JSON Schema type definition, $ref to a $defs type, or JSON Schema type string.",
            oneOf: [{ type: "string" }, { type: "object" }],
          },
          description: { type: "string" },
          attribute: {
            description: "Linked HTML attribute name for CEM extraction.",
            type: "string",
          },
          reflects: {
            description: "Whether property changes reflect back to the HTML attribute.",
            type: "boolean",
          },
          deprecated: {
            description: "Deprecation notice for CEM extraction.",
            oneOf: [{ type: "boolean" }, { type: "string" }],
          },
          examples: { type: "array" },
          $ref: { description: "Reference to a shared type definition.", type: "string" },
        },
        not: { required: ["$prototype"] },
      },

      // ── Shape 2b: Pure Type Definition ───────────────────────────────────
      PureTypeDef: {
        description:
          "A reusable JSON Schema type definition for tooling only. " +
          "No function, no runtime artifact. " +
          "Referenced from state entries via $ref. " +
          "Naming convention: PascalCase.",
        type: "object",
        required: ["type"],
        properties: {
          type: { $ref: "#/$defs/JsonSchemaType" },
          description: { type: "string" },
          enum: { type: "array" },
          minimum: { type: "number" },
          maximum: { type: "number" },
          minLength: { type: "integer", minimum: 0 },
          maxLength: { type: "integer", minimum: 0 },
          pattern: { type: "string" },
          items: {},
          properties: { type: "object" },
          required: { type: "array", items: { type: "string" } },
          examples: { type: "array" },
        },
        not: {
          anyOf: [{ required: ["default"] }, { required: ["$prototype"] }],
        },
      },

      // ── Shape 4: Function ────────────────────────────────────────────────
      FunctionDef: {
        description:
          'A function declaration. $prototype must be "Function". ' +
          "body (inline) and $src (external) are mutually exclusive. " +
          "First parameter is always state (the reactive scope).",
        type: "object",
        required: ["$prototype"],
        properties: {
          $prototype: { type: "string", const: "Function" },
          body: {
            description: "Inline function body string. First implicit parameter is state.",
            type: "string",
            examples: [
              "state.count++",
              'state.items.push({ id: Date.now(), text: "", done: false })',
              'return state.score >= 90 ? "gold" : "silver"',
            ],
          },
          parameters: {
            description:
              "Function parameters (after the implicit state parameter). " +
              "Accepts CEM-compatible parameter objects or bare string names for backward compatibility.",
            type: "array",
            items: {
              oneOf: [{ type: "string" }, { $ref: "#/$defs/CemParameter" }],
            },
            examples: [
              ["event"],
              [{ name: "event", type: { text: "Event" } }],
              [{ name: "id", type: { text: "number" }, description: "Item identifier" }],
            ],
          },
          name: {
            description: "Explicit function name. Defaults to the state key name.",
            type: "string",
          },
          $src: {
            description: "External module specifier. Mutually exclusive with body.",
            type: "string",
            examples: ["./counter.js", "npm:@myorg/validators"],
          },
          $export: {
            description: "Named export in $src module. Defaults to the state key name.",
            type: "string",
          },
          type: {
            description: "Return type for tooling (JSON Schema or CEM { text } format).",
          },
          emits: {
            description:
              "Array of CEM-compatible Event objects this function dispatches. " +
              "Used for CEM extraction and studio event discovery.",
            type: "array",
            items: { $ref: "#/$defs/CemEvent" },
          },
          description: { type: "string" },
        },
        additionalProperties: false,
      },

      // ── Shape 6: Class Definition ($prototype: "Class") ────────────────
      ClassDef: {
        description:
          'A .class.json schema-defined class. $prototype must be "Class". ' +
          "Defines fields, constructor, methods, and type parameters via $defs. " +
          "Optionally points to a JS module via $implementation for hybrid execution.",
        type: "object",
        required: ["$prototype", "title"],
        properties: {
          $schema: { type: "string" },
          $id: { type: "string" },
          $prototype: { type: "string", const: "Class" },
          title: {
            description: "PascalCase class name, used as the export name.",
            type: "string",
          },
          description: { type: "string" },
          extends: {
            description: "Base class — string name or $ref to another .class.json.",
            oneOf: [
              { type: "string" },
              { type: "object", required: ["$ref"], properties: { $ref: { type: "string" } } },
            ],
          },
          $implementation: {
            description: "Relative path to a JS module containing the actual class implementation.",
            type: "string",
          },
          $defs: {
            description: "Class members: parameters, returnTypes, fields, constructor, methods.",
            type: "object",
            properties: {
              parameters: {
                description: "Reusable typed parameter schemas, keyed by name.",
                type: "object",
                additionalProperties: { $ref: "#/$defs/ClassParameterDef" },
              },
              returnTypes: {
                description: "Output type schemas, keyed by name.",
                type: "object",
                additionalProperties: { type: "object" },
              },
              fields: {
                description: "Class fields with role, access, scope, and type information.",
                type: "object",
                additionalProperties: { $ref: "#/$defs/ClassFieldDef" },
              },
              constructor: { $ref: "#/$defs/ClassConstructorDef" },
              methods: {
                description: "Class methods and accessors.",
                type: "object",
                additionalProperties: { $ref: "#/$defs/ClassMethodDef" },
              },
            },
          },
        },
        additionalProperties: false,
      },

      ClassParameterDef: {
        description: "A typed parameter definition for a class.",
        type: "object",
        properties: {
          identifier: { type: "string" },
          type: {},
          format: {
            description: 'When "json-schema", this parameter\'s value is itself a JSON Schema.',
            type: "string",
          },
          description: { type: "string" },
          default: {},
          examples: { type: "array" },
        },
      },

      ClassFieldDef: {
        description: "A class field definition with access control and scope.",
        type: "object",
        properties: {
          role: { type: "string", const: "field" },
          access: { type: "string", enum: ["public", "private", "protected"] },
          scope: { type: "string", enum: ["instance", "static"] },
          identifier: { type: "string" },
          type: {},
          $prototype: {
            description: 'Data source prototype for this field (e.g., "Request").',
            type: "string",
          },
          initializer: {},
          default: {},
          description: { type: "string" },
          examples: { type: "array" },
        },
      },

      ClassConstructorDef: {
        description: "Class constructor definition.",
        type: "object",
        properties: {
          role: { type: "string", const: "constructor" },
          $prototype: { type: "string", const: "Function" },
          parameters: {
            type: "array",
            items: {
              oneOf: [
                { type: "object", required: ["$ref"], properties: { $ref: { type: "string" } } },
                { $ref: "#/$defs/ClassParameterDef" },
              ],
            },
          },
          superCall: {
            type: "object",
            properties: {
              arguments: { type: "array", items: { type: "string" } },
            },
          },
          body: {
            oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          },
        },
      },

      ClassMethodDef: {
        description: "A class method or accessor definition.",
        type: "object",
        properties: {
          role: { type: "string", enum: ["method", "accessor"] },
          $prototype: { type: "string", const: "Function" },
          access: { type: "string", enum: ["public", "private", "protected"] },
          scope: { type: "string", enum: ["instance", "static"] },
          identifier: { type: "string" },
          parameters: {
            type: "array",
            items: {
              oneOf: [
                { type: "object", required: ["$ref"], properties: { $ref: { type: "string" } } },
                { $ref: "#/$defs/ClassParameterDef" },
              ],
            },
          },
          returnType: {},
          body: {
            oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          },
          getter: {
            type: "object",
            properties: { body: { type: "string" } },
          },
          setter: {
            type: "object",
            properties: {
              parameters: { type: "array" },
              body: { type: "string" },
            },
          },
          description: { type: "string" },
        },
      },

      // ── Shape 5: External Class ──────────────────────────────────────────
      ExternalClassDef: {
        description:
          'An external class / data source. $prototype is a constructor name (not "Function"). ' +
          "When $prototype is not in the built-in registry, $src is required. " +
          "All state entries are reactive by default.",
        type: "object",
        required: ["$prototype"],
        properties: {
          $prototype: {
            description: "Constructor name — built-in Web API class or external class name.",
            type: "string",
            not: { const: "Function" },
            examples: [
              ...BUILT_IN_PROTOTYPES.filter((p) => p !== "Function"),
              "MarkdownCollection",
              "MyParser",
            ],
          },
          $src: {
            description: "External module specifier. Required when $prototype is not a built-in.",
            type: "string",
            examples: ["@jxplatform/md", "./lib/my-parser.js", "npm:@myorg/data"],
          },
          $export: {
            description: "Named export in $src module. Defaults to the $prototype value.",
            type: "string",
          },
          timing: { type: "string", enum: ["compiler", "server", "client"] },
          manual: { type: "boolean" },
          debounce: { type: "integer", minimum: 0 },
          url: { $ref: "#/$defs/StringOrRef" },
          method: {
            type: "string",
            enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
          },
          headers: { type: "object", additionalProperties: { type: "string" } },
          body: {},
          responseType: {
            type: "string",
            enum: ["json", "text", "blob", "arraybuffer", "document", ""],
          },
          key: { type: "string" },
          name: { type: "string" },
          maxAge: { type: "integer" },
          expires: { type: "string" },
          path: { type: "string" },
          domain: { type: "string" },
          secure: { type: "boolean" },
          sameSite: { type: "string", enum: ["strict", "lax", "none"] },
          database: { type: "string" },
          store: { type: "string" },
          version: { type: "integer", minimum: 1 },
          keyPath: { type: "string" },
          autoIncrement: { type: "boolean" },
          indexes: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "keyPath"],
              properties: {
                name: { type: "string" },
                keyPath: {
                  oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
                },
                unique: { type: "boolean" },
              },
            },
          },
          default: {},
          description: { type: "string" },
          items: {},
          map: { $ref: "#/$defs/ElementDef" },
          filter: { $ref: "#/$defs/RefObject" },
          sort: { $ref: "#/$defs/RefObject" },
          src: {
            description: "Configuration property passed to external class constructor.",
            type: "string",
          },
        },
      },

      // ── Element definition ────────────────────────────────────────────────
      ElementDef: {
        description: "A Jx element definition. Maps directly to a DOM element.",
        type: "object",
        required: ["tagName"],
        properties: {
          tagName: { $ref: "#/$defs/TagName" },
          id: { type: "string" },
          className: { $ref: "#/$defs/StringOrRef" },
          textContent: { $ref: "#/$defs/StringOrRef" },
          innerHTML: { $ref: "#/$defs/StringOrRef" },
          innerText: { $ref: "#/$defs/StringOrRef" },
          hidden: { $ref: "#/$defs/BoolOrRef" },
          tabIndex: { $ref: "#/$defs/NumberOrRef" },
          title: { $ref: "#/$defs/StringOrRef" },
          lang: { $ref: "#/$defs/StringOrRef" },
          dir: { type: "string", enum: ["ltr", "rtl", "auto"] },
          value: { $ref: "#/$defs/StringOrRef" },
          checked: { $ref: "#/$defs/BoolOrRef" },
          disabled: { $ref: "#/$defs/BoolOrRef" },
          selected: { $ref: "#/$defs/BoolOrRef" },
          src: { $ref: "#/$defs/StringOrRef" },
          href: { $ref: "#/$defs/StringOrRef" },
          alt: { $ref: "#/$defs/StringOrRef" },
          type: { $ref: "#/$defs/StringOrRef" },
          name: { $ref: "#/$defs/StringOrRef" },
          placeholder: { $ref: "#/$defs/StringOrRef" },
          children: { $ref: "#/$defs/ChildrenValue" },
          style: { $ref: "#/$defs/StyleObject" },
          attributes: { $ref: "#/$defs/AttributesObject" },
          $switch: { $ref: "#/$defs/SwitchDef" },
          $ref: { $ref: "#/$defs/ExternalRef" },
          $props: { $ref: "#/$defs/PropsObject" },
          "$map/item": { $ref: "#/$defs/RefObject" },
          "$map/index": { $ref: "#/$defs/RefObject" },
          // Event handlers (derived from @webref/idl at generation time)
          ...buildEventHandlerProperties(eventHandlers),
        },
        additionalProperties: { $ref: "#/$defs/ElementPropertyValue" },
      },

      // ── Children ─────────────────────────────────────────────────────────
      ChildrenValue: {
        description: "Static array of child definitions, or an Array namespace for dynamic lists.",
        oneOf: [
          {
            type: "array",
            items: {
              oneOf: [{ $ref: "#/$defs/ElementDef" }, { type: "string" }, { type: "number" }],
            },
          },
          { $ref: "#/$defs/ArrayNamespace" },
        ],
      },

      ArrayNamespace: {
        description: "Dynamic mapped list. Re-renders when the items state entry changes.",
        type: "object",
        required: ["$prototype", "items", "map"],
        properties: {
          $prototype: { type: "string", const: "Array" },
          items: {
            oneOf: [{ $ref: "#/$defs/RefObject" }, { type: "array" }],
          },
          map: { $ref: "#/$defs/ElementDef" },
          filter: { $ref: "#/$defs/RefObject" },
          sort: { $ref: "#/$defs/RefObject" },
        },
        additionalProperties: false,
      },

      // ── $switch ───────────────────────────────────────────────────────────
      SwitchDef: {
        description: "Reactive $ref that drives which case to render.",
        type: "object",
        required: ["$ref"],
        properties: { $ref: { $ref: "#/$defs/InternalRef" } },
        additionalProperties: false,
      },

      SwitchNode: {
        type: "object",
        required: ["$switch", "cases"],
        properties: {
          tagName: { $ref: "#/$defs/TagName" },
          $switch: { $ref: "#/$defs/SwitchDef" },
          cases: {
            type: "object",
            additionalProperties: {
              oneOf: [{ $ref: "#/$defs/ElementDef" }, { $ref: "#/$defs/ExternalComponentRef" }],
            },
          },
        },
      },

      // ── Style (CSS properties derived from @webref/css) ───────────────────
      StyleObject: {
        description:
          "CSS style definition. camelCase property names follow CSSOM convention. " +
          "Keys starting with :, ., &, or [ are treated as nested CSS selectors. " +
          "Keys matching $media breakpoint names are treated as responsive rules.",
        type: "object",
        // Known camelCase CSS properties give IDE autocompletion
        properties: buildCssProperties(cssProps),
        // Nested selectors, media breakpoints, and custom / unknown properties
        additionalProperties: {
          oneOf: [
            { type: "string" },
            { type: "number" },
            {
              description: "Nested CSS selector or media breakpoint rules.",
              type: "object",
              additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }] },
            },
          ],
        },
      },

      AttributesObject: {
        description: "HTML attributes and ARIA attributes set via element.setAttribute().",
        type: "object",
        additionalProperties: {
          oneOf: [
            { type: "string" },
            { type: "number" },
            { type: "boolean" },
            { $ref: "#/$defs/RefObject" },
          ],
        },
      },

      PropsObject: {
        description: "Explicit prop passing at a component boundary.",
        type: "object",
        additionalProperties: {
          oneOf: [
            { type: "string" },
            { type: "number" },
            { type: "boolean" },
            { type: "array" },
            { type: "object" },
            { $ref: "#/$defs/RefObject" },
          ],
        },
      },

      // ── $ref types ────────────────────────────────────────────────────────
      RefObject: {
        description:
          "A $ref binding. Resolves to a state entry (reactive) or plain value (static).",
        type: "object",
        required: ["$ref"],
        properties: { $ref: { $ref: "#/$defs/AnyRef" } },
        additionalProperties: false,
      },

      AnyRef: {
        type: "string",
        oneOf: [
          { $ref: "#/$defs/InternalRef" },
          { $ref: "#/$defs/StateRef" },
          { $ref: "#/$defs/ExternalRef" },
          { $ref: "#/$defs/GlobalRef" },
          { $ref: "#/$defs/ParentRef" },
          { $ref: "#/$defs/MapRef" },
        ],
      },

      InternalRef: {
        description: "Reference to a $defs type definition in the current component.",
        type: "string",
        pattern: "^#/\\$defs/",
        examples: ["#/$defs/Count", "#/$defs/TodoItem", "#/$defs/Status"],
      },

      StateRef: {
        description: "Reference to a state entry (runtime variable) in the current component.",
        type: "string",
        pattern: "^#/state/",
        examples: ["#/state/count", "#/state/addTask", "#/state/items"],
      },

      ExternalRef: {
        description: "Reference to an external Jx component file.",
        type: "string",
        pattern: "^(\\./|\\.\\./).*\\.json$|^https?://",
        examples: ["./card.json", "https://cdn.example.com/button.json"],
      },

      ExternalComponentRef: {
        type: "object",
        required: ["$ref"],
        properties: {
          $ref: { $ref: "#/$defs/ExternalRef" },
          $props: { $ref: "#/$defs/PropsObject" },
        },
      },

      GlobalRef: {
        description: "Reference to a window or document global.",
        type: "string",
        pattern: "^(window|document)#/",
        examples: ["window#/currentUser", "document#/appConfig"],
      },

      ParentRef: {
        description: "Reference to a named state entry passed via $props from a parent component.",
        type: "string",
        pattern: "^parent#/",
        examples: ["parent#/sharedState", "parent#/theme"],
      },

      MapRef: {
        description: "Reference to the current Array map iteration context.",
        type: "string",
        pattern: "^\\$map/(item|index)(/.*)?$",
        examples: ["$map/item", "$map/index", "$map/item/text", "$map/item/done"],
      },

      // ── Property value types ──────────────────────────────────────────────
      ElementPropertyValue: {
        oneOf: [
          { type: "string" },
          { type: "number" },
          { type: "boolean" },
          { type: "null" },
          { $ref: "#/$defs/RefObject" },
        ],
      },

      StringOrRef: {
        oneOf: [{ type: "string" }, { $ref: "#/$defs/RefObject" }],
      },

      BoolOrRef: {
        oneOf: [{ type: "boolean" }, { $ref: "#/$defs/RefObject" }],
      },

      NumberOrRef: {
        oneOf: [{ type: "number" }, { $ref: "#/$defs/RefObject" }],
      },

      // ── CEM-compatible definitions ────────────────────────────────────────
      CemParameter: {
        description:
          "A CEM-compatible parameter definition for a function. " +
          "Follows the Custom Elements Manifest Parameter shape.",
        type: "object",
        required: ["name"],
        properties: {
          name: { description: "Parameter name.", type: "string" },
          type: { description: "Parameter type (JSON Schema or CEM { text } format)." },
          description: { description: "Parameter documentation.", type: "string" },
          optional: { description: "Whether the parameter is optional.", type: "boolean" },
          default: { description: "Default value for the parameter." },
        },
      },

      CemEvent: {
        description:
          "A CEM-compatible event definition. " +
          "Describes a CustomEvent the function dispatches.",
        type: "object",
        required: ["name"],
        properties: {
          name: { description: "Event name (e.g. 'task-toggled').", type: "string" },
          type: { description: "Event type (e.g. { text: 'CustomEvent' })." },
          description: { description: "Event documentation.", type: "string" },
          deprecated: {
            description: "Deprecation notice.",
            oneOf: [{ type: "boolean" }, { type: "string" }],
          },
        },
      },

      // ── Primitives ────────────────────────────────────────────────────────
      TagName: {
        description:
          "HTML element tag name or custom element name (must contain a hyphen per Web Components spec).",
        type: "string",
        minLength: 1,
        // Examples derived from @webref/elements at generation time
        examples: [...tagExamples, "my-counter", "todo-app", "user-card"],
      },

      JsonSchemaType: {
        type: "string",
        enum: ["string", "number", "integer", "boolean", "array", "object", "null"],
      },
    },
  };
}

// ─── Schema building helpers ──────────────────────────────────────────────────

/**
 * Build the event handler `properties` fragment for ElementDef. Each key maps to a RefObject
 * pointing at a declared handler function. Derived from @webref/idl EventHandler attributes at
 * generation time.
 *
 * @param {string[]} eventHandlers
 * @returns {object}
 */
function buildEventHandlerProperties(eventHandlers) {
  /** @type {Record<string, any>} */
  const properties = {};
  for (const name of eventHandlers) {
    properties[name] = {
      description: `Event handler for the "${name.slice(2)}" event.`,
      $ref: "#/$defs/RefObject",
    };
  }
  return properties;
}

/**
 * Build the explicit CSS `properties` fragment for StyleObject. Each key is a camelCase CSSOM
 * property name; the value schema accepts strings and numbers (CSS values are always coerced to
 * strings at runtime). Derived from @webref/css styleDeclaration names at generation time.
 *
 * @param {string[]} cssProps
 * @returns {object}
 */
function buildCssProperties(cssProps) {
  /** @type {Record<string, any>} */
  const properties = {};
  for (const name of cssProps) {
    properties[name] = { oneOf: [{ type: "string" }, { type: "number" }] };
  }
  return properties;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return the meta-schema as a formatted JSON string.
 *
 * @returns {Promise<string>}
 */
export async function generateSchemaString() {
  return JSON.stringify(await generateSchema(), null, 2);
}

/**
 * Validate a Jx document against the generated schema using Ajv.
 *
 * @param {object} doc
 * @returns {Promise<{ valid: boolean; errors: object[] | null }>}
 */
export async function validateDocument(doc) {
  let Ajv, addFormats;
  try {
    // @ts-ignore — optional peer dependency
    ({ default: Ajv } = await import("ajv"));
    // @ts-ignore — optional peer dependency
    ({ default: addFormats } = await import("ajv-formats"));
  } catch {
    throw new Error("Schema validation requires ajv and ajv-formats: bun add ajv ajv-formats");
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const schema = await generateSchema();
  const validate = ajv.compile(schema);
  const valid = validate(doc);

  return { valid, errors: validate.errors ?? null };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith("schema.js")) {
  const [, , out] = process.argv;
  const schemaStr = await generateSchemaString();

  if (out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(out, schemaStr, "utf8");
    console.error(`Jx meta-schema written to ${out}`);
  } else {
    process.stdout.write(schemaStr + "\n");
  }
}
