/**
 * The colour maths the kit's colour elements are made of: sRGB, HSV, OKLCH, and the two WCAG
 * numbers that decide whether a mark drawn on a colour can be seen.
 *
 * It is a MODULE rather than a document because none of it is expressible in the closed operator
 * set: a cube root, an `atan2`, a piecewise transfer function and a regular expression are all
 * arithmetic a `$expression` cannot say, and the elements that need them need them per keystroke.
 * Nothing here touches the DOM, reads an element or holds state — it is the pure half of the colour
 * family, and the three behaviour sidecars beside it are the half that may focus, measure and
 * dispatch.
 *
 * THE MODEL EACH SPACE IS FOR.
 *
 * `Hsv` is the geometry of the 2D area and nothing else: `jx-color-area` is a saturation/brightness
 * square under one hue, which is what that square's two axes ARE, so the element's props are its
 * coordinates and no conversion happens while a pointer drags. `Rgb` is what a value is stored and
 * transported as, because `#rrggbbaa` is what a colour input, a stylesheet and a project file all
 * read. `Oklch` is what a colour is JUDGED in — a perceptual space, so a readout says something
 * true about lightness — and it is the format `jx-color-field` writes when a host asks for one.
 *
 * ALPHA IS ALWAYS 0-1 and always present. A colour with no alpha is opaque, never `undefined`: an
 * optional channel would make every caller write `?? 1` and one of them would forget, and the
 * failure mode of forgetting is an invisible swatch.
 *
 * @docs extending/ui-kit
 */

/** An sRGB colour. `r`, `g` and `b` are 0-255 and need not be integers; `a` is 0-1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A colour as the 2D area's own coordinates: hue 0-360, saturation and value 0-100, alpha 0-1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
  a: number;
}

/** A colour in OKLCH: lightness 0-1, chroma 0 upward, hue 0-360 degrees, alpha 0-1. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
  a: number;
}

/**
 * `value` held inside `[min, max]`. `NaN` resolves to `min`, because every caller is converting a
 * reader's text or a measured coordinate and both can be nothing at all.
 *
 * @param value The number to hold.
 * @param min The lower bound.
 * @param max The upper bound.
 * @returns The bounded number.
 */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return value < min ? min : value > max ? max : value;
}

/**
 * `value` snapped to the grid `step` describes, measured from `min` and held inside `[min, max]`.
 *
 * The area's pointer path is why this exists: a drag produces a continuous coordinate and the two
 * ranges behind it hold a stepped one, so without the snap the thumb and the announced value
 * disagree by up to a step for the whole of a drag.
 *
 * @param value The number to snap.
 * @param step The grid, measured from `min`; a non-positive step snaps nothing.
 * @param min The lower bound and the grid's origin.
 * @param max The upper bound.
 * @returns The snapped, bounded number.
 */
export function snapToStep(value: number, step: number, min: number, max: number): number {
  const held = clamp(value, min, max);
  if (!Number.isFinite(step) || step <= 0) {
    return held;
  }
  let snapped = min + Math.round((held - min) / step) * step;
  /* HTML's own step algorithm, and the reason this is not a plain round: when the nearest rung is
     ABOVE `max` the value falls back to the rung below it rather than to `max` itself, because
     `max` need not be on the grid. 0 to 100 in fortieths rounds 100 up to 120, and a native range
     holding the same three attributes reports 80. Without this the element and the two `<input
     type="range">`s inside it would disagree about the value at the top of every uneven track. */
  if (snapped > max) {
    snapped -= step;
  }
  return clamp(Number(snapped.toFixed(6)), min, max);
}

/** Two hex digits for one 0-255 channel. */
function hexPair(channel: number): string {
  return Math.round(clamp(channel, 0, 255))
    .toString(16)
    .padStart(2, "0");
}

/**
 * A `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` string as a colour, or `null` when it is none of
 * those.
 *
 * The leading `#` is optional, because a reader retyping a value into a text field drops it about
 * as often as they keep it, and refusing `3b82f6` would be pedantry rather than validation.
 *
 * @param text The text to read.
 * @returns The colour, or null.
 */
export function parseHex(text: string): Rgb | null {
  const digits = text.trim().replace(/^#/, "");
  if (!/^[0-9a-f]+$/i.test(digits)) {
    return null;
  }
  const wide = digits.length === 6 || digits.length === 8;
  const short = digits.length === 3 || digits.length === 4;
  if (!wide && !short) {
    return null;
  }
  const size = wide ? 2 : 1;
  const at = (index: number): number => {
    const part = digits.slice(index * size, index * size + size);
    return Number.parseInt(size === 1 ? part + part : part, 16);
  };
  const hasAlpha = digits.length === 4 || digits.length === 8;
  return { a: hasAlpha ? at(3) / 255 : 1, b: at(2), g: at(1), r: at(0) };
}

/**
 * One component of a CSS colour function, as a number. A percentage is scaled by `full`.
 *
 * @param token The token as written.
 * @param full What 100% means for this component.
 * @returns The number, or NaN when the token is not one.
 */
function component(token: string, full: number): number {
  /* `Number` rather than `parseFloat`, and the percent sign taken off by hand: `parseFloat` reads
     as far as it understands and stops, so it turns "12abc" into 12 and a reader's typo into a
     colour. `Number` refuses the whole token, which is the answer a parser owes its caller. */
  if (token.endsWith("%")) {
    return (Number(token.slice(0, -1)) / 100) * full;
  }
  return Number(token);
}

/** The arguments of `name(...)`, split on commas, whitespace and the alpha solidus. */
function argsOf(text: string, name: string): string[] | null {
  const match = new RegExp(`^${name}a?\\(([^)]*)\\)$`, "i").exec(text.trim());
  if (!match) {
    return null;
  }
  return match[1]!
    .trim()
    .split(/[\s,/]+/)
    .filter(Boolean);
}

/**
 * A colour written as hex, `rgb()`/`rgba()` or `oklch()`, or `null` when the text says none of
 * those.
 *
 * These three and no more, deliberately. Hex is what the element stores, `rgb()` is what
 * `getComputedStyle` hands back for anything a host already had, and `oklch()` is the format the
 * field itself writes — so the set is "what this element can produce", which is exactly the set a
 * reader can paste back into it and get the same colour. A named colour or a `color()` is a
 * question for the platform, and the honest answer to "did the platform understand it" is a
 * computed style, not a table copied into a kit.
 *
 * @param text The text to read.
 * @returns The colour, or null.
 */
export function parseColor(text: string): Rgb | null {
  const trimmed = text.trim();
  const rgb = argsOf(trimmed, "rgb");
  if (rgb && rgb.length >= 3) {
    const parts = [component(rgb[0]!, 255), component(rgb[1]!, 255), component(rgb[2]!, 255)];
    const alpha = rgb.length > 3 ? component(rgb[3]!, 1) : 1;
    if (parts.some((n) => Number.isNaN(n)) || Number.isNaN(alpha)) {
      return null;
    }
    return {
      a: clamp(alpha, 0, 1),
      b: clamp(parts[2]!, 0, 255),
      g: clamp(parts[1]!, 0, 255),
      r: clamp(parts[0]!, 0, 255),
    };
  }
  const lch = argsOf(trimmed, "oklch");
  if (lch && lch.length >= 3) {
    const l = component(lch[0]!, 1);
    const c = component(lch[1]!, 0.4);
    const h = Number(lch[2]!.replace(/deg$/i, ""));
    const alpha = lch.length > 3 ? component(lch[3]!, 1) : 1;
    if ([l, c, h, alpha].some((n) => Number.isNaN(n))) {
      return null;
    }
    return oklchToSrgb({ a: clamp(alpha, 0, 1), c, h, l });
  }
  return parseHex(trimmed);
}

/**
 * The `#rrggbb` or `#rrggbbaa` spelling of a colour. The alpha pair is written only when the colour
 * is not opaque, so an opaque value round-trips through a native `<input type="color">` — which
 * accepts the six-digit form and nothing else — without growing two digits it cannot read.
 *
 * @param rgb The colour.
 * @returns The hex string, lowercase, with its leading `#`.
 */
export function formatHex(rgb: Rgb): string {
  const base = `#${hexPair(rgb.r)}${hexPair(rgb.g)}${hexPair(rgb.b)}`;
  return rgb.a >= 1 ? base : `${base}${hexPair(clamp(rgb.a, 0, 1) * 255)}`;
}

/**
 * A colour as the area's own coordinates.
 *
 * A grey has no hue to report, and this returns 0 for it rather than something arbitrary — but the
 * element never asks: `jx-color-field` keeps the hue it was last given while the reader drags the
 * saturation to zero, because a hue slider that snapped back to red every time a colour went grey
 * would be unusable.
 *
 * @param rgb The colour.
 * @returns Its hue, saturation, value and alpha.
 */
export function rgbToHsv(rgb: Rgb): Hsv {
  const r = clamp(rgb.r, 0, 255) / 255;
  const g = clamp(rgb.g, 0, 255) / 255;
  const b = clamp(rgb.b, 0, 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  let h = 0;
  if (span !== 0) {
    if (max === r) {
      h = 60 * (((g - b) / span) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / span + 2);
    } else {
      h = 60 * ((r - g) / span + 4);
    }
  }
  return {
    a: clamp(rgb.a, 0, 1),
    h: (h + 360) % 360,
    s: max === 0 ? 0 : (span / max) * 100,
    v: max * 100,
  };
}

/**
 * The colour at a point of the area, under a hue.
 *
 * @param hsv The coordinates.
 * @returns The sRGB colour.
 */
export function hsvToRgb(hsv: Hsv): Rgb {
  const h = ((hsv.h % 360) + 360) % 360;
  const s = clamp(hsv.s, 0, 100) / 100;
  const v = clamp(hsv.v, 0, 100) / 100;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - chroma;
  const sector = Math.floor(h / 60) % 6;
  const table: [number, number, number][] = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ];
  const [r, g, b] = table[sector]!;
  return {
    a: clamp(hsv.a, 0, 1),
    b: (b + m) * 255,
    g: (g + m) * 255,
    r: (r + m) * 255,
  };
}

/** One sRGB channel, 0-1, off its transfer function and onto light. */
function linearize(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** One linear-light channel back onto sRGB's transfer function. */
function delinearize(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/**
 * A colour in OKLCH: what the readout says and what a host asking for a perceptual value gets.
 *
 * The matrices are Björn Ottosson's, which CSS Color 4 §10 adopts verbatim, so this and a browser's
 * own `oklch()` agree to within float noise.
 *
 * @param rgb The colour.
 * @returns Its lightness, chroma, hue and alpha.
 */
export function srgbToOklch(rgb: Rgb): Oklch {
  const r = linearize(clamp(rgb.r, 0, 255) / 255);
  const g = linearize(clamp(rgb.g, 0, 255) / 255);
  const b = linearize(clamp(rgb.b, 0, 255) / 255);
  const lCone = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mCone = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const sCone = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const l = 0.2104542553 * lCone + 0.793617785 * mCone - 0.0040720468 * sCone;
  const a = 1.9779984951 * lCone - 2.428592205 * mCone + 0.4505937099 * sCone;
  const bAxis = 0.0259040371 * lCone + 0.7827717662 * mCone - 0.808675766 * sCone;
  const chroma = Math.hypot(a, bAxis);
  return {
    a: clamp(rgb.a, 0, 1),
    c: chroma,
    h: chroma < 1e-6 ? 0 : ((Math.atan2(bAxis, a) * 180) / Math.PI + 360) % 360,
    l,
  };
}

/**
 * An OKLCH colour as sRGB, CLAMPED into the gamut per channel.
 *
 * Per-channel clamping is not gamut mapping and is not pretending to be: a chroma sRGB cannot hold
 * comes back as the nearest thing sRGB can draw, with its hue shifted. That is the honest answer
 * for this kit — the only OKLCH values it converts are ones it computed FROM an sRGB colour a
 * moment earlier, so the round trip is exact and the clamp is unreachable on every path the
 * elements take. It exists for `parseColor`, where a reader may type any three numbers at all.
 *
 * @param color The OKLCH colour.
 * @returns The sRGB colour.
 */
export function oklchToSrgb(color: Oklch): Rgb {
  const hue = (((color.h % 360) + 360) % 360) * (Math.PI / 180);
  const a = color.c * Math.cos(hue);
  const bAxis = color.c * Math.sin(hue);
  const lCone = (color.l + 0.3963377774 * a + 0.2158037573 * bAxis) ** 3;
  const mCone = (color.l - 0.1055613458 * a - 0.0638541728 * bAxis) ** 3;
  const sCone = (color.l - 0.0894841775 * a - 1.291485548 * bAxis) ** 3;
  const r = 4.0767416621 * lCone - 3.3077115913 * mCone + 0.2309699292 * sCone;
  const g = -1.2684380046 * lCone + 2.6097574011 * mCone - 0.3413193965 * sCone;
  const b = -0.0041960863 * lCone - 0.7034186147 * mCone + 1.707614701 * sCone;
  return {
    a: clamp(color.a, 0, 1),
    b: clamp(delinearize(b) * 255, 0, 255),
    g: clamp(delinearize(g) * 255, 0, 255),
    r: clamp(delinearize(r) * 255, 0, 255),
  };
}

/**
 * The `oklch()` spelling of a colour, rounded to what a reader can act on: lightness as a
 * percentage to one decimal, chroma to three, hue to one.
 *
 * @param color The OKLCH colour.
 * @returns The CSS function, with its alpha only when the colour is not opaque.
 */
export function formatOklch(color: Oklch): string {
  const body = `${(color.l * 100).toFixed(1)}% ${color.c.toFixed(3)} ${color.h.toFixed(1)}`;
  return color.a >= 1 ? `oklch(${body})` : `oklch(${body} / ${Number(color.a.toFixed(3))})`;
}

/**
 * WCAG 2.2's relative luminance, which is the sRGB definition and not OKLCH's lightness. The two
 * disagree, and the contrast criteria are written against this one.
 *
 * @param rgb The colour.
 * @returns Its relative luminance, 0 to 1.
 */
export function relativeLuminance(rgb: Rgb): number {
  const r = linearize(clamp(rgb.r, 0, 255) / 255);
  const g = linearize(clamp(rgb.g, 0, 255) / 255);
  const b = linearize(clamp(rgb.b, 0, 255) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The contrast ratio between two colours, 1 to 21, as SC 1.4.3 and 1.4.11 define it.
 *
 * Alpha is not composited: a ratio between two translucent colours is not defined without knowing
 * what is behind them, and the kit's one caller passes opaque colours.
 *
 * @param one A colour.
 * @param two The other colour.
 * @returns The ratio, with the lighter colour on top whichever order they arrived in.
 */
export function contrastRatio(one: Rgb, two: Rgb): number {
  const a = relativeLuminance(one);
  const b = relativeLuminance(two);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Pure black, for the contrast comparison below. */
const BLACK: Rgb = { a: 1, b: 0, g: 0, r: 0 };
/** Pure white, likewise. */
const WHITE: Rgb = { a: 1, b: 255, g: 255, r: 255 };

/**
 * Which ink a mark drawn ON this colour should use, decided by measuring both rather than by a
 * luminance threshold somebody once wrote down.
 *
 * This is SC 1.4.11 for the one mark the kit draws over a colour it does not choose: the tick on a
 * selected swatch. A fixed ink fails against half the gamut, and a threshold is a guess at the
 * answer this computes.
 *
 * @param rgb The colour the mark is drawn on.
 * @returns `"black"` or `"white"`, whichever has the greater ratio against it.
 */
export function preferredInk(rgb: Rgb): "black" | "white" {
  return contrastRatio(rgb, BLACK) >= contrastRatio(rgb, WHITE) ? "black" : "white";
}

/**
 * The ink a mark or a boundary drawn ON a colour should use, as a word a document can put straight
 * into a custom property, or `""` when the colour is not one this module can read.
 *
 * This is the `$src` door onto {@link preferredInk}: `jx-swatch` reaches it from its own document,
 * so a swatch works out its own tick and its own ring from its own `color` with no host, no group
 * and no sidecar writing into it. The empty answer is deliberate and is not a failure — a swatch
 * coloured `var(--jx-accent)` or `rebeccapurple` is a colour only the browser can resolve, and the
 * element falls back to the kit's border token rather than guessing at black.
 *
 * @param color The colour, as it was written.
 * @returns `"black"`, `"white"`, or `""`.
 */
export function inkOn(color: unknown): string {
  const parsed = typeof color === "string" ? parseColor(color) : null;
  return parsed ? preferredInk({ ...parsed, a: 1 }) : "";
}
