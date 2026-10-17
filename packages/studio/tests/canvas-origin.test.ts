import { installMockPlatform } from "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import {
  canvasBaseOrigin,
  documentBase,
  hostResolveToken,
  loopbackAssetSrc,
} from "../src/canvas/canvas-origin";

/* SAFETY: harness imports with-dom first, whose GlobalRegistrator.register() copies happy-dom's
   window members onto globalThis, `happyDOM` (the DetachedWindowAPI that owns setURL) among them. */
const { happyDOM } = globalThis as typeof globalThis & {
  happyDOM: { setURL: (url: string) => void };
};
happyDOM.setURL("http://localhost:3000/");

afterEach(() => {
  globalThis.__jxPlatform = undefined;
});

describe("canvasBaseOrigin", () => {
  test("falls back to location.origin when no platform is registered", () => {
    globalThis.__jxPlatform = undefined;
    expect(canvasBaseOrigin()).toBe(location.origin);
  });

  test("falls back to location.origin when the platform sets no canvasUrl", () => {
    installMockPlatform();
    expect(canvasBaseOrigin()).toBe(location.origin);
  });

  test("is IDENTITY for a relative canvasUrl (same-origin path resolves to location.origin)", () => {
    installMockPlatform({ canvasUrl: "/__studio__/canvas.html" });
    expect(canvasBaseOrigin()).toBe(location.origin);
  });

  test("returns the loopback origin for an absolute cross-origin canvasUrl", () => {
    installMockPlatform({ canvasUrl: "http://127.0.0.1:54321/__studio__/canvas.html?win=2" });
    expect(canvasBaseOrigin()).toBe("http://127.0.0.1:54321");
  });
});

describe("hostResolveToken", () => {
  test("is null with no platform, and with no canvasUrl", () => {
    globalThis.__jxPlatform = undefined;
    expect(hostResolveToken()).toBeNull();
    installMockPlatform();
    expect(hostResolveToken()).toBeNull();
  });

  test("reads the rpcToken off a same-origin canvas URL", () => {
    installMockPlatform({ canvasUrl: "/__studio__/canvas.html?rpcToken=t%201" });
    expect(hostResolveToken()).toBe("t 1");
  });

  test("is null for a same-origin canvas URL that carries none", () => {
    installMockPlatform({ canvasUrl: "/__studio__/canvas.html" });
    expect(hostResolveToken()).toBeNull();
  });

  test("is null for a cross-origin canvas, whose proxy the shell's fetches never reach", () => {
    installMockPlatform({ canvasUrl: "http://127.0.0.1:54321/__studio__/canvas.html?rpcToken=t" });
    expect(hostResolveToken()).toBeNull();
  });
});

describe("loopbackAssetSrc", () => {
  test("returns the input path unchanged when no platform / no canvasUrl is registered", () => {
    globalThis.__jxPlatform = undefined;
    expect(loopbackAssetSrc("/public/logo.png")).toBe("/public/logo.png");
  });

  test("returns the input unchanged for a same-origin relative canvasUrl (guard: origin === location.origin)", () => {
    installMockPlatform({ canvasUrl: "/__studio__/canvas.html" });
    expect(loopbackAssetSrc("/public/logo.png")).toBe("/public/logo.png");
  });

  test("rewrites to the loopback origin for an absolute cross-origin canvasUrl (leading / normalized)", () => {
    installMockPlatform({ canvasUrl: "http://127.0.0.1:54321/__studio__/canvas.html" });
    expect(loopbackAssetSrc("/public/logo.png")).toBe("http://127.0.0.1:54321/public/logo.png");
  });

  test("normalizes a leading './' and a bare relative path to a single slash", () => {
    installMockPlatform({ canvasUrl: "http://127.0.0.1:54321/__studio__/canvas.html" });
    expect(loopbackAssetSrc("./public/logo.png")).toBe("http://127.0.0.1:54321/public/logo.png");
    expect(loopbackAssetSrc("logo.png")).toBe("http://127.0.0.1:54321/logo.png");
  });

  test("leaves already-absolute data/blob/http/views urls untouched even when a loopback origin is set", () => {
    installMockPlatform({ canvasUrl: "http://127.0.0.1:54321/__studio__/canvas.html" });
    expect(loopbackAssetSrc("data:image/png;base64,AA==")).toBe("data:image/png;base64,AA==");
    expect(loopbackAssetSrc("blob:http://x/abc")).toBe("blob:http://x/abc");
    expect(loopbackAssetSrc("http://example.com/pic.png")).toBe("http://example.com/pic.png");
    expect(loopbackAssetSrc("views://studio/pic.png")).toBe("views://studio/pic.png");
  });
});

/**
 * Where the canvas fetches project files from.
 *
 * The renderer resolves a component `$ref` with `fetch(url).then(r => r.json())` from inside the
 * iframe, so a project file has to exist at a URL — `readFile` is not reachable from there. Hosts
 * that serve the tree from their web root need no declaration; a host whose `projectRoot` is an
 * identifier rather than a path must make one, or every `$ref` addresses nothing.
 */
describe("documentBase", () => {
  test("defaults to the canvas origin plus the project root", () => {
    installMockPlatform();
    expect(documentBase("examples/site-demo")).toBe(`${location.origin}/examples/site-demo/`);
  });

  test("omits the root segment when there is no root", () => {
    installMockPlatform();
    expect(documentBase("")).toBe(`${location.origin}/`);
    expect(documentBase()).toBe(`${location.origin}/`);
  });

  /**
   * The result must be usable as `new URL(path, base)`, which is the ONLY thing the caller does
   * with it. Asserting the returned string instead is what let a root-relative base ship: the
   * caller threw `Failed to construct 'URL': Invalid base URL` and the canvas did not mount at all
   * — not a failed fetch, a blank canvas with an error card.
   *
   * The other test here made it worse by prefixing `http://x` to the result by hand, writing the
   * missing absolutisation into the test and hiding the very defect it was covering. So every case
   * below composes a real path through the real API.
   */
  const compose = (path: string) => new URL(path, documentBase("acme/site@main")).href;

  test("a ROOT-RELATIVE declared base is absolutised — the shape Jx Cloud declares", () => {
    installMockPlatform({ documentBaseUrl: "/api/v1/p/acme/site/main/studio/raw/" });
    expect(compose("pages/index.md")).toBe(
      `${location.origin}/api/v1/p/acme/site/main/studio/raw/pages/index.md`,
    );
  });

  test("and a component $ref resolves off it, which is what the canvas actually fetches", () => {
    installMockPlatform({ documentBaseUrl: "/api/v1/p/acme/site/main/studio/raw/" });
    const doc = new URL("pages/index.md", documentBase("acme/site@main"));
    expect(new URL("../components/co-nav.json", doc).href).toBe(
      `${location.origin}/api/v1/p/acme/site/main/studio/raw/components/co-nav.json`,
    );
  });

  test("the project root is NOT appended to a declared base", () => {
    /* The declared base already addresses one project, so appending the root key on top of it
       would address a directory named "acme/site@main" inside that project. */
    installMockPlatform({ documentBaseUrl: "/api/v1/p/acme/site/main/studio/raw/" });
    expect(compose("pages/index.md")).not.toContain("acme/site@main");
  });

  test("an ALREADY-ABSOLUTE declared base passes through", () => {
    // A platform may serve project files from another origin entirely.
    installMockPlatform({ documentBaseUrl: "https://files.example.com/proj/" });
    expect(compose("pages/index.md")).toBe("https://files.example.com/proj/pages/index.md");
  });

  test("a declared base missing its trailing slash still composes", () => {
    // Without the slash `new URL` drops the last segment, so "raw" would be lost.
    installMockPlatform({ documentBaseUrl: "/api/v1/p/acme/site/main/studio/raw" });
    expect(compose("pages/index.md")).toBe(
      `${location.origin}/api/v1/p/acme/site/main/studio/raw/pages/index.md`,
    );
  });

  test("the DEFAULT base composes too — it is used the same way", () => {
    installMockPlatform();
    expect(new URL("pages/index.md", documentBase("examples/site-demo")).href).toBe(
      `${location.origin}/examples/site-demo/pages/index.md`,
    );
  });

  test("an unregistered platform does not throw — gates render before registration", () => {
    globalThis.__jxPlatform = undefined;
    expect(documentBase("root")).toBe(`${location.origin}/root/`);
  });
});
