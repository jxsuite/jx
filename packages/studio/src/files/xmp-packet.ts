/**
 * The XMP packet a media file carries, read and rewritten for the two properties Studio edits.
 *
 * Studio keeps what a picture IS inside the picture (studio.md §22.6), in the fields every photo
 * tool already reads and writes, so a file moved, renamed, copied or opened in another program
 * takes its description with it and no index beside it can drift:
 *
 * - **Alt text** is the IPTC Photo Metadata Standard's `Iptc4xmpCore:AltTextAccessibility`, a
 *   language alternative whose `x-default` entry is the text. Other languages are kept as found.
 * - **Tags** are `dc:subject`, the unordered bag IPTC's Keywords maps to in XMP.
 *
 * **Everything else in the packet is kept.** A rewrite parses the packet into a small tree,
 * replaces those two properties on the first `rdf:Description` (removing them from any other, so a
 * file never says two things), and serializes the tree back: a camera's EXIF mirror, a licence, a
 * Lightroom develop setting all survive byte-for-byte in meaning. A packet that does not parse is
 * never "repaired" into a fresh one, which would silently delete whatever it held; it is refused,
 * and the caller says so.
 *
 * The parser is deliberately DOM-free: XMP is a constrained XML (no DTD, no external entities), the
 * tree has to round-trip text it does not understand exactly, and a pure module tests and runs the
 * same everywhere.
 *
 * @docs studio/projects/media
 */

/** What Studio reads from, and writes to, one media file. */
export interface MediaRecord {
  /** The file's alt text, `""` when it has none. */
  alt: string;
  /** Its tags, in the order the file lists them, without duplicates or blanks. */
  tags: string[];
}

export const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const DC_NS = "http://purl.org/dc/elements/1.1/";
export const IPTC_CORE_NS = "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const X_NS = "adobe:ns:meta/";

/** The empty record: no alt text, no tags. */
export function emptyMediaRecord(): MediaRecord {
  return { alt: "", tags: [] };
}

// ─── A small XML tree ────────────────────────────────────────────────────────

interface XmlElement {
  type: "element";
  /** The qualified name as written (`dc:subject`). */
  name: string;
  /** Attributes in source order, values decoded. */
  attrs: [string, string][];
  children: XmlNode[];
}

interface XmlText {
  type: "text";
  /** Decoded text. */
  value: string;
}

/** A node kept verbatim: a comment, a processing instruction, a CDATA section. */
interface XmlRaw {
  type: "raw";
  source: string;
}

type XmlNode = XmlElement | XmlText | XmlRaw;

/** Why a packet could not be read: the message a caller reports. */
export class XmpParseError extends Error {
  override name = "XmpParseError";
}

const ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["quot", '"'],
]);

/** The code point a numeric character reference names, or `null` for a named one. */
function codePointOf(ref: string): number | null {
  if (ref.startsWith("#x") || ref.startsWith("#X")) {
    return Number.parseInt(ref.slice(2), 16);
  }
  return ref.startsWith("#") ? Number(ref.slice(1)) : null;
}

function decodeEntities(text: string): string {
  return text.replaceAll(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, ref: string) => {
    const code = codePointOf(ref);
    const decoded =
      code === null
        ? ENTITIES.get(ref)
        : code <= 0x10_ff_ff
          ? String.fromCodePoint(code)
          : undefined;
    if (decoded === undefined) {
      throw new XmpParseError(`Unknown entity ${whole}`);
    }
    return decoded;
  });
}

function escapeText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(text: string): string {
  return escapeText(text).replaceAll('"', "&quot;");
}

const NAME = /^[A-Za-z_][\w.:-]*/;

/** Parse markup into nodes. Throws {@link XmpParseError} on anything that is not well formed. */
function parseXml(source: string): XmlNode[] {
  const root: XmlElement = { attrs: [], children: [], name: "#root", type: "element" };
  const stack: XmlElement[] = [root];
  let at = 0;
  const top = (): XmlElement => stack.at(-1) ?? root;
  while (at < source.length) {
    const lt = source.indexOf("<", at);
    if (lt === -1) {
      top().children.push({ type: "text", value: decodeEntities(source.slice(at)) });
      break;
    }
    if (lt > at) {
      top().children.push({ type: "text", value: decodeEntities(source.slice(at, lt)) });
    }
    const rest = source.slice(lt, lt + 9);
    let end: number;
    if (rest.startsWith("<!--")) {
      end = source.indexOf("-->", lt);
      end = end === -1 ? -1 : end + 3;
    } else if (rest.startsWith("<![CDATA[")) {
      end = source.indexOf("]]>", lt);
      end = end === -1 ? -1 : end + 3;
    } else if (rest.startsWith("<?")) {
      end = source.indexOf("?>", lt);
      end = end === -1 ? -1 : end + 2;
    } else if (rest.startsWith("<!")) {
      throw new XmpParseError("A packet may not declare a document type.");
    } else if (rest.startsWith("</")) {
      const close = source.indexOf(">", lt);
      if (close === -1) {
        throw new XmpParseError("Unclosed end tag.");
      }
      const name = source.slice(lt + 2, close).trim();
      const open = stack.pop();
      if (open === undefined || open === root || open.name !== name) {
        throw new XmpParseError(`Unexpected </${name}>.`);
      }
      at = close + 1;
      continue;
    } else {
      at = parseStartTag(source, lt, stack);
      continue;
    }
    if (end === -1) {
      throw new XmpParseError("Unterminated markup.");
    }
    top().children.push({ source: source.slice(lt, end), type: "raw" });
    at = end;
  }
  if (stack.length !== 1) {
    throw new XmpParseError(`<${top().name}> is never closed.`);
  }
  return root.children;
}

/** Parse the start tag at `lt` onto `stack`, returning where parsing continues. */
function parseStartTag(source: string, lt: number, stack: XmlElement[]): number {
  let at = lt + 1;
  const nameMatch = NAME.exec(source.slice(at));
  if (nameMatch === null) {
    throw new XmpParseError("A tag has no name.");
  }
  const element: XmlElement = { attrs: [], children: [], name: nameMatch[0], type: "element" };
  at += nameMatch[0].length;
  for (;;) {
    while (/\s/.test(source[at] ?? "")) {
      at += 1;
    }
    const ch = source[at];
    if (ch === undefined) {
      throw new XmpParseError(`<${element.name}> is never finished.`);
    }
    if (ch === ">" || source.startsWith("/>", at)) {
      stack.at(-1)?.children.push(element);
      if (ch === ">") {
        stack.push(element);
        return at + 1;
      }
      return at + 2;
    }
    const attrName = NAME.exec(source.slice(at));
    if (attrName === null) {
      throw new XmpParseError(`<${element.name}> has a malformed attribute.`);
    }
    at += attrName[0].length;
    while (/\s/.test(source[at] ?? "")) {
      at += 1;
    }
    if (source[at] !== "=") {
      throw new XmpParseError(`${attrName[0]} has no value.`);
    }
    at += 1;
    while (/\s/.test(source[at] ?? "")) {
      at += 1;
    }
    const quote = source[at];
    if (quote !== '"' && quote !== "'") {
      throw new XmpParseError(`${attrName[0]} is not quoted.`);
    }
    const close = source.indexOf(quote, at + 1);
    if (close === -1) {
      throw new XmpParseError(`${attrName[0]} is never closed.`);
    }
    element.attrs.push([attrName[0], decodeEntities(source.slice(at + 1, close))]);
    at = close + 1;
  }
}

function serializeXml(nodes: readonly XmlNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return escapeText(node.value);
      }
      if (node.type === "raw") {
        return node.source;
      }
      const attrs = node.attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
      return node.children.length === 0
        ? `<${node.name}${attrs}/>`
        : `<${node.name}${attrs}>${serializeXml(node.children)}</${node.name}>`;
    })
    .join("");
}

// ─── Namespaces ──────────────────────────────────────────────────────────────

/** Prefix → URI bindings in scope. */
type Scope = ReadonlyMap<string, string>;

function scopeOf(element: XmlElement, parent: Scope): Scope {
  const declared = element.attrs.filter(([k]) => k === "xmlns" || k.startsWith("xmlns:"));
  if (declared.length === 0) {
    return parent;
  }
  const scope = new Map(parent);
  for (const [k, v] of declared) {
    scope.set(k === "xmlns" ? "" : k.slice(6), v);
  }
  return scope;
}

/** A qualified name's namespace URI and local name, or `null` when its prefix is unbound. */
function resolve(qname: string, scope: Scope, isAttr = false): [string, string] | null {
  const colon = qname.indexOf(":");
  if (colon === -1) {
    // An unprefixed attribute is in no namespace; an unprefixed element takes the default.
    return isAttr ? ["", qname] : [scope.get("") ?? "", qname];
  }
  const prefix = qname.slice(0, colon);
  const uri = prefix === "xml" ? XML_NS : scope.get(prefix);
  return uri === undefined ? null : [uri, qname.slice(colon + 1)];
}

function isNamed(qname: string, scope: Scope, ns: string, local: string, isAttr = false): boolean {
  const resolved = resolve(qname, scope, isAttr);
  return resolved !== null && resolved[0] === ns && resolved[1] === local;
}

function elements(nodes: readonly XmlNode[]): XmlElement[] {
  return nodes.filter((node): node is XmlElement => node.type === "element");
}

function textOf(element: XmlElement): string {
  return element.children
    .map((node) =>
      node.type === "text" ? node.value : node.type === "element" ? textOf(node) : "",
    )
    .join("");
}

/** Every `rdf:Description`, with the scope in force inside it, in document order. */
function descriptions(nodes: readonly XmlNode[], scope: Scope = new Map()): [XmlElement, Scope][] {
  const found: [XmlElement, Scope][] = [];
  for (const element of elements(nodes)) {
    const inner = scopeOf(element, scope);
    if (isNamed(element.name, inner, RDF_NS, "Description")) {
      found.push([element, inner]);
    } else {
      found.push(...descriptions(element.children, inner));
    }
  }
  return found;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** The `rdf:li` items of a property's container (`rdf:Bag`, `rdf:Seq` or `rdf:Alt`). */
function listItems(property: XmlElement, scope: Scope): [XmlElement, Scope][] {
  const items: [XmlElement, Scope][] = [];
  for (const container of elements(property.children)) {
    const inner = scopeOf(container, scope);
    for (const li of elements(container.children)) {
      const liScope = scopeOf(li, inner);
      if (isNamed(li.name, liScope, RDF_NS, "li")) {
        items.push([li, liScope]);
      }
    }
  }
  return items;
}

function langOf(li: XmlElement, scope: Scope): string | null {
  const attr = li.attrs.find(([k]) => isNamed(k, scope, XML_NS, "lang", true));
  return attr === undefined ? null : attr[1];
}

/** The alt text in a lang-alt property: its `x-default` entry, else its first. */
function altFrom(property: XmlElement, scope: Scope): string {
  const items = listItems(property, scope);
  const chosen = items.find(([li, s]) => langOf(li, s)?.toLowerCase() === "x-default") ?? items[0];
  return chosen === undefined ? textOf(property).trim() : textOf(chosen[0]);
}

/** Tags without blanks or repeats, in order. */
export function cleanTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    const key = tag.toLowerCase();
    if (tag !== "" && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

/**
 * What a packet says about the file: its alt text and tags. `null` (no packet) is the empty record.
 * Throws {@link XmpParseError} when the packet is not well formed.
 */
export function readMediaRecord(packet: string | null): MediaRecord {
  if (packet === null) {
    return emptyMediaRecord();
  }
  const record = emptyMediaRecord();
  let altFound = false;
  for (const [description, scope] of descriptions(parseXml(packet))) {
    for (const [name, value] of description.attrs) {
      // The attribute form a simple-valued property may take: never a list, but tolerated.
      if (!altFound && isNamed(name, scope, IPTC_CORE_NS, "AltTextAccessibility", true)) {
        record.alt = value;
        altFound = true;
      }
    }
    for (const property of elements(description.children)) {
      const inner = scopeOf(property, scope);
      if (!altFound && isNamed(property.name, inner, IPTC_CORE_NS, "AltTextAccessibility")) {
        record.alt = altFrom(property, inner);
        altFound = true;
      } else if (isNamed(property.name, inner, DC_NS, "subject")) {
        record.tags.push(...listItems(property, inner).map(([li]) => textOf(li)));
      }
    }
  }
  record.tags = cleanTags(record.tags);
  record.alt = record.alt.trim();
  return record;
}

// ─── Writing ─────────────────────────────────────────────────────────────────

const PACKET_BEGIN = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>`;
const PACKET_END = `<?xpacket end="w"?>`;

/** A fresh packet holding one empty description: what a file with no XMP is given. */
function freshPacket(): string {
  return (
    `${PACKET_BEGIN}<x:xmpmeta xmlns:x="${X_NS}"><rdf:RDF xmlns:rdf="${RDF_NS}">` +
    `<rdf:Description rdf:about=""/></rdf:RDF></x:xmpmeta>${PACKET_END}`
  );
}

/** A prefix bound to `ns` in scope, else bind `preferred` (or a numbered variant) on `element`. */
function prefixFor(element: XmlElement, scope: Scope, ns: string, preferred: string): string {
  for (const [prefix, uri] of scope) {
    if (uri === ns && prefix !== "") {
      return prefix;
    }
  }
  let prefix = preferred;
  for (let n = 1; scope.has(prefix) || element.attrs.some(([k]) => k === `xmlns:${prefix}`); n++) {
    prefix = `${preferred}${n}`;
  }
  element.attrs.push([`xmlns:${prefix}`, ns]);
  return prefix;
}

function el(name: string, attrs: [string, string][], children: XmlNode[]): XmlElement {
  return { attrs, children, name, type: "element" };
}

/** Remove one property, in element and attribute form, from a description. */
function dropProperty(description: XmlElement, scope: Scope, ns: string, local: string): void {
  description.attrs = description.attrs.filter(([k]) => !isNamed(k, scope, ns, local, true));
  description.children = description.children.filter(
    (node) => node.type !== "element" || !isNamed(node.name, scopeOf(node, scope), ns, local),
  );
}

/**
 * The existing lang-alt entries other than `x-default`, so a rewrite of the alt text keeps the
 * translations another tool wrote.
 */
function otherLanguages(description: XmlElement, scope: Scope): { lang: string; text: string }[] {
  const property = elements(description.children).find((node) =>
    isNamed(node.name, scopeOf(node, scope), IPTC_CORE_NS, "AltTextAccessibility"),
  );
  if (property === undefined) {
    return [];
  }
  return listItems(property, scopeOf(property, scope))
    .filter(([li, s]) => (langOf(li, s) ?? "x-default").toLowerCase() !== "x-default")
    .map(([li, s]) => ({ lang: langOf(li, s) ?? "", text: textOf(li) }));
}

/**
 * The packet with its alt text and tags set to `record`, everything else kept.
 *
 * `null` (the file has no packet) starts a fresh one. Throws {@link XmpParseError} when the existing
 * packet does not parse: a rewrite never replaces what it could not read.
 */
export function writeMediaRecord(packet: string | null, record: MediaRecord): string {
  const nodes = parseXml(packet ?? freshPacket());
  const all = descriptions(nodes);
  const [target, scope] = all[0] ?? addDescription(nodes);
  const translations = otherLanguages(target, scope);
  for (const [description, s] of all) {
    dropProperty(description, s, IPTC_CORE_NS, "AltTextAccessibility");
    dropProperty(description, s, DC_NS, "subject");
  }
  const rdf = prefixFor(target, scope, RDF_NS, "rdf");
  const alt = record.alt.trim();
  if (alt !== "" || translations.length > 0) {
    const iptc = prefixFor(target, scope, IPTC_CORE_NS, "Iptc4xmpCore");
    // Re-homed under a new container, each language is written with `xml:`, which is always bound.
    const entries = alt === "" ? translations : [{ lang: "x-default", text: alt }, ...translations];
    const items = entries.map(({ lang, text }) =>
      el(`${rdf}:li`, [["xml:lang", lang]], [{ type: "text", value: text }]),
    );
    target.children.push(el(`${iptc}:AltTextAccessibility`, [], [el(`${rdf}:Alt`, [], items)]));
  }
  const tags = cleanTags(record.tags);
  if (tags.length > 0) {
    const dc = prefixFor(target, scope, DC_NS, "dc");
    const items = tags.map((tag) => el(`${rdf}:li`, [], [{ type: "text", value: tag }]));
    target.children.push(el(`${dc}:subject`, [], [el(`${rdf}:Bag`, [], items)]));
  }
  return serializeXml(nodes);
}

/** The `rdf:RDF` element and the scope inside it, or `null` when the packet has none. */
function findRdf(nodes: readonly XmlNode[], scope: Scope = new Map()): [XmlElement, Scope] | null {
  for (const element of elements(nodes)) {
    const inner = scopeOf(element, scope);
    if (isNamed(element.name, inner, RDF_NS, "RDF")) {
      return [element, inner];
    }
    const found = findRdf(element.children, inner);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Give a packet with no description one, under its `rdf:RDF` and in that element's own prefix.
 * Refuses a packet with no RDF at all: there is nowhere a property could go.
 */
function addDescription(nodes: readonly XmlNode[]): [XmlElement, Scope] {
  const found = findRdf(nodes);
  if (found === null) {
    throw new XmpParseError("The packet has no rdf:RDF element.");
  }
  const [rdf, scope] = found;
  const colon = rdf.name.indexOf(":");
  const prefix = colon === -1 ? "" : `${rdf.name.slice(0, colon)}:`;
  const description = el(`${prefix}Description`, [[`${prefix}about`, ""]], []);
  rdf.children.push(description);
  return [description, scope];
}

/** Whether two records say the same thing. */
export function sameMediaRecord(a: MediaRecord, b: MediaRecord): boolean {
  return (
    a.alt.trim() === b.alt.trim() &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, index) => tag === b.tags[index])
  );
}
