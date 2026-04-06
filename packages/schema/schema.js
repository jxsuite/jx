/**
 * jsonsx-schema.js — JSONsx JSON Schema 2020-12 meta-schema generator
 * @version 1.0.0
 * @license MIT
 *
 * Generates a comprehensive JSON Schema 2020-12 document that validates JSONsx
 * source files. All HTML element names, CSS property names, and DOM event
 * handler names are derived at generation time from upstream web standards via:
 *
 *   @webref/elements — HTML element tag names
 *   @webref/css      — CSS property names (camelCase CSSOM)
 *   @webref/idl      — DOM EventHandler attribute names
 *
 * Usage:
 *   import { generateSchema } from './schema.js';
 *   const schema = await generateSchema();
 *   fs.writeFileSync('schema.json', JSON.stringify(schema, null, 2));
 *
 * CLI:
 *   bun run schema.js [output-path]
 *
 * @module jsonsx-schema
 */

import { listAll as listElements } from '@webref/elements';
import css                         from '@webref/css';
import idl                         from '@webref/idl';

// ─── Built-in $prototype values (JSONsx-specific, not from web standards) ─────

const BUILT_IN_PROTOTYPES = [
  'Function',
  'Request', 'URLSearchParams', 'FormData',
  'LocalStorage', 'SessionStorage', 'Cookie',
  'IndexedDB', 'Array', 'Set', 'Map',
  'Blob', 'ReadableStream',
];

// ─── Web standards data loader ────────────────────────────────────────────────

/**
 * Fetch and normalise the three webref datasets in parallel.
 *
 * @returns {Promise<{ tagExamples: string[], cssProps: string[], eventHandlers: string[] }>}
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
    for (const decl of (prop.styleDeclaration ?? [])) {
      cssSet.add(decl);
    }
  }
  const cssProps = [...cssSet].sort();

  // ── EventHandler attribute names from IDL ─────────────────────────────────
  const handlerSet = new Set();
  for (const ast of Object.values(idlData)) {
    for (const def of ast) {
      if (def.type !== 'interface' && def.type !== 'interface mixin') continue;
      for (const member of def.members) {
        if (
          member.type === 'attribute' &&
          member.name?.startsWith('on') &&
          typeof member.idlType?.idlType === 'string' &&
          member.idlType.idlType === 'EventHandler'
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
 * Generate the full JSONsx meta-schema as a plain JavaScript object.
 * Derives HTML elements, CSS properties, and event handlers from upstream
 * web standards data at generation time.
 *
 * @returns {Promise<object>} JSON Schema 2020-12 document
 */
export async function generateSchema() {
  const { tagExamples, cssProps, eventHandlers } = await loadWebData();

  return {
    '$schema': 'https://json-schema.org/draft/2020-12/schema',
    '$id':     'https://jsonsx.dev/schema/v1',
    'title':   'JSONsx Document',
    'description':
      'Schema for JSONsx component files. ' +
      'A JSONsx document is a JSON object that declaratively describes a reactive ' +
      'web component: its structure (DOM tree), styling, reactive state ($defs), ' +
      'and inline or external functions. Reactivity is powered by @vue/reactivity.',
    'type':     'object',
    'required': ['tagName'],

    // ── Top-level properties ────────────────────────────────────────────────
    'properties': {
      '$schema': {
        'description': 'URI identifying the JSONsx dialect version. Enables schema-aware IDE tooling.',
        'type': 'string',
        'examples': ['https://jsonsx.dev/schema/v1'],
      },
      '$id': {
        'description': 'Component identifier string. Used by tooling and the builder.',
        'type': 'string',
        'examples': ['Counter', 'TodoApp', 'UserCard'],
      },
      '$defs': {
        'description':
          'Signal, function, type, and data source declarations for this component. ' +
          'All entries use plain camelCase names (no $ prefix). ' +
          'Entry shape is determined by value type and reserved keywords.',
        '$ref': '#/$defs/DefsMap',
      },
      '$media': {
        'description':
          'Named media breakpoints following CSS @custom-media convention. ' +
          'Keys use the CSS custom property -- prefix.',
        'type': 'object',
        'additionalProperties': { 'type': 'string' },
        'examples': [{ '--sm': '(min-width: 640px)', '--md': '(min-width: 768px)', '--dark': '(prefers-color-scheme: dark)' }],
      },
      'tagName':    { '$ref': '#/$defs/TagName' },
      'children':   { '$ref': '#/$defs/ChildrenValue' },
      'style':      { '$ref': '#/$defs/StyleObject' },
      'attributes': { '$ref': '#/$defs/AttributesObject' },
    },
    'additionalProperties': { '$ref': '#/$defs/ElementPropertyValue' },

    // ── Reusable sub-schemas ────────────────────────────────────────────────
    '$defs': {

      // ── $defs map ──────────────────────────────────────────────────────────
      'DefsMap': {
        'description':
          'Map of signal, computed, function, type definition, and data source declarations. ' +
          'Keys are plain camelCase (signals, functions) or PascalCase (type definitions).',
        'type': 'object',
        'additionalProperties': { '$ref': '#/$defs/DefEntry' },
      },

      'DefEntry': {
        'description':
          'A single $defs entry. Shape is determined by value type: ' +
          'scalar/array → naked signal, string with ${} → computed, ' +
          'object with $prototype: "Function" → function, ' +
          'object with $prototype: <other> → external class, ' +
          'object with default → expanded signal, ' +
          'object with schema keywords only → pure type definition, ' +
          'plain object → naked object signal.',
        'oneOf': [
          // Shape 1: Naked value signal (scalar)
          { 'type': 'number' },
          { 'type': 'boolean' },
          { 'type': 'null' },
          { 'type': 'string' },
          { 'type': 'array' },
          // Shape 2: Expanded signal (object with default, no $prototype)
          { '$ref': '#/$defs/ExpandedSignalDef' },
          // Shape 2b: Pure type definition (schema keywords only)
          { '$ref': '#/$defs/PureTypeDef' },
          // Shape 4: Function ($prototype: "Function")
          { '$ref': '#/$defs/FunctionDef' },
          // Shape 5: External class ($prototype: <other>)
          { '$ref': '#/$defs/ExternalClassDef' },
          // Shape 1: Naked object signal (plain object, no reserved keys)
          {
            'type': 'object',
            'not': {
              'anyOf': [
                { 'required': ['$prototype'] },
                { 'required': ['default'] },
                { 'required': ['type'] },
                { 'required': ['properties'] },
                { 'required': ['items'] },
                { 'required': ['enum'] },
              ],
            },
          },
        ],
      },

      // ── Shape 2: Expanded Signal ─────────────────────────────────────────
      'ExpandedSignalDef': {
        'description':
          'A reactive state signal with JSON Schema type annotations. ' +
          'The default keyword is the required discriminator — its value is the initial state. ' +
          'signal: true must not be declared — it is implied by default.',
        'type': 'object',
        'required': ['default'],
        'properties': {
          'default':     { 'description': 'Initial signal value.' },
          'type':        { '$ref': '#/$defs/JsonSchemaType' },
          'description': { 'type': 'string' },
          'enum':        { 'type': 'array' },
          'minimum':     { 'type': 'number' },
          'maximum':     { 'type': 'number' },
          'minLength':   { 'type': 'integer', 'minimum': 0 },
          'maxLength':   { 'type': 'integer', 'minimum': 0 },
          'pattern':     { 'type': 'string' },
          'items':       {},
          'properties':  { 'type': 'object' },
          'required':    { 'type': 'array', 'items': { 'type': 'string' } },
          'examples':    { 'type': 'array' },
          '$ref':        { 'description': 'Reference to a shared type definition.', 'type': 'string' },
        },
        'not': { 'required': ['$prototype'] },
      },

      // ── Shape 2b: Pure Type Definition ───────────────────────────────────
      'PureTypeDef': {
        'description':
          'A reusable JSON Schema type definition for tooling only. ' +
          'No signal, no function, no runtime artifact. ' +
          'Referenced by other $defs entries via $ref. ' +
          'Naming convention: PascalCase.',
        'type': 'object',
        'required': ['type'],
        'properties': {
          'type':        { '$ref': '#/$defs/JsonSchemaType' },
          'description': { 'type': 'string' },
          'enum':        { 'type': 'array' },
          'minimum':     { 'type': 'number' },
          'maximum':     { 'type': 'number' },
          'minLength':   { 'type': 'integer', 'minimum': 0 },
          'maxLength':   { 'type': 'integer', 'minimum': 0 },
          'pattern':     { 'type': 'string' },
          'items':       {},
          'properties':  { 'type': 'object' },
          'required':    { 'type': 'array', 'items': { 'type': 'string' } },
          'examples':    { 'type': 'array' },
        },
        'not': {
          'anyOf': [
            { 'required': ['default'] },
            { 'required': ['$prototype'] },
          ],
        },
      },

      // ── Shape 4: Function ────────────────────────────────────────────────
      'FunctionDef': {
        'description':
          'A function declaration. $prototype must be "Function". ' +
          'body (inline) and $src (external) are mutually exclusive. ' +
          'When signal: true, wraps in computed(). ' +
          'First parameter is always $defs (the reactive scope).',
        'type': 'object',
        'required': ['$prototype'],
        'properties': {
          '$prototype': { 'type': 'string', 'const': 'Function' },
          'body': {
            'description': 'Inline function body string. First implicit parameter is $defs.',
            'type': 'string',
            'examples': [
              '$defs.count++',
              '$defs.items.push({ id: Date.now(), text: "", done: false })',
              'return $defs.score >= 90 ? "gold" : "silver"',
            ],
          },
          'arguments': {
            'description': 'Additional parameter names after $defs.',
            'type': 'array',
            'items': { 'type': 'string' },
            'examples': [['event'], ['id'], ['event', 'index']],
          },
          'name': {
            'description': 'Explicit function name. Defaults to the $defs key name.',
            'type': 'string',
          },
          '$src': {
            'description': 'External module specifier. Mutually exclusive with body.',
            'type': 'string',
            'examples': ['./counter.js', 'npm:@myorg/validators'],
          },
          '$export': {
            'description': 'Named export in $src module. Defaults to the $defs key name.',
            'type': 'string',
          },
          'signal': {
            'description': 'When true, wraps the function in computed() — making it a reactive computed signal.',
            'type': 'boolean',
          },
          'description': { 'type': 'string' },
        },
        'additionalProperties': false,
      },

      // ── Shape 5: External Class ──────────────────────────────────────────
      'ExternalClassDef': {
        'description':
          'An external class / data source. $prototype is a constructor name (not "Function"). ' +
          'When $prototype is not in the built-in registry, $src is required. ' +
          'When signal: true, the resolved value is wrapped in ref().',
        'type': 'object',
        'required': ['$prototype'],
        'properties': {
          '$prototype': {
            'description': 'Constructor name — built-in Web API class or external class name.',
            'type': 'string',
            'not': { 'const': 'Function' },
            'examples': [...BUILT_IN_PROTOTYPES.filter(p => p !== 'Function'), 'MarkdownCollection', 'MyParser'],
          },
          '$src': {
            'description': 'External module specifier. Required when $prototype is not a built-in.',
            'type': 'string',
            'examples': ['@jsonsx/md', './lib/my-parser.js', 'npm:@myorg/data'],
          },
          '$export': {
            'description': 'Named export in $src module. Defaults to the $prototype value.',
            'type': 'string',
          },
          'signal':       { 'type': 'boolean' },
          'timing':       { 'type': 'string', 'enum': ['compiler', 'server', 'client'] },
          'manual':       { 'type': 'boolean' },
          'debounce':     { 'type': 'integer', 'minimum': 0 },
          'url':          { '$ref': '#/$defs/StringOrRef' },
          'method':       { 'type': 'string', 'enum': ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] },
          'headers':      { 'type': 'object', 'additionalProperties': { 'type': 'string' } },
          'body':         {},
          'responseType': { 'type': 'string', 'enum': ['json', 'text', 'blob', 'arraybuffer', 'document', ''] },
          'key':          { 'type': 'string' },
          'name':         { 'type': 'string' },
          'maxAge':       { 'type': 'integer' },
          'expires':      { 'type': 'string' },
          'path':         { 'type': 'string' },
          'domain':       { 'type': 'string' },
          'secure':       { 'type': 'boolean' },
          'sameSite':     { 'type': 'string', 'enum': ['strict', 'lax', 'none'] },
          'database':     { 'type': 'string' },
          'store':        { 'type': 'string' },
          'version':      { 'type': 'integer', 'minimum': 1 },
          'keyPath':      { 'type': 'string' },
          'autoIncrement': { 'type': 'boolean' },
          'indexes': {
            'type': 'array',
            'items': {
              'type': 'object',
              'required': ['name', 'keyPath'],
              'properties': {
                'name':    { 'type': 'string' },
                'keyPath': { 'oneOf': [{ 'type': 'string' }, { 'type': 'array', 'items': { 'type': 'string' } }] },
                'unique':  { 'type': 'boolean' },
              },
            },
          },
          'default':     {},
          'description': { 'type': 'string' },
          'items':       {},
          'map':         { '$ref': '#/$defs/ElementDef' },
          'filter':      { '$ref': '#/$defs/RefObject' },
          'sort':        { '$ref': '#/$defs/RefObject' },
          'src':         { 'description': 'Configuration property passed to external class constructor.', 'type': 'string' },
        },
      },

      // ── Element definition ────────────────────────────────────────────────
      'ElementDef': {
        'description': 'A JSONsx element definition. Maps directly to a DOM element.',
        'type': 'object',
        'required': ['tagName'],
        'properties': {
          'tagName':     { '$ref': '#/$defs/TagName' },
          'id':          { 'type': 'string' },
          'className':   { '$ref': '#/$defs/StringOrRef' },
          'textContent': { '$ref': '#/$defs/StringOrRef' },
          'innerHTML':   { '$ref': '#/$defs/StringOrRef' },
          'innerText':   { '$ref': '#/$defs/StringOrRef' },
          'hidden':      { '$ref': '#/$defs/BoolOrRef' },
          'tabIndex':    { '$ref': '#/$defs/NumberOrRef' },
          'title':       { '$ref': '#/$defs/StringOrRef' },
          'lang':        { '$ref': '#/$defs/StringOrRef' },
          'dir':         { 'type': 'string', 'enum': ['ltr', 'rtl', 'auto'] },
          'value':       { '$ref': '#/$defs/StringOrRef' },
          'checked':     { '$ref': '#/$defs/BoolOrRef' },
          'disabled':    { '$ref': '#/$defs/BoolOrRef' },
          'selected':    { '$ref': '#/$defs/BoolOrRef' },
          'src':         { '$ref': '#/$defs/StringOrRef' },
          'href':        { '$ref': '#/$defs/StringOrRef' },
          'alt':         { '$ref': '#/$defs/StringOrRef' },
          'type':        { '$ref': '#/$defs/StringOrRef' },
          'name':        { '$ref': '#/$defs/StringOrRef' },
          'placeholder': { '$ref': '#/$defs/StringOrRef' },
          'children':    { '$ref': '#/$defs/ChildrenValue' },
          'style':       { '$ref': '#/$defs/StyleObject' },
          'attributes':  { '$ref': '#/$defs/AttributesObject' },
          '$switch':     { '$ref': '#/$defs/SwitchDef' },
          '$ref':        { '$ref': '#/$defs/ExternalRef' },
          '$props':      { '$ref': '#/$defs/PropsObject' },
          '$map/item':   { '$ref': '#/$defs/RefObject' },
          '$map/index':  { '$ref': '#/$defs/RefObject' },
          // Event handlers (derived from @webref/idl at generation time)
          ...buildEventHandlerProperties(eventHandlers),
        },
        'additionalProperties': { '$ref': '#/$defs/ElementPropertyValue' },
      },

      // ── Children ─────────────────────────────────────────────────────────
      'ChildrenValue': {
        'description': 'Static array of child definitions, or an Array namespace for dynamic lists.',
        'oneOf': [
          { 'type': 'array', 'items': { '$ref': '#/$defs/ElementDef' } },
          { '$ref': '#/$defs/ArrayNamespace' },
        ],
      },

      'ArrayNamespace': {
        'description': 'Dynamic mapped list. Re-renders when the items signal changes.',
        'type': 'object',
        'required': ['$prototype', 'items', 'map'],
        'properties': {
          '$prototype': { 'type': 'string', 'const': 'Array' },
          'items': {
            'oneOf': [
              { '$ref': '#/$defs/RefObject' },
              { 'type': 'array' },
            ],
          },
          'map':    { '$ref': '#/$defs/ElementDef' },
          'filter': { '$ref': '#/$defs/RefObject' },
          'sort':   { '$ref': '#/$defs/RefObject' },
        },
        'additionalProperties': false,
      },

      // ── $switch ───────────────────────────────────────────────────────────
      'SwitchDef': {
        'description': 'Signal-driven $ref that drives which case to render.',
        'type': 'object',
        'required': ['$ref'],
        'properties': { '$ref': { '$ref': '#/$defs/InternalRef' } },
        'additionalProperties': false,
      },

      'SwitchNode': {
        'type': 'object',
        'required': ['$switch', 'cases'],
        'properties': {
          'tagName': { '$ref': '#/$defs/TagName' },
          '$switch': { '$ref': '#/$defs/SwitchDef' },
          'cases': {
            'type': 'object',
            'additionalProperties': {
              'oneOf': [
                { '$ref': '#/$defs/ElementDef' },
                { '$ref': '#/$defs/ExternalComponentRef' },
              ],
            },
          },
        },
      },

      // ── Style (CSS properties derived from @webref/css) ───────────────────
      'StyleObject': {
        'description':
          'CSS style definition. camelCase property names follow CSSOM convention. ' +
          'Keys starting with :, ., &, or [ are treated as nested CSS selectors. ' +
          'Keys matching $media breakpoint names are treated as responsive rules.',
        'type': 'object',
        // Known camelCase CSS properties give IDE autocompletion
        'properties': buildCssProperties(cssProps),
        // Nested selectors, media breakpoints, and custom / unknown properties
        'additionalProperties': {
          'oneOf': [
            { 'type': 'string' },
            { 'type': 'number' },
            {
              'description': 'Nested CSS selector or media breakpoint rules.',
              'type': 'object',
              'additionalProperties': { 'oneOf': [{ 'type': 'string' }, { 'type': 'number' }] },
            },
          ],
        },
      },

      'AttributesObject': {
        'description': 'HTML attributes and ARIA attributes set via element.setAttribute().',
        'type': 'object',
        'additionalProperties': {
          'oneOf': [
            { 'type': 'string' },
            { 'type': 'number' },
            { 'type': 'boolean' },
            { '$ref': '#/$defs/RefObject' },
          ],
        },
      },

      'PropsObject': {
        'description': 'Explicit prop passing at a component boundary.',
        'type': 'object',
        'additionalProperties': {
          'oneOf': [
            { 'type': 'string' },
            { 'type': 'number' },
            { 'type': 'boolean' },
            { 'type': 'array' },
            { 'type': 'object' },
            { '$ref': '#/$defs/RefObject' },
          ],
        },
      },

      // ── $ref types ────────────────────────────────────────────────────────
      'RefObject': {
        'description': 'A $ref binding. Resolves to a signal (reactive) or plain value (static).',
        'type': 'object',
        'required': ['$ref'],
        'properties': { '$ref': { '$ref': '#/$defs/AnyRef' } },
        'additionalProperties': false,
      },

      'AnyRef': {
        'type': 'string',
        'oneOf': [
          { '$ref': '#/$defs/InternalRef' },
          { '$ref': '#/$defs/ExternalRef' },
          { '$ref': '#/$defs/GlobalRef' },
          { '$ref': '#/$defs/ParentRef' },
          { '$ref': '#/$defs/MapRef' },
        ],
      },

      'InternalRef': {
        'description': 'Reference to a $defs entry in the current component.',
        'type': 'string',
        'pattern': '^#/\\$defs/',
        'examples': ['#/$defs/count', '#/$defs/increment', '#/$defs/items'],
      },

      'ExternalRef': {
        'description': 'Reference to an external JSONsx component file.',
        'type': 'string',
        'pattern': '^(\\./|\\.\\./).*\\.json$|^https?://',
        'examples': ['./card.json', 'https://cdn.example.com/button.json'],
      },

      'ExternalComponentRef': {
        'type': 'object',
        'required': ['$ref'],
        'properties': {
          '$ref':   { '$ref': '#/$defs/ExternalRef' },
          '$props': { '$ref': '#/$defs/PropsObject' },
        },
      },

      'GlobalRef': {
        'description': 'Reference to a window or document global.',
        'type': 'string',
        'pattern': '^(window|document)#/',
        'examples': ['window#/currentUser', 'document#/appConfig'],
      },

      'ParentRef': {
        'description': 'Reference to a named signal passed via $props from a parent component.',
        'type': 'string',
        'pattern': '^parent#/',
        'examples': ['parent#/sharedState', 'parent#/theme'],
      },

      'MapRef': {
        'description': 'Reference to the current Array map iteration context.',
        'type': 'string',
        'pattern': '^\\$map/(item|index)(/.*)?$',
        'examples': ['$map/item', '$map/index', '$map/item/text', '$map/item/done'],
      },

      // ── Property value types ──────────────────────────────────────────────
      'ElementPropertyValue': {
        'oneOf': [
          { 'type': 'string' },
          { 'type': 'number' },
          { 'type': 'boolean' },
          { 'type': 'null' },
          { '$ref': '#/$defs/RefObject' },
        ],
      },

      'StringOrRef': {
        'oneOf': [{ 'type': 'string' }, { '$ref': '#/$defs/RefObject' }],
      },

      'BoolOrRef': {
        'oneOf': [{ 'type': 'boolean' }, { '$ref': '#/$defs/RefObject' }],
      },

      'NumberOrRef': {
        'oneOf': [{ 'type': 'number' }, { '$ref': '#/$defs/RefObject' }],
      },

      // ── Primitives ────────────────────────────────────────────────────────
      'TagName': {
        'description':
          'HTML element tag name or custom element name (must contain a hyphen per Web Components spec).',
        'type': 'string',
        'minLength': 1,
        // Examples derived from @webref/elements at generation time
        'examples': [...tagExamples, 'my-counter', 'todo-app', 'user-card'],
      },

      'JsonSchemaType': {
        'type': 'string',
        'enum': ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'],
      },
    },
  };
}

// ─── Schema building helpers ──────────────────────────────────────────────────

/**
 * Build the event handler `properties` fragment for ElementDef.
 * Each key maps to a RefObject pointing at a declared handler function.
 * Derived from @webref/idl EventHandler attributes at generation time.
 *
 * @param {string[]} eventHandlers
 * @returns {object}
 */
function buildEventHandlerProperties(eventHandlers) {
  const properties = {};
  for (const name of eventHandlers) {
    properties[name] = {
      'description': `Event handler for the "${name.slice(2)}" event.`,
      '$ref': '#/$defs/RefObject',
    };
  }
  return properties;
}

/**
 * Build the explicit CSS `properties` fragment for StyleObject.
 * Each key is a camelCase CSSOM property name; the value schema accepts
 * strings and numbers (CSS values are always coerced to strings at runtime).
 * Derived from @webref/css styleDeclaration names at generation time.
 *
 * @param {string[]} cssProps
 * @returns {object}
 */
function buildCssProperties(cssProps) {
  const properties = {};
  for (const name of cssProps) {
    properties[name] = { 'oneOf': [{ 'type': 'string' }, { 'type': 'number' }] };
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
 * Validate a JSONsx document against the generated schema using Ajv.
 *
 * @param {object} doc
 * @returns {Promise<{ valid: boolean, errors: object[] | null }>}
 */
export async function validateDocument(doc) {
  let Ajv, addFormats;
  try {
    ({ default: Ajv }        = await import('ajv'));
    ({ default: addFormats } = await import('ajv-formats'));
  } catch {
    throw new Error('Schema validation requires ajv and ajv-formats: bun add ajv ajv-formats');
  }

  const ajv      = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const schema   = await generateSchema();
  const validate = ajv.compile(schema);
  const valid    = validate(doc);

  return { valid, errors: validate.errors ?? null };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith('schema.js')) {
  const [,, out] = process.argv;
  const schemaStr = await generateSchemaString();

  if (out) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, schemaStr, 'utf8');
    console.error(`JSONsx meta-schema written to ${out}`);
  } else {
    process.stdout.write(schemaStr + '\n');
  }
}
