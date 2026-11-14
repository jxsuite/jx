/**
 * Which DOM properties HTML reflects to a content attribute, per element (spec.md §8.1).
 *
 * The runtime assigns an element definition's keys as properties and the platform reflects them. A
 * page the build prerenders is HTML text, which has only attributes, so the static emitter asks
 * this table which attribute a property writes and how its setter converts the value. It is an
 * allowlist keyed by tag and property: a key the element does not reflect is an expando or
 * live-only state at run time (`indeterminate`, `href` on a `div`, a custom element's own
 * property), and written as an attribute it would give the built page something the hydrated page
 * lacks.
 *
 * The rows are every writable string, boolean or numeric member of HTML's and WAI-ARIA's IDL that
 * carries a `[Reflect…]` extended attribute, plus the members HTML says reflect in prose. A test
 * checks each row against `@webref/idl` and `@webref/elements`; it does not assert completeness, so
 * a new HTML attribute is a missing row and not a failing dependency update.
 *
 * A subpath of its own, so the interpreter's main entry does not carry it.
 *
 * @docs framework/concepts/elements
 */

/** How one property reaches markup: the attribute it writes and its setter's conversion. */
export interface Reflection {
  /** The content attribute's name, lowercase. */
  readonly attribute: string;
  /**
   * `text` writes the value's string form, `boolean` writes by truthiness (presence, or a word for
   * the enumerated ones), and `hidden` is `boolean` that also keeps the `until-found` keyword.
   */
  readonly kind: "text" | "boolean" | "hidden";
  /** A boolean property spelled as a pair of words: the text for true, then for false. */
  readonly keywords?: readonly [string, string];
  /** The property sets live state that a later write of the attribute does not move. */
  readonly live?: boolean;
}

/** What a row adds beyond its attribute and kind. */
type ReflectionExtra = Pick<Reflection, "keywords" | "live">;

/** A row every element has: the property, then how it reflects. */
export type GlobalRow = readonly [property: string, reflection: Reflection];

/** A row some elements have: the property, the tags (space-separated), then how it reflects. */
export type ElementRow = readonly [property: string, tags: string, reflection: Reflection];

const text = (attribute: string, extra: ReflectionExtra = {}): Reflection => ({
  attribute,
  kind: "text",
  ...extra,
});

const bool = (attribute: string, extra: ReflectionExtra = {}): Reflection => ({
  attribute,
  kind: "boolean",
  ...extra,
});

const LIVE = { live: true } satisfies ReflectionExtra;

/**
 * The rows hosted by `Element`, `HTMLElement` or a mixin they include, which every element has, a
 * custom element included.
 */
export const GLOBAL_ROWS: readonly GlobalRow[] = [
  ["accessKey", text("accesskey")],
  ["ariaAtomic", text("aria-atomic")],
  ["ariaAutoComplete", text("aria-autocomplete")],
  ["ariaBrailleLabel", text("aria-braillelabel")],
  ["ariaBrailleRoleDescription", text("aria-brailleroledescription")],
  ["ariaBusy", text("aria-busy")],
  ["ariaChecked", text("aria-checked")],
  ["ariaColCount", text("aria-colcount")],
  ["ariaColIndex", text("aria-colindex")],
  ["ariaColIndexText", text("aria-colindextext")],
  ["ariaColSpan", text("aria-colspan")],
  ["ariaCurrent", text("aria-current")],
  ["ariaDescription", text("aria-description")],
  ["ariaDisabled", text("aria-disabled")],
  ["ariaExpanded", text("aria-expanded")],
  ["ariaHasPopup", text("aria-haspopup")],
  ["ariaHidden", text("aria-hidden")],
  ["ariaInvalid", text("aria-invalid")],
  ["ariaKeyShortcuts", text("aria-keyshortcuts")],
  ["ariaLabel", text("aria-label")],
  ["ariaLevel", text("aria-level")],
  ["ariaLive", text("aria-live")],
  ["ariaModal", text("aria-modal")],
  ["ariaMultiLine", text("aria-multiline")],
  ["ariaMultiSelectable", text("aria-multiselectable")],
  ["ariaOrientation", text("aria-orientation")],
  ["ariaPlaceholder", text("aria-placeholder")],
  ["ariaPosInSet", text("aria-posinset")],
  ["ariaPressed", text("aria-pressed")],
  ["ariaReadOnly", text("aria-readonly")],
  ["ariaRelevant", text("aria-relevant")],
  ["ariaRequired", text("aria-required")],
  ["ariaRoleDescription", text("aria-roledescription")],
  ["ariaRowCount", text("aria-rowcount")],
  ["ariaRowIndex", text("aria-rowindex")],
  ["ariaRowIndexText", text("aria-rowindextext")],
  ["ariaRowSpan", text("aria-rowspan")],
  ["ariaSelected", text("aria-selected")],
  ["ariaSetSize", text("aria-setsize")],
  ["ariaSort", text("aria-sort")],
  ["ariaValueMax", text("aria-valuemax")],
  ["ariaValueMin", text("aria-valuemin")],
  ["ariaValueNow", text("aria-valuenow")],
  ["ariaValueText", text("aria-valuetext")],
  ["autocapitalize", text("autocapitalize")],
  ["autocorrect", bool("autocorrect", { keywords: ["on", "off"] })],
  ["autofocus", bool("autofocus")],
  ["className", text("class")],
  ["contentEditable", text("contenteditable")],
  ["dir", text("dir")],
  ["draggable", bool("draggable")],
  ["enterKeyHint", text("enterkeyhint")],
  ["headingOffset", text("headingoffset")],
  ["headingReset", bool("headingreset")],
  ["hidden", { attribute: "hidden", kind: "hidden" }],
  ["id", text("id")],
  ["inert", bool("inert")],
  ["inputMode", text("inputmode")],
  ["lang", text("lang")],
  ["popover", text("popover")],
  ["role", text("role")],
  ["slot", text("slot")],
  ["spellcheck", bool("spellcheck")],
  ["tabIndex", text("tabindex")],
  ["title", text("title")],
  ["translate", bool("translate", { keywords: ["yes", "no"] })],
  ["writingSuggestions", text("writingsuggestions")],
];

/** The rows of particular elements, each resolved through its interface's inheritance and mixins. */
export const ELEMENT_ROWS: readonly ElementRow[] = [
  ["aLink", "body", text("alink")],
  ["abbr", "td th", text("abbr")],
  ["accept", "input", text("accept")],
  ["acceptCharset", "form", text("accept-charset")],
  ["action", "form", text("action")],
  [
    "align",
    "caption col colgroup div embed h1 h2 h3 h4 h5 h6 hr iframe img input legend object p table tbody td tfoot th thead tr",
    text("align"),
  ],
  ["allow", "iframe", text("allow")],
  ["allowFullscreen", "iframe", bool("allowfullscreen")],
  ["alpha", "input", bool("alpha")],
  ["alt", "area img input", text("alt")],
  ["archive", "object", text("archive")],
  ["as", "link", text("as")],
  ["async", "script", bool("async")],
  ["autocomplete", "form input select textarea", text("autocomplete")],
  ["autoplay", "audio video", bool("autoplay")],
  ["axis", "td th", text("axis")],
  ["background", "body", text("background")],
  ["behavior", "marquee", text("behavior")],
  ["bgColor", "body marquee table td th tr", text("bgcolor")],
  ["border", "img object table", text("border")],
  ["cellPadding", "table", text("cellpadding")],
  ["cellSpacing", "table", text("cellspacing")],
  ["ch", "col colgroup tbody td tfoot th thead tr", text("char")],
  ["chOff", "col colgroup tbody td tfoot th thead tr", text("charoff")],
  ["charset", "a link script", text("charset")],
  ["checked", "input", bool("checked", LIVE)],
  ["cite", "blockquote del ins q", text("cite")],
  ["clear", "br", text("clear")],
  ["closedBy", "dialog", text("closedby")],
  ["code", "object", text("code")],
  ["codeBase", "object", text("codebase")],
  ["codeType", "object", text("codetype")],
  ["colSpan", "td th", text("colspan")],
  ["color", "font hr", text("color")],
  ["colorSpace", "input", text("colorspace")],
  ["cols", "frameset textarea", text("cols")],
  ["command", "button", text("command")],
  ["compact", "dir dl menu ol ul", bool("compact")],
  ["content", "meta", text("content")],
  ["controls", "audio img video", bool("controls")],
  ["coords", "a area", text("coords")],
  ["crossOrigin", "audio img link script video", text("crossorigin")],
  ["data", "object", text("data")],
  ["dateTime", "del ins time", text("datetime")],
  ["declare", "object", bool("declare")],
  ["decoding", "img", text("decoding")],
  ["default", "track", bool("default")],
  ["defaultChecked", "input", bool("checked")],
  ["defaultMuted", "audio video", bool("muted")],
  ["defaultSelected", "option", bool("selected")],
  ["defaultValue", "input", text("value")],
  ["defer", "script", bool("defer")],
  ["dirName", "input textarea", text("dirname")],
  ["direction", "marquee", text("direction")],
  ["disabled", "button fieldset input link optgroup option select textarea", bool("disabled")],
  ["download", "a area", text("download")],
  ["encoding", "form", text("enctype")],
  ["enctype", "form", text("enctype")],
  ["event", "script", text("event")],
  ["face", "font", text("face")],
  ["fetchPriority", "img link script", text("fetchpriority")],
  ["formAction", "button input", text("formaction")],
  ["formEnctype", "button input", text("formenctype")],
  ["formMethod", "button input", text("formmethod")],
  ["formNoValidate", "button input", bool("formnovalidate")],
  ["formTarget", "button input", text("formtarget")],
  ["frame", "table", text("frame")],
  ["frameBorder", "frame iframe", text("frameborder")],
  ["headers", "td th", text("headers")],
  ["height", "canvas embed iframe img input marquee object source td th video", text("height")],
  ["high", "meter", text("high")],
  ["href", "a area base link", text("href")],
  ["hreflang", "a area link", text("hreflang")],
  ["hspace", "embed img input marquee object", text("hspace")],
  ["htmlFor", "label script template", text("for")],
  ["httpEquiv", "meta", text("http-equiv")],
  ["imageSizes", "link", text("imagesizes")],
  ["imageSrcset", "link", text("imagesrcset")],
  ["integrity", "link script", text("integrity")],
  ["isMap", "img", bool("ismap")],
  ["kind", "track", text("kind")],
  ["label", "optgroup option track", text("label")],
  ["link", "body", text("link")],
  ["loading", "audio iframe img video", text("loading")],
  ["longDesc", "frame iframe img", text("longdesc")],
  ["loop", "audio video", bool("loop")],
  ["low", "meter", text("low")],
  ["lowsrc", "img", text("lowsrc")],
  ["marginHeight", "frame iframe", text("marginheight")],
  ["marginWidth", "frame iframe", text("marginwidth")],
  ["max", "input meter progress", text("max")],
  ["maxLength", "input textarea", text("maxlength")],
  ["media", "link meta source style", text("media")],
  ["method", "form", text("method")],
  ["min", "input meter", text("min")],
  ["minLength", "input textarea", text("minlength")],
  ["multiple", "input select", bool("multiple")],
  ["muted", "audio video", bool("muted", LIVE)],
  [
    "name",
    "a button details embed fieldset form frame iframe img input map meta object output param select slot textarea",
    text("name"),
  ],
  ["noHref", "area", bool("nohref")],
  ["noModule", "script", bool("nomodule")],
  ["noResize", "frame", bool("noresize")],
  ["noShade", "hr", bool("noshade")],
  ["noValidate", "form", bool("novalidate")],
  ["noWrap", "td th", bool("nowrap")],
  ["open", "details dialog", bool("open")],
  ["optimum", "meter", text("optimum")],
  ["pattern", "input", text("pattern")],
  ["ping", "a area", text("ping")],
  ["placeholder", "input textarea", text("placeholder")],
  ["playsInline", "video", bool("playsinline")],
  ["popoverTargetAction", "button input", text("popovertargetaction")],
  ["poster", "video", text("poster")],
  ["preload", "audio video", text("preload")],
  ["readOnly", "input textarea", bool("readonly")],
  ["referrerPolicy", "a area iframe img link script", text("referrerpolicy")],
  ["rel", "a area form link", text("rel")],
  ["required", "input select textarea", bool("required")],
  ["rev", "a link", text("rev")],
  ["reversed", "ol", bool("reversed")],
  ["rowSpan", "td th", text("rowspan")],
  ["rows", "frameset textarea", text("rows")],
  ["rules", "table", text("rules")],
  ["scheme", "meta", text("scheme")],
  ["scope", "td th", text("scope")],
  ["scrollAmount", "marquee", text("scrollamount")],
  ["scrollDelay", "marquee", text("scrolldelay")],
  ["scrolling", "frame iframe", text("scrolling")],
  ["selected", "option", bool("selected", LIVE)],
  ["shadowRootClonable", "template", bool("shadowrootclonable")],
  ["shadowRootCustomElementRegistry", "template", text("shadowrootcustomelementregistry")],
  ["shadowRootDelegatesFocus", "template", bool("shadowrootdelegatesfocus")],
  ["shadowRootMode", "template", text("shadowrootmode")],
  ["shadowRootSerializable", "template", bool("shadowrootserializable")],
  ["shadowRootSlotAssignment", "template", text("shadowrootslotassignment")],
  ["shape", "a area", text("shape")],
  ["size", "font hr input select", text("size")],
  ["sizes", "img source", text("sizes")],
  ["span", "col colgroup", text("span")],
  ["src", "audio embed frame iframe img input source track video", text("src")],
  ["srcdoc", "iframe", text("srcdoc")],
  ["srclang", "track", text("srclang")],
  ["srcset", "img source", text("srcset")],
  ["standby", "object", text("standby")],
  ["start", "ol", text("start")],
  ["step", "input", text("step")],
  ["summary", "table", text("summary")],
  ["target", "a area base form link", text("target")],
  ["text", "body", text("text")],
  ["trueSpeed", "marquee", bool("truespeed")],
  [
    "type",
    "a area button embed input li link object ol param script source style ul",
    text("type"),
  ],
  ["useMap", "img input object", text("usemap")],
  ["vAlign", "col colgroup tbody td tfoot th thead tr", text("valign")],
  ["vLink", "body", text("vlink")],
  ["value", "button data li meter option param progress", text("value")],
  ["value", "input", text("value", LIVE)],
  ["valueType", "param", text("valuetype")],
  ["version", "html", text("version")],
  ["vspace", "embed img input marquee object", text("vspace")],
  [
    "width",
    "canvas col colgroup embed hr iframe img input listing marquee object pre source table td th video xmp",
    text("width"),
  ],
  ["wrap", "textarea", text("wrap")],
];

let globalIndex: Map<string, Reflection> | undefined;
let elementIndex: Map<string, Map<string, Reflection>> | undefined;

/**
 * The element rows keyed by property, then by tag. A `Map`, so `constructor`, `toString` and
 * `__proto__` are never rows. Keyed by property first because most members a definition sets
 * (`textContent`, a prop) are no row at all, and that answer should cost one lookup and no string.
 *
 * @returns {Map<string, Map<string, Reflection>>}
 */
function elementRows(): Map<string, Map<string, Reflection>> {
  if (!elementIndex) {
    elementIndex = new Map();
    for (const [property, tags, reflection] of ELEMENT_ROWS) {
      let byTag = elementIndex.get(property);
      if (!byTag) {
        byTag = new Map();
        elementIndex.set(property, byTag);
      }
      for (const tag of tags.split(" ")) {
        byTag.set(tag, reflection);
      }
    }
  }
  return elementIndex;
}

/**
 * The content attribute a property of an element reflects to, or `null` when HTML reflects it to
 * none: a property with no attribute, or one this element does not have. A custom or unknown tag
 * reaches only the global rows, because a custom element's own properties are props (spec.md
 * §13.2).
 *
 * @param {string} tagName - The element's tag, in any case
 * @param {string} property - The DOM property name, as an element definition spells it
 * @returns {Reflection | null}
 */
export function reflectedAttribute(tagName: string, property: string): Reflection | null {
  globalIndex ??= new Map(GLOBAL_ROWS);
  return (
    globalIndex.get(property) ?? elementRows().get(property)?.get(tagName.toLowerCase()) ?? null
  );
}

/** The elements whose `value` and `defaultValue` are their text. */
const VALUE_IS_TEXT: ReadonlySet<string> = new Set(["output", "textarea"]);

/** The elements whose `text` is their text. A `<script>`'s is not escaped text, so it is left out. */
const TEXT_IS_TEXT: ReadonlySet<string> = new Set(["a", "option", "title"]);

/**
 * Whether a property's setter replaces the element's text instead of writing an attribute:
 * `innerText` anywhere, `value` and `defaultValue` on a `<textarea>` or `<output>`, and `text` on
 * an `<a>`, `<option>` or `<title>`.
 *
 * @param {string} tagName - The element's tag, in any case
 * @param {string} property - The DOM property name
 * @returns {boolean}
 */
export function isContentProperty(tagName: string, property: string): boolean {
  if (property === "innerText") {
    return true;
  }
  if (property === "value" || property === "defaultValue") {
    return VALUE_IS_TEXT.has(tagName.toLowerCase());
  }
  return property === "text" && TEXT_IS_TEXT.has(tagName.toLowerCase());
}
