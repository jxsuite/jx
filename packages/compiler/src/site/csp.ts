/**
 * Content-Security-Policy, derived from the pages the build actually produced.
 *
 * A static site cannot use nonces — a nonce has to be fresh per response, and these responses are
 * files — so hashes are the only route to a strict `script-src`. That works here because the inline
 * scripts Jx emits are **constants**: the colour-scheme pre-paint script is one fixed IIFE, and the
 * import map is the same two-entry object on every page of a build. A handful of hashes therefore
 * covers a whole site, which matters because Cloudflare Pages caps a `_headers` file at roughly a
 * hundred rules — a per-page policy would be unusable past a small site.
 *
 * Sources are collected by **scanning finished HTML** rather than by asking each emission site what
 * it emitted. There are seven places that can put a `<script>` on a page and a hash that does not
 * match the shipped bytes is worse than no policy at all, so the scan runs on the exact string
 * about to be written to disk.
 *
 * @docs framework/site/deployment
 */

import { createHash } from "node:crypto";
import type { CspConfig, HeadersConfig } from "@jxsuite/schema/types";

/**
 * The headers a policy adds: the policy itself under its enforcing or report-only name, and the
 * endpoint group its `report-to` names when reporting is on.
 */
export interface CspHeaders {
  "Content-Security-Policy"?: string;
  "Content-Security-Policy-Report-Only"?: string;
  "Reporting-Endpoints"?: string;
}

/** Everything a page contributed to the policy. Accumulated across the whole build. */
export interface CspSources {
  /** `'sha256-…'` for each distinct inline script. */
  scriptHashes: Set<string>;
  scriptOrigins: Set<string>;
  styleOrigins: Set<string>;
  imgOrigins: Set<string>;
  fontOrigins: Set<string>;
  frameOrigins: Set<string>;
}

export function emptyCspSources(): CspSources {
  return {
    fontOrigins: new Set(),
    frameOrigins: new Set(),
    imgOrigins: new Set(),
    scriptHashes: new Set(),
    scriptOrigins: new Set(),
    styleOrigins: new Set(),
  };
}

/**
 * Script `type` values the browser executes, and therefore the ones `script-src` governs.
 *
 * An empty or absent type is classic JavaScript. Almost everything else — `application/ld+json`
 * above all — is a _data block_: the browser never executes it, CSP never checks it, and hashing it
 * would add a hash that authorizes nothing. Verified in Chrome against an enforced policy.
 */
const EXECUTABLE_TYPES = new Set([
  "",
  "module",
  "importmap",
  "text/javascript",
  "module-shim",
  /* Not executed, and governed all the same: an inline speculation rule set is refused under
     `script-src` unless a hash, a nonce or `'inline-speculation-rules'` admits it, because a rule
     set decides what the page fetches and prerenders. Unhashed, an author's rules were silently
     dropped the moment the policy was switched on. */
  "speculationrules",
]);

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const LINK_TAG = /<link\b([^>]*)>/gi;
const IMG_TAG = /<img\b([^>]*)>/gi;
const SOURCE_TAG = /<source\b([^>]*)>/gi;
const IFRAME_TAG = /<iframe\b([^>]*)>/gi;
const FONT_EXTENSION = /\.(woff2?|ttf|otf|eot)(\?|#|$)/i;

/** Read one double- or single-quoted attribute out of a raw tag attribute string. */
function attr(attrs: string, name: string): string | undefined {
  // Group 2 is the double-quoted value and group 3 the single-quoted one; only one participates.
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(attrs);
  return match?.[2] ?? match?.[3];
}

/** The origin of an absolute http(s) URL, or null for anything relative, `data:` or malformed. */
export function originOf(url: string | undefined): string | null {
  if (url === undefined || !/^https?:\/\//i.test(url)) {
    return null;
  }
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** The CSP source expression for an inline script's exact bytes. */
export function hashOf(source: string): string {
  return `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`;
}

/**
 * Scan one finished page and add what it needs to the accumulated sources.
 *
 * @param {string} html - The exact bytes about to be written
 * @param {CspSources} into
 */
export function collectCspSources(html: string, into: CspSources): void {
  for (const match of html.matchAll(SCRIPT_TAG)) {
    const attrs = match[1] ?? "";
    const src = attr(attrs, "src");
    const type = (attr(attrs, "type") ?? "").trim().toLowerCase();
    if (src !== undefined) {
      const origin = originOf(src);
      if (origin) {
        into.scriptOrigins.add(origin);
      }
      continue;
    }
    if (EXECUTABLE_TYPES.has(type)) {
      into.scriptHashes.add(hashOf(match[2] ?? ""));
    }
  }

  for (const match of html.matchAll(LINK_TAG)) {
    const attrs = match[1] ?? "";
    const rel = (attr(attrs, "rel") ?? "").toLowerCase();
    const href = attr(attrs, "href");
    const origin = originOf(href);
    if (!origin) {
      continue;
    }
    if (rel.includes("stylesheet")) {
      into.styleOrigins.add(origin);
    }
    if (FONT_EXTENSION.test(href ?? "") || (attr(attrs, "as") ?? "") === "font") {
      into.fontOrigins.add(origin);
    }
  }

  for (const [tag, group] of [
    [IMG_TAG, into.imgOrigins],
    [SOURCE_TAG, into.imgOrigins],
    [IFRAME_TAG, into.frameOrigins],
  ] as const) {
    for (const match of html.matchAll(tag)) {
      const attrs = match[1] ?? "";
      for (const value of [attr(attrs, "src"), ...srcsetUrls(attr(attrs, "srcset"))]) {
        const origin = originOf(value);
        if (origin) {
          group.add(origin);
        }
      }
    }
  }
}

/** The URLs in a `srcset`, without their descriptors. */
function srcsetUrls(srcset: string | undefined): string[] {
  return srcset === undefined
    ? []
    : srcset
        .split(",")
        .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
        .filter(Boolean);
}

/** `build.headers.security.frameOptions`: a header value, or `false` for no framing rule at all. */
export type FrameOptions = NonNullable<HeadersConfig["security"]>["frameOptions"];

/**
 * The `frame-ancestors` source each `frameOptions` setting means. `false` is the author saying the
 * site may be framed by anyone, so the directive is left out rather than set to `'self'`, which
 * would overrule them: where both are present a browser ignores `X-Frame-Options`.
 */
function frameAncestors(frameOptions: FrameOptions): string | false {
  if (frameOptions === false) {
    return false;
  }
  return frameOptions === "DENY" ? "'none'" : "'self'";
}

/** Normalize the config's three spellings into one shape, or null when CSP is off. */
export function normalizeCspConfig(security: HeadersConfig["security"]): CspConfig | null {
  const csp = security?.csp;
  if (csp === undefined || csp === false) {
    return null;
  }
  if (csp === true) {
    return {};
  }
  if (csp === "report-only") {
    return { mode: "report-only" };
  }
  return csp;
}

/**
 * The directive a browser consults when a fetch directive is absent, nearest first. Only fetch
 * directives fall back at all: `frame-ancestors`, `base-uri`, `form-action` and the reporting
 * directives do not, and giving them `default-src`'s sources would invent a policy the author never
 * wrote.
 */
const FALLBACKS = new Map<string, string[]>([
  ["child-src", ["default-src"]],
  ["connect-src", ["default-src"]],
  ["font-src", ["default-src"]],
  ["frame-src", ["child-src", "default-src"]],
  ["img-src", ["default-src"]],
  ["manifest-src", ["default-src"]],
  ["media-src", ["default-src"]],
  ["object-src", ["default-src"]],
  ["prefetch-src", ["default-src"]],
  ["script-src", ["default-src"]],
  ["script-src-attr", ["script-src", "default-src"]],
  ["script-src-elem", ["script-src", "default-src"]],
  ["style-src", ["default-src"]],
  ["style-src-attr", ["style-src", "default-src"]],
  ["style-src-elem", ["style-src", "default-src"]],
  ["worker-src", ["child-src", "script-src", "default-src"]],
]);

/** A `sources` entry as source expressions: a string may carry several, space separated. */
function sourceTokens(value: string | string[]): string[] {
  return (Array.isArray(value) ? value : [value])
    .flatMap((entry) => entry.split(/\s+/))
    .filter(Boolean);
}

/**
 * What is wrong with `config.sources`, as build errors. A source containing `;` or `,` would end
 * the directive early and smuggle in another, so it is refused rather than emitted. A directive
 * named in both `sources` and `directives` is refused too: the replacement is wholesale, so the
 * sources would be silently dropped or silently kept, and either reads as the other.
 */
export function cspConfigErrors(config: CspConfig): string[] {
  const errors: string[] = [];
  const replaced = new Set(Object.keys(config.directives ?? {}).map((name) => name.toLowerCase()));
  for (const [name, value] of Object.entries(config.sources ?? {})) {
    const path = `build.headers.security.csp.sources["${name}"]`;
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(name)) {
      errors.push(`${path}: not a CSP directive name.`);
    }
    if (replaced.has(name.toLowerCase())) {
      errors.push(
        `${path}: csp.directives also sets "${name}" and replaces it wholesale, so put the ` +
          "sources in that string, or remove one of the two.",
      );
    }
    for (const token of sourceTokens(value)) {
      if (/[;,]/.test(token)) {
        errors.push(`${path}: "${token}" contains ";" or "," and would split the directive.`);
      }
    }
  }
  return errors;
}

/**
 * Append `config.sources` to the computed directives, in place.
 *
 * A source already in the directive is skipped, comparing exactly because a hash is case-sensitive.
 * `'none'` is dropped when anything is added: next to another source a browser ignores it, so
 * keeping it would only make the policy read as stricter than it is.
 */
function appendSources(directives: Record<string, string | false>, config: CspConfig): void {
  const replaced = new Set(Object.keys(config.directives ?? {}).map((name) => name.toLowerCase()));
  for (const [rawName, value] of Object.entries(config.sources ?? {})) {
    const name = rawName.toLowerCase();
    const added = sourceTokens(value);
    if (replaced.has(name) || added.length === 0) {
      continue;
    }
    let base = directives[name];
    if (base === undefined || base === false) {
      base = "";
      for (const fallback of FALLBACKS.get(name) ?? []) {
        const inherited = directives[fallback];
        if (inherited !== undefined && inherited !== false) {
          base = inherited;
          break;
        }
      }
    }
    const merged = base.split(/\s+/).filter(Boolean);
    for (const token of added) {
      if (!merged.includes(token)) {
        merged.push(token);
      }
    }
    directives[name] = merged.filter((token) => token !== "'none'").join(" ");
  }
}

/**
 * Build the policy. Returns the headers to add, which is more than one when reporting is on:
 * `report-to` names an endpoint group that `Reporting-Endpoints` has to define.
 *
 * `style-src` carries `'unsafe-inline'` and always will until the style pipeline changes. Every
 * page has a generated `<style>` block whose content is per-page, so hashing them would put one
 * hash per page into a site-wide header, and per-element `style=` attributes have no hash form at
 * all. Both are recorded as a divergence rather than papered over — and note that a hash and
 * `'unsafe-inline'` in the same directive cancel: the browser ignores the keyword, so a partial job
 * here would be worse than an honest one.
 *
 * @param {CspSources} sources
 * @param {CspConfig} config
 * @returns {CspHeaders}
 */
export function buildCspHeaders(
  sources: CspSources,
  config: CspConfig,
  frameOptions: FrameOptions = "SAMEORIGIN",
): CspHeaders {
  const list = (fixed: string[], origins: Set<string>) => [...fixed, ...origins].join(" ");

  // The computed directives, in the same shape as the overrides `config.directives` merges in.
  const directives: NonNullable<CspConfig["directives"]> = {
    "base-uri": "'self'",
    "default-src": "'self'",
    "font-src": list(["'self'"], sources.fontOrigins),
    "form-action": "'self'",
    // Follows the `X-Frame-Options` emitted beside it; two headers disagreeing about framing is a
    // Worse outcome than either answer, and `frame-ancestors` is the one a browser obeys.
    "frame-ancestors": frameAncestors(frameOptions),
    "frame-src": list(["'self'"], sources.frameOrigins),
    "img-src": list(["'self'", "data:"], sources.imgOrigins),
    "object-src": "'none'",
    "script-src": list(["'self'", ...[...sources.scriptHashes].toSorted()], sources.scriptOrigins),
    "style-src": list(["'self'", "'unsafe-inline'"], sources.styleOrigins),
  };

  if (config.reportUri !== undefined && config.reportUri !== "") {
    directives["report-to"] = "csp-endpoint";
    // Deprecated in CSP3 and still the only one some browsers implement, so both are emitted.
    directives["report-uri"] = config.reportUri;
  }

  for (const [name, value] of Object.entries<string | false>(config.directives ?? {})) {
    directives[name] = value;
  }
  /*
   * After the overrides, so a fallback reads the `default-src` the author actually set. A directive
   * in `directives` is skipped: `cspConfigErrors` already refused the pair.
   */
  appendSources(directives, config);

  const policy = Object.entries(directives)
    .filter(([, value]) => value !== false && value !== "")
    .toSorted(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, value]) => `${name} ${String(value)}`)
    .join("; ");

  const headers: CspHeaders =
    config.mode === "report-only"
      ? { "Content-Security-Policy-Report-Only": policy }
      : { "Content-Security-Policy": policy };
  if (config.reportUri !== undefined && config.reportUri !== "") {
    headers["Reporting-Endpoints"] = `csp-endpoint="${config.reportUri}"`;
  }
  return headers;
}
