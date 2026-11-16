import { describe, expect, test } from "bun:test";
import {
  buildCspHeaders,
  collectCspSources,
  cspConfigErrors,
  emptyCspSources,
  hashOf,
  normalizeCspConfig,
  originOf,
} from "../src/site/csp.ts";

const collect = (html: string) => {
  const sources = emptyCspSources();
  collectCspSources(html, sources);
  return sources;
};

const policy = (html: string, config = {}) =>
  buildCspHeaders(collect(html), config)["Content-Security-Policy"] ?? "";

describe("originOf", () => {
  test("keeps only the origin of an absolute http(s) URL", () => {
    expect(originOf("https://cdn.example/a/b.js?v=1")).toBe("https://cdn.example");
    expect(originOf("http://cdn.example:8080/x")).toBe("http://cdn.example:8080");
  });

  test("relative, data: and malformed URLs contribute nothing", () => {
    for (const url of ["/assets/x.js", "./x.js", "data:image/png;base64,AA", ""]) {
      expect(originOf(url)).toBeNull();
    }
    // The absent case: an attribute the tag never carried.
    expect(originOf(/\bsrc="([^"]*)"/.exec("<script>")?.[1])).toBeNull();
  });
});

describe("hashOf", () => {
  // A hash covers the exact bytes between the tags — no trimming, no normalization.
  test("is the base64 SHA-256 of the exact source", () => {
    expect(hashOf("")).toBe("'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='");
    expect(hashOf(" x ")).not.toBe(hashOf("x"));
  });
});

describe("collectCspSources", () => {
  test("hashes an inline classic script", () => {
    const sources = collect("<script>alert(1)</script>");
    expect([...sources.scriptHashes]).toEqual([hashOf("alert(1)")]);
  });

  test("hashes an inline module and an import map", () => {
    const sources = collect(
      '<script type="module">import "x";</script><script type="importmap">{}</script>',
    );
    expect(sources.scriptHashes.size).toBe(2);
    expect(sources.scriptHashes.has(hashOf("{}"))).toBe(true);
  });

  /*
   * A `<script type="application/ld+json">` is a data block: the browser never executes it, CSP
   * never checks it, and a hash for it would authorize nothing. Confirmed in Chrome against an
   * enforced policy — the JSON-LD survived with no hash in the header.
   */
  test("ignores data blocks", () => {
    const sources = collect('<script type="application/ld+json">{"@type":"WebSite"}</script>');
    expect(sources.scriptHashes.size).toBe(0);
  });

  /*
   * The exception among non-executing types: an inline speculation rule set is refused under
   * `script-src` unless a hash admits it, so an unhashed one is dropped the moment CSP is on.
   */
  test("hashes an inline speculation rule set", () => {
    const rules = '{"prerender":[{"where":{"href_matches":"/*"}}]}';
    const sources = collect(`<script type="speculationrules">${rules}</script>`);
    expect([...sources.scriptHashes]).toEqual([hashOf(rules)]);
  });

  test("an external script contributes its origin, not a hash", () => {
    const sources = collect('<script src="https://plausible.io/js/x.js"></script>');
    expect([...sources.scriptOrigins]).toEqual(["https://plausible.io"]);
    expect(sources.scriptHashes.size).toBe(0);
  });

  test("a same-origin script contributes nothing — 'self' already covers it", () => {
    const sources = collect('<script type="module" src="/components/x.js"></script>');
    expect(sources.scriptOrigins.size).toBe(0);
    expect(sources.scriptHashes.size).toBe(0);
  });

  test("stylesheet, font, image and frame origins land in their own buckets", () => {
    const sources = collect(
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?x">' +
        '<link rel="preload" as="font" href="https://fonts.gstatic.com/f.woff2">' +
        '<img src="https://images.example/a.png">' +
        '<source srcset="https://images.example/a.avif 640w, https://cdn2.example/b.avif 1200w">' +
        '<iframe src="https://www.youtube.com/embed/x"></iframe>',
    );
    expect([...sources.styleOrigins]).toEqual(["https://fonts.googleapis.com"]);
    expect([...sources.fontOrigins]).toEqual(["https://fonts.gstatic.com"]);
    expect([...sources.imgOrigins].toSorted()).toEqual([
      "https://cdn2.example",
      "https://images.example",
    ]);
    expect([...sources.frameOrigins]).toEqual(["https://www.youtube.com"]);
  });

  test("single-quoted attributes are read too", () => {
    expect([...collect("<script src='https://a.example/x.js'></script>").scriptOrigins]).toEqual([
      "https://a.example",
    ]);
  });

  test("the same inline script on two pages yields one hash", () => {
    const sources = emptyCspSources();
    collectCspSources("<script>same()</script>", sources);
    collectCspSources("<script>same()</script>", sources);
    expect(sources.scriptHashes.size).toBe(1);
  });
});

describe("normalizeCspConfig", () => {
  test("off unless asked for", () => {
    expect(normalizeCspConfig({})).toBeNull();
    expect(normalizeCspConfig({ csp: false })).toBeNull();
  });

  test("the three spellings collapse to one shape", () => {
    expect(normalizeCspConfig({ csp: true })).toEqual({});
    expect(normalizeCspConfig({ csp: "report-only" })).toEqual({ mode: "report-only" });
    expect(normalizeCspConfig({ csp: { reportUri: "/r" } })).toEqual({ reportUri: "/r" });
  });
});

describe("buildCspHeaders", () => {
  test("a page with no inline scripts gets a policy of pure keywords", () => {
    expect(policy("<p>hi</p>")).toBe(
      "base-uri 'self'; default-src 'self'; font-src 'self'; form-action 'self'; " +
        "frame-ancestors 'self'; frame-src 'self'; img-src 'self' data:; object-src 'none'; " +
        "script-src 'self'; style-src 'self' 'unsafe-inline'",
    );
  });

  test("inline script hashes land in script-src", () => {
    expect(policy("<script>alert(1)</script>")).toContain(
      `script-src 'self' ${hashOf("alert(1)")}`,
    );
  });

  /*
   * `style-src` keeps `'unsafe-inline'` and no hashes, deliberately. The two cancel — a browser
   * ignores the keyword once a hash is present — so adding a partial set of style hashes would
   * turn a working page into a blank one.
   */
  test("style-src carries unsafe-inline and never a hash", () => {
    const value = policy("<style>p{color:red}</style>");
    expect(value).toContain("style-src 'self' 'unsafe-inline'");
    expect(/style-src[^;]*sha256/.test(value)).toBe(false);
  });

  test("frame-ancestors matches the X-Frame-Options emitted beside it", () => {
    expect(policy("<p>hi</p>")).toContain("frame-ancestors 'self'");
    const framing = (frameOptions: "DENY" | "SAMEORIGIN" | false) =>
      buildCspHeaders(emptyCspSources(), {}, frameOptions)["Content-Security-Policy"] ?? "";
    expect(framing("SAMEORIGIN")).toContain("frame-ancestors 'self'");
    expect(framing("DENY")).toContain("frame-ancestors 'none'");
    /* Switched off, the directive is left out: a browser that sees both obeys this one, so a
       default here would overrule the author who asked for no framing rule. */
    expect(framing(false)).not.toContain("frame-ancestors");
  });

  test("report-only changes the header name, not the policy", () => {
    const headers = buildCspHeaders(emptyCspSources(), { mode: "report-only" });
    expect(Object.keys(headers)).toEqual(["Content-Security-Policy-Report-Only"]);
  });

  // `report-to` names a group that only `Reporting-Endpoints` can define, so the two ship together
  // — and `report-uri`, deprecated in CSP3, is still the only one some browsers implement.
  test("reporting emits report-to, report-uri and the endpoint definition", () => {
    const headers = buildCspHeaders(emptyCspSources(), { reportUri: "https://r.example/csp" });
    expect(headers["Content-Security-Policy"]).toContain("report-to csp-endpoint");
    expect(headers["Content-Security-Policy"]).toContain("report-uri https://r.example/csp");
    expect(headers["Reporting-Endpoints"]).toBe('csp-endpoint="https://r.example/csp"');
  });

  test("a directive override replaces, and false removes", () => {
    const value =
      buildCspHeaders(emptyCspSources(), {
        directives: { "connect-src": "'self' https://api.example", "frame-src": false },
      })["Content-Security-Policy"] ?? "";
    expect(value).toContain("connect-src 'self' https://api.example");
    expect(value).not.toContain("frame-src");
  });

  test("collected origins reach their directives", () => {
    const value = policy(
      '<script src="https://plausible.io/x.js"></script>' +
        '<link rel="stylesheet" href="https://fonts.googleapis.com/c">',
    );
    expect(value).toContain("script-src 'self' https://plausible.io");
    expect(value).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
  });
});

describe("originOf — a URL the parser rejects", () => {
  // The scheme test is a cheap filter, not a parse: a string can pass it and still not be a URL.
  test("a well-schemed string that will not parse is null, not a throw", () => {
    expect(originOf("http://")).toBeNull();
    expect(originOf("https://")).toBeNull();
  });
});

describe("csp.sources — additive sources", () => {
  const hashed = "<script>go()</script>";
  const hash = hashOf("go()");
  const directive = (value: string, name: string) =>
    value
      .split("; ")
      .find((part) => part.startsWith(`${name} `))
      ?.slice(name.length + 1);

  test("appends after the derived sources and keeps the generated hashes", () => {
    const value = policy(hashed, {
      sources: { "script-src": ["https://challenges.cloudflare.com", "https://static.example"] },
    });
    expect(directive(value, "script-src")).toBe(
      `'self' ${hash} https://challenges.cloudflare.com https://static.example`,
    );
  });

  test("appends after collected origins, in the order written", () => {
    const value = policy('<script src="https://plausible.io/x.js"></script>', {
      sources: { "script-src": "https://a.example https://b.example" },
    });
    expect(directive(value, "script-src")).toBe(
      "'self' https://plausible.io https://a.example https://b.example",
    );
  });

  test("a string and a one-element array mean the same, and duplicates are dropped", () => {
    const sources = { "frame-src": "https://x.example https://x.example 'self'" };
    const one = policy("", { sources });
    expect(directive(one, "frame-src")).toBe("'self' https://x.example");
    expect(policy("", { sources: { "frame-src": ["https://x.example", "'self'"] } })).toBe(one);
  });

  test("a source the directive already carries from a collected origin is not repeated", () => {
    const value = policy('<script src="https://plausible.io/x.js"></script>', {
      sources: { "script-src": "https://plausible.io" },
    });
    expect(directive(value, "script-src")).toBe("'self' https://plausible.io");
  });

  test("the result does not depend on how many times a build collects the same page", () => {
    const sources = { "script-src": ["https://a.example"] };
    expect(policy(hashed + hashed, { sources })).toBe(policy(hashed, { sources }));
  });

  test("a directive the policy lacks is created from default-src", () => {
    const value = policy("", { sources: { "connect-src": "https://api.example" } });
    expect(directive(value, "connect-src")).toBe("'self' https://api.example");
  });

  test("the fallback reads the default-src the author set", () => {
    const value = policy("", {
      directives: { "default-src": "'self' https://cdn.example" },
      sources: { "media-src": "https://m.example" },
    });
    expect(directive(value, "media-src")).toBe("'self' https://cdn.example https://m.example");
  });

  test("a directive follows its own fallback chain, not default-src alone", () => {
    const value = policy("", { sources: { "script-src-elem": "https://e.example" } });
    expect(directive(value, "script-src-elem")).toBe("'self' https://e.example");
    const styled = policy("", { sources: { "style-src-attr": "https://s.example" } });
    expect(directive(styled, "style-src-attr")).toBe("'self' 'unsafe-inline' https://s.example");
    const worker = policy("", { sources: { "worker-src": "blob:" } });
    expect(directive(worker, "worker-src")).toBe("'self' blob:");
  });

  test("a directive that does not fall back is created from the sources alone", () => {
    const value = policy("", { sources: { "report-uri": "https://r.example", sandbox: "x" } });
    expect(directive(value, "report-uri")).toBe("https://r.example");
    expect(directive(value, "sandbox")).toBe("x");
  });

  test("'none' gives way to an added source, since a browser would ignore it", () => {
    const value =
      buildCspHeaders(
        emptyCspSources(),
        {
          sources: {
            "frame-ancestors": "https://parent.example",
            "object-src": "https://o.example",
          },
        },
        "DENY",
      )["Content-Security-Policy"] ?? "";
    expect(directive(value, "frame-ancestors")).toBe("https://parent.example");
    expect(directive(value, "object-src")).toBe("https://o.example");
  });

  test("it creates frame-ancestors when frameOptions: false left it out", () => {
    const value =
      buildCspHeaders(
        emptyCspSources(),
        { sources: { "frame-ancestors": "https://parent.example" } },
        false,
      )["Content-Security-Policy"] ?? "";
    expect(directive(value, "frame-ancestors")).toBe("https://parent.example");
  });

  test("directive names are matched without regard to case, and empty entries add nothing", () => {
    const value = policy("", { sources: { "Connect-Src": "https://api.example", "font-src": [] } });
    expect(directive(value, "connect-src")).toBe("'self' https://api.example");
    expect(directive(value, "font-src")).toBe("'self'");
  });

  test("a directive removed with false stays removed when something else names no sources", () => {
    const value = policy("", { directives: { "frame-src": false } });
    expect(value).not.toContain("frame-src");
  });

  test("a source that is only whitespace adds nothing and creates nothing", () => {
    const value = policy("", { sources: { "connect-src": "  " } });
    expect(value).not.toContain("connect-src");
  });

  test("composes with directives for different directives", () => {
    const value = policy(hashed, {
      directives: { "frame-ancestors": "'none'", "img-src": "'self' https://img.example" },
      sources: { "script-src": "https://challenges.cloudflare.com" },
    });
    expect(directive(value, "frame-ancestors")).toBe("'none'");
    expect(directive(value, "img-src")).toBe("'self' https://img.example");
    expect(directive(value, "script-src")).toBe(`'self' ${hash} https://challenges.cloudflare.com`);
  });

  test("a policy with both orders its directives the same however the config is written", () => {
    const a = policy("", {
      sources: { "frame-src": "https://f.example", "connect-src": "https://c.example" },
    });
    const b = policy("", {
      sources: { "connect-src": "https://c.example", "frame-src": "https://f.example" },
    });
    expect(a).toBe(b);
  });
});

describe("cspConfigErrors", () => {
  test("a config without sources has none", () => {
    expect(cspConfigErrors({})).toEqual([]);
    expect(cspConfigErrors({ directives: { "frame-src": false } })).toEqual([]);
  });

  test("a directive in both directives and sources is refused, whatever the case", () => {
    for (const replacement of ["'self' https://a.example", false] as const) {
      const errors = cspConfigErrors({
        directives: { "frame-src": replacement },
        sources: { "Frame-Src": "https://b.example" },
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("replaces it wholesale");
    }
  });

  test("a source that would split the directive is refused", () => {
    const errors = cspConfigErrors({
      sources: { "script-src": ["https://a.example; object-src *", "https://b.example,"] },
    });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('"https://a.example;"');
  });

  test("a name that is not a directive name is refused", () => {
    expect(cspConfigErrors({ sources: { "script src": "https://a.example" } })[0]).toContain(
      "not a CSP directive name",
    );
  });
});
