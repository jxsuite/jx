/**
 * studio-utils.js — Pure utility functions extracted from studio.js
 *
 * These are all side-effect-free functions used by style/properties/events panels.
 */

/** camelCase → kebab-case for inline style attributes */
export function camelToKebab(str) {
  return str.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}

/** Convert camelCase property name to "Title Case" label (e.g. "backgroundColor" → "Background Color") */
export function camelToLabel(prop) {
  return prop.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/** Convert a kebab-case CSS value to Title Case for picker display (e.g. "border-box" → "Border Box") */
export function kebabToLabel(val) {
  return val.replace(/(^|-)(\w)/g, (_, sep, c) => (sep ? " " : "") + c.toUpperCase());
}

/** Get display label from metadata entry or prop name */
export function propLabel(entry, prop) {
  return entry?.$label || camelToLabel(prop);
}

/** Label for HTML attributes — handles kebab-case (aria-label → "Aria Label") */
export function attrLabel(entry, attr) {
  if (entry?.$label) return entry.$label;
  if (attr.includes("-")) return attr.replace(/(^|-)(\w)/g, (_, sep, c) => (sep ? " " : "") + c.toUpperCase());
  return camelToLabel(attr);
}

/** Abbreviate a CSS value for button-group display */
export function abbreviateValue(val) {
  const map = {
    inline: "inl", "inline-block": "i-blk", "inline-flex": "i-flx", "inline-grid": "i-grd",
    contents: "cnt", "flow-root": "flow", nowrap: "no-wr", "wrap-reverse": "wr-rev",
    "flex-start": "start", "flex-end": "end", "space-between": "betw",
    "space-around": "arnd", "space-evenly": "even", stretch: "str", baseline: "base",
    normal: "norm", "row-reverse": "row-r", "column-reverse": "col-r", column: "col",
  };
  return map[val] || val;
}

/** Determine input widget type from a css-meta entry */
export function inferInputType(entry) {
  if (entry.$shorthand === true) return "shorthand";
  if (entry.$input === "button-group") return "button-group";
  if (entry.format === "color") return "color";
  if (entry.$units !== undefined) return "number-unit";
  if (entry.type === "number") return "number";
  if (Array.isArray(entry.enum)) return "select";
  if (Array.isArray(entry.examples) || Array.isArray(entry.presets)) return "combobox";
  return "text";
}
