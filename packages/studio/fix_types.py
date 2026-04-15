import re, sys

filepath = '/home/batonac/Development/jsonsx/packages/studio/studio.js'
with open(filepath, 'r') as f:
    content = f.read()

lines = content.split('\n')
line_6001_offset = sum(len(l) + 1 for l in lines[:6000])
before = content[:line_6001_offset]
after = content[line_6001_offset:]

# renderKeywordInput already has JSDoc
after = after.replace(
    ' */\nfunction renderKeywordInput(options, prop, value, onChange) {',
    ' * @param {any} options @param {any} prop @param {any} value @param {any} onChange\n */\nfunction renderKeywordInput(options, prop, value, onChange) {')

funcs = [
    ('function renderButtonGroupInput(entry, prop, value, onChange) {',
     '/** @param {any} entry @param {any} prop @param {any} value @param {any} onChange */\nfunction renderButtonGroupInput(entry, prop, value, onChange) {'),
    ('function renderSelectInput(entry, prop, value, onChange) {',
     '/** @param {any} entry @param {any} prop @param {any} value @param {any} onChange */\nfunction renderSelectInput(entry, prop, value, onChange) {'),
    ('function handleFontPresetSelection(preset, onChange) {',
     '/** @param {any} preset @param {any} onChange */\nfunction handleFontPresetSelection(preset, onChange) {'),
    ('function renderFontOptions(fontVars, presets) {',
     '/** @param {any[]} fontVars @param {any[]} presets */\nfunction renderFontOptions(fontVars, presets) {'),
    ('function handleFontSelection(val, presets, onChange) {',
     '/** @param {any} val @param {any[]} presets @param {any} onChange */\nfunction handleFontSelection(val, presets, onChange) {'),
    ('function renderFontVarPicker(fontVars, presets, value, onChange) {',
     '/** @param {any[]} fontVars @param {any[]} presets @param {any} value @param {any} onChange */\nfunction renderFontVarPicker(fontVars, presets, value, onChange) {'),
    ('function renderFontCombobox(fontVars, presets, value, onChange) {',
     '/** @param {any[]} fontVars @param {any[]} presets @param {any} value @param {any} onChange */\nfunction renderFontCombobox(fontVars, presets, value, onChange) {'),
    ('function renderComboboxInput(entry, prop, value, onChange) {',
     '/** @param {any} entry @param {any} prop @param {any} value @param {any} onChange */\nfunction renderComboboxInput(entry, prop, value, onChange) {'),
    ('function renderNumberInput(entry, prop, value, onChange) {',
     '/** @param {any} entry @param {any} prop @param {any} value @param {any} onChange */\nfunction renderNumberInput(entry, prop, value, onChange) {'),
    ('function renderTextInput(prop, value, onChange) {',
     '/** @param {any} prop @param {any} value @param {any} onChange */\nfunction renderTextInput(prop, value, onChange) {'),
    ('function widgetForType(type, entry, prop, value, onCommit) {',
     '/** @param {any} type @param {any} entry @param {any} prop @param {any} value @param {any} onCommit */\nfunction widgetForType(type, entry, prop, value, onCommit) {'),
    ('function renderStyleRow(entry, prop, value, onCommit, onDelete, isWarning, gridMode) {',
     '/** @param {any} entry @param {any} prop @param {any} value @param {any} onCommit @param {any} onDelete @param {any} isWarning @param {any} gridMode */\nfunction renderStyleRow(entry, prop, value, onCommit, onDelete, isWarning, gridMode) {'),
    ('function renderShorthandRow(shortProp, entry, style, commitFn, deleteFn) {',
     '/** @param {any} shortProp @param {any} entry @param {any} style @param {any} commitFn @param {any} deleteFn */\nfunction renderShorthandRow(shortProp, entry, style, commitFn, deleteFn) {'),
    ('function styleSidebarTemplate(node, activeMediaTab, activeSelector) {',
     '/** @param {any} node @param {any} activeMediaTab @param {any} activeSelector */\nfunction styleSidebarTemplate(node, activeMediaTab, activeSelector) {'),
    ('function renderStylePanel(container) {',
     '/** @param {any} container */\nfunction renderStylePanel(container) {'),
    ('function fieldRow(label, type, value, onChange, datalistId) {',
     '/** @param {any} label @param {any} type @param {any} value @param {any} onChange @param {any} datalistId */\nfunction fieldRow(label, type, value, onChange, datalistId) {'),
    ('function isInsideMapTemplate(path) {',
     '/** @param {any} path */\nfunction isInsideMapTemplate(path) {'),
    ('function bindableFieldRow(label, type, rawValue, onChange, filterFn, extraSignals) {',
     '/** @param {any} label @param {any} type @param {any} rawValue @param {any} onChange @param {any} filterFn @param {any} extraSignals */\nfunction bindableFieldRow(label, type, rawValue, onChange, filterFn, extraSignals) {'),
    ('function kvRow(key, value, onChange, onDelete, datalistId) {',
     '/** @param {any} key @param {any} value @param {any} onChange @param {any} onDelete @param {any} datalistId */\nfunction kvRow(key, value, onChange, onDelete, datalistId) {'),
    ('function renderSourceView(container) {',
     '/** @param {any} container */\nfunction renderSourceView(container) {'),
    ('function getFunctionBody(editing) {',
     '/** @param {any} editing */\nfunction getFunctionBody(editing) {'),
    ('function collectSlots(node, slots = []) {',
     '/** @param {any} node @param {any[]} slots */\nfunction collectSlots(node, slots = []) {'),
    ('function statusMessage(msg, duration = 3000) {',
     '/** @param {any} msg @param {number} duration */\nfunction statusMessage(msg, duration = 3000) {'),
    ('function loadMarkdown(source, fileHandle) {',
     '/** @param {any} source @param {any} fileHandle */\nfunction loadMarkdown(source, fileHandle) {'),
    ('async function loadCompanionJS(handle) {',
     '/** @param {any} handle */\nasync function loadCompanionJS(handle) {'),
    ('function navigateSelection(direction) {',
     '/** @param {any} direction */\nfunction navigateSelection(direction) {'),
    ('function showContextMenu(e, path) {',
     '/** @param {any} e @param {any} path */\nfunction showContextMenu(e, path) {'),
]

for old, new in funcs:
    idx = after.find(old)
    if idx == -1:
        print(f"WARN: not found: {old[:50]}...", file=sys.stderr)
        continue
    after = after[:idx] + new + after[idx+len(old):]

# Inline (e) =>, (ev) =>, (c) =>
after = re.sub(r'\(e\) =>', '(/** @type {any} */ e) =>', after)
after = re.sub(r'\(ev\) =>', '(/** @type {any} */ ev) =>', after)
after = re.sub(r'\(c\) =>', '(/** @type {any} */ c) =>', after)

# .map/.filter/.find/.some/.forEach callbacks
for method in ['map', 'filter', 'find', 'some', 'forEach']:
    for var in ['v', 'p', 'fv', 'bp', 'sec', 'n', 'ev', 'evKey', 's', 'k', 'name', 'l', 'prop', 'c']:
        pattern = rf'\.{method}\(\({var}\) =>'
        repl = f'.{method}((/** @type {{any}} */ {var}) =>'
        after = re.sub(pattern, repl, after)
    # No-paren variants
    for var in ['v', 'm', 'frame', 'sig']:
        pattern = rf'\.{method}\({var} =>'
        repl = f'.{method}((/** @type {{any}} */ {var}) =>'
        after = re.sub(pattern, repl, after)

# Destructured callbacks
after = re.sub(r'\(\[, d\]\) =>', '(/** @type {any} */ [, d]) =>', after)
after = re.sub(r'\(\[key, def\]\) =>', '(/** @type {any} */ [key, def]) =>', after)
after = re.sub(r'\(\[defName\]\) =>', '(/** @type {any} */ [defName]) =>', after)
after = re.sub(r'\(\[fName\]\) =>', '(/** @type {any} */ [fName]) =>', after)
after = re.sub(r'\(\[fnName, d\]\) =>', '(/** @type {any} */ [fnName, d]) =>', after)

# Destructured object callbacks
after = re.sub(r'\.filter\(\(\{ prop, entry \}\) =>', '.filter((/** @type {any} */ { prop, entry }) =>', after)
after = re.sub(r'\.map\(\(\{ name, query \}\) =>', '.map((/** @type {any} */ { name, query }) =>', after)
after = re.sub(r'\.map\(\(\{ name, entry: lEntry \}\)', '.map((/** @type {any} */ { name, entry: lEntry })', after)

# finish callback
after = after.replace('const finish = (accept) =>', 'const finish = (/** @type {any} */ accept) =>')

# for-of destructuring
after = re.sub(r'for \(const \[p, v\] of', 'for (const /** @type {any} */ [p, v] of', after)
after = re.sub(r'for \(const \[key, d\] of', 'for (const /** @type {any} */ [key, d] of', after)
after = re.sub(r'for \(const \[fnName, d\] of', 'for (const /** @type {any} */ [fnName, d] of', after)
after = re.sub(r'for \(const \{ prop, entry \} of', 'for (const /** @type {any} */ { prop, entry } of', after)
after = re.sub(r'for \(const sec of cssMeta', 'for (const /** @type {any} */ sec of cssMeta', after)
after = re.sub(r'for \(const l of longhands', 'for (const /** @type {any} */ l of longhands', after)
after = re.sub(r'for \(const item of items', 'for (const /** @type {any} */ item of items', after)
after = re.sub(r'for \(const ev of d\.emits\)', 'for (const /** @type {any} */ ev of d.emits)', after)
after = re.sub(r'for \(const name of EVENT_NAMES\)', 'for (const /** @type {any} */ name of EVENT_NAMES)', after)

# provideCompletionItems
after = after.replace(
    'provideCompletionItems(model, position) {',
    'provideCompletionItems(/** @type {any} */ model, /** @type {any} */ position) {')

# Object.entries filter/map
after = after.replace(
    ".filter(([k]) => k.startsWith(",
    ".filter((/** @type {any} */ [k]) => k.startsWith(")
after = after.replace(
    ".map(([name, val]) => ({ name, default: String(val) }));",
    ".map((/** @type {any} */ [name, val]) => ({ name, default: String(val) }));")

# collectCssParts map
after = after.replace(
    "collectCssParts(doc).map((p) =>",
    "collectCssParts(doc).map((/** @type {any} */ p) =>")

# mdast children find
after = after.replace(
    'mdast.children.find((n) => n.type === "yaml")',
    'mdast.children.find((/** @type {any} */ n) => n.type === "yaml")')

# slotNames map
after = after.replace(
    'const slots = slotNames.map((name) =>',
    'const slots = slotNames.map((/** @type {any} */ name) =>')

# VARIABLES
after = after.replace(
    '  let activeStyle;\n  let commitStyle;',
    '  /** @type {any} */\n  let activeStyle;\n  /** @type {any} */\n  let commitStyle;')
after = after.replace(
    '  const sectionProps = {};',
    '  /** @type {Record<string, any[]>} */\n  const sectionProps = {};')
after = after.replace(
    '  const otherProps = [];\n  for (const prop of Object.keys(activeStyle))',
    '  /** @type {any[]} */\n  const otherProps = [];\n  for (const prop of Object.keys(activeStyle))')
after = after.replace(
    '      const rows = [];\n      for (const',
    '      /** @type {any[]} */\n      const rows = [];\n      for (const')
after = after.replace(
    'function fieldRow(label, type, value, onChange, datalistId) {\n  /** @type {any} */\n  let debounceTimer;',
    'function fieldRow(label, type, value, onChange, datalistId) {\n  /** @type {any} */\n  let debounceTimer;')  # already added by func annotation
# Actually fieldRow's debounceTimer needs separate handling
after = after.replace(
    '  let debounceTimer;\n  const onInput = (/** @type {any} */ e) => {\n    clearTimeout(debounceTimer);\n    debounceTimer = setTimeout(() => onChange(e.target.value), 400);\n  };\n  const inputTpl',
    '  /** @type {any} */\n  let debounceTimer;\n  const onInput = (/** @type {any} */ e) => {\n    clearTimeout(debounceTimer);\n    debounceTimer = setTimeout(() => onChange(e.target.value), 400);\n  };\n  const inputTpl', 1)

# debounce in bindableFieldRow - find the second occurrence
after = after.replace(
    '  let debounce;\n  const onInput',
    '  /** @type {any} */\n  let debounce;\n  const onInput', 1)

# debounceTimer in kvRow
after = after.replace(
    '  let debounceTimer;\n  let currentKey',
    '  /** @type {any} */\n  let debounceTimer;\n  let currentKey', 1)

# syncDebounce, lintDebounce
after = after.replace(
    '  let syncDebounce, lintDebounce, lintGen = 0;',
    '  /** @type {any} */\n  let syncDebounce;\n  /** @type {any} */\n  let lintDebounce;\n  let lintGen = 0;')

# members, attributes, events
after = after.replace(
    '  const members = [];\n  const attributes = [];\n  const events = [];',
    '  /** @type {any[]} */\n  const members = [];\n  /** @type {any[]} */\n  const attributes = [];\n  /** @type {any[]} */\n  const events = [];')

# parts in renderStatusbar
after = after.replace(
    '  const parts = [];\n  if (S.mode === "content")',
    '  /** @type {any[]} */\n  const parts = [];\n  if (S.mode === "content")')

# output etc in saveFile
after = after.replace(
    '    let output, mimeType, ext, description;',
    '    /** @type {any} */\n    let output;\n    /** @type {any} */\n    let mimeType;\n    /** @type {any} */\n    let ext;\n    /** @type {any} */\n    let description;')

after = after.replace('let clipboard = null;', '/** @type {any} */\nlet clipboard = null;')

after = after.replace(
    '  ctxMenuInner.innerHTML = "";\n  const items = [];',
    '  ctxMenuInner.innerHTML = "";\n  /** @type {any[]} */\n  const items = [];')

after = after.replace('let autosaveTimer;', '/** @type {any} */\nlet autosaveTimer;')

after = after.replace('    const allEmits = [];', '    /** @type {any[]} */\n    const allEmits = [];')

after = after.replace(
    '  const iconMap = entry.$icons || {};',
    '  /** @type {Record<string, any>} */\n  const iconMap = entry.$icons || {};')

# seenEvents
after = after.replace(
    '  const seenEvents = new Set();',
    '  /** @type {Set<any>} */\n  const seenEvents = new Set();')

# CATCH BLOCKS
after = after.replace(
    '} catch (e) {\n    if (e.name !== "AbortError") statusMessage(`Error: ${e.message}`);\n  }',
    '} catch (/** @type {any} */ e) {\n    if (e.name !== "AbortError") statusMessage(`Error: ${e.message}`);\n  }')
after = after.replace(
    '} catch (e) {\n    if (e.name !== "AbortError") statusMessage(`Save error: ${e.message}`);\n  }',
    '} catch (/** @type {any} */ e) {\n    if (e.name !== "AbortError") statusMessage(`Save error: ${e.message}`);\n  }')

# RECORDS
after = after.replace(
    '  const style = node.style || {};\n  const { sizeBreakpoints }',
    '  /** @type {Record<string, any>} */\n  const style = node.style || {};\n  const { sizeBreakpoints }')
after = after.replace(
    '  const contextStyle = activeTab ? (style[`@${activeTab}`] || {}) : style;',
    '  /** @type {Record<string, any>} */\n  const contextStyle = activeTab ? (style[`@${activeTab}`] || {}) : style;')
after = after.replace(
    '  const defs = S.document.state || {};\n  const functionDefs',
    '  /** @type {Record<string, any>} */\n  const defs = S.document.state || {};\n  const functionDefs')
after = after.replace(
    '  const defs = S.document.state || {};\n  const isBound',
    '  /** @type {Record<string, any>} */\n  const defs = S.document.state || {};\n  const isBound')
after = after.replace(
    '      const defs = S?.document?.state || {};',
    '      /** @type {Record<string, any>} */\n      const defs = S?.document?.state || {};')
after = after.replace(
    '  const state = doc.state || {};\n  const members',
    '  /** @type {Record<string, any>} */\n  const state = doc.state || {};\n  const members')
after = after.replace(
    '  // CSS custom properties\n  const style = doc.style || {};',
    '  // CSS custom properties\n  /** @type {Record<string, any>} */\n  const style = doc.style || {};')

# POSSIBLY NULL
after = after.replace(
    'const file = input.files[0];',
    'const file = /** @type {any} */ (input.files)[0];')

# frontmatter
after = after.replace(
    '  let frontmatter = {};\n  const yamlNode',
    '  /** @type {Record<string, any>} */\n  let frontmatter = {};\n  const yamlNode')

content = before + after
with open(filepath, 'w') as f:
    f.write(content)
print("Done!", file=sys.stderr)
