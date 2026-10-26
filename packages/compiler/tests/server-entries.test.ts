/**
 * Server-entries.test.ts — where the site worker's server entries come from, and which one an
 * export name serves.
 *
 * Pure functions over paths under a fake root: nothing here touches the disk. The end-to-end proof
 * that the worker answers every collected entry is in `site-build.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  dedupeServerEntries,
  documentServerEntries,
  resolveServerSrc,
} from "../src/site/server-entries";
import type { ServerEntryRecord } from "../src/site/server-entries";

const ROOT = resolve("/srv/site");

/** A server entry the way a document declares it. */
function serverFn(exportName: string, src: string) {
  return { $export: exportName, $src: src, timing: "server" };
}

describe("resolveServerSrc", () => {
  test("resolves ./ and ../ against the declaring directory to a ./ project-relative path", () => {
    expect(resolveServerSrc("./x.server.js", resolve(ROOT, "pages/blog"), ROOT)).toBe(
      "./pages/blog/x.server.js",
    );
    expect(resolveServerSrc("../lib/y.js", resolve(ROOT, "layouts"), ROOT)).toBe("./lib/y.js");
  });

  test("keeps a bare specifier as written", () => {
    expect(resolveServerSrc("@acme/fns/server", resolve(ROOT, "pages/blog"), ROOT)).toBe(
      "@acme/fns/server",
    );
  });
});

describe("documentServerEntries", () => {
  test("records one entry per state key with its document's project-relative path", () => {
    const doc = {
      children: [
        { state: { nested: serverFn("loadNested", "./nested.server.js") }, tagName: "section" },
      ],
      state: {
        count: 0,
        first: serverFn("loadData", "./api.server.js"),
        second: serverFn("loadData", "../shared/api.server.js"),
      },
    };
    expect(documentServerEntries(doc, resolve(ROOT, "pages/blog/index.json"), ROOT)).toEqual([
      {
        declaredIn: "pages/blog/index.json",
        exportName: "loadData",
        src: "./pages/blog/api.server.js",
      },
      {
        declaredIn: "pages/blog/index.json",
        exportName: "loadData",
        src: "./pages/shared/api.server.js",
      },
      {
        declaredIn: "pages/blog/index.json",
        exportName: "loadNested",
        src: "./pages/blog/nested.server.js",
      },
    ]);
  });

  test("project.json's state resolves against the project root", () => {
    const records = documentServerEntries(
      { state: { siteStats: serverFn("siteStats", "./lib/stats.server.js") } },
      resolve(ROOT, "project.json"),
      ROOT,
    );
    expect(records).toEqual([
      { declaredIn: "project.json", exportName: "siteStats", src: "./lib/stats.server.js" },
    ]);
  });

  test("a document with no server entry yields none", () => {
    expect(
      documentServerEntries({ state: { n: 1 } }, resolve(ROOT, "pages/index.json"), ROOT),
    ).toEqual([]);
  });
});

describe("dedupeServerEntries", () => {
  const record = (exportName: string, src: string, declaredIn: string): ServerEntryRecord => ({
    declaredIn,
    exportName,
    src,
  });

  test("keeps one entry for one module declared by several documents, silently", () => {
    const { entries, errors } = dedupeServerEntries([
      record("trackVisit", "./layouts/visits.server.js", "layouts/base.json"),
      record("trackVisit", "./layouts/visits.server.js", "layouts/base.json"),
      record("trackVisit", "./layouts/visits.server.js", "layouts/docs.json"),
    ]);
    expect(entries).toEqual([{ exportName: "trackVisit", src: "./layouts/visits.server.js" }]);
    expect(errors).toEqual([]);
  });

  test("reports two modules claiming one export once, naming each module and a declaring document, and keeps the first", () => {
    const { entries, errors } = dedupeServerEntries([
      record("sendForm", "./components/contact.server.js", "components/test-contact.json"),
      record("sendForm", "./pages/form.server.js", "pages/index.json"),
      record("sendForm", "./pages/form.server.js", "pages/about.json"),
      record("sendForm", "./components/contact.server.js", "components/other-card.json"),
    ]);
    expect(entries).toEqual([{ exportName: "sendForm", src: "./components/contact.server.js" }]);
    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error).toContain('"sendForm"');
    expect(error).toContain(
      "./components/contact.server.js (declared in components/test-contact.json)",
    );
    expect(error).toContain("./pages/form.server.js (declared in pages/index.json)");
    // The first document naming each module, not every one of them.
    expect(error).not.toContain("pages/about.json");
    expect(error).not.toContain("components/other-card.json");
    expect(error).toContain("/_jx/server/sendForm");
  });

  test("keeps first-seen order across export names", () => {
    const { entries, errors } = dedupeServerEntries([
      record("sendForm", "./components/contact.server.js", "components/test-contact.json"),
      record("siteStats", "./lib/stats.server.js", "project.json"),
      record("loadData", "./pages/api.server.js", "pages/index.json"),
      record("sendForm", "./components/contact.server.js", "components/test-contact.json"),
      record("trackVisit", "./layouts/visits.server.js", "layouts/base.json"),
    ]);
    expect(entries.map((entry) => entry.exportName)).toEqual([
      "sendForm",
      "siteStats",
      "loadData",
      "trackVisit",
    ]);
    expect(errors).toEqual([]);
  });
});
