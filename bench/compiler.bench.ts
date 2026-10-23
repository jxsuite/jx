import { readFileSync } from "node:fs";
import { bench, describe } from "vitest";
import { compileStaticPage } from "../packages/compiler/src/targets/compile-static.ts";
import type { JxDocument } from "@jxsuite/schema/types";

/** Read a committed example document, relative to this file. */
function loadDoc(path: string): JxDocument {
  /* SAFETY: the examples are validated against the Jx document schema by `schema:validate-all`, so
     each parsed file is a JxDocument. */
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as JxDocument;
}

const examplesPage = loadDoc("../examples/pages/index.json");

/** A stateful component, compiled with its dynamic subtrees emitted as island modules. */
const counterPage = loadDoc("../examples/components/counter.json");

/** A synthetic static page: 200 styled cards, each a heading, a paragraph and a link. */
const largePage: JxDocument = {
  children: Array.from({ length: 200 }, (_, i) => ({
    children: [
      { tagName: "h2", textContent: `Card ${i}` },
      { tagName: "p", textContent: `Body text for card number ${i}.` },
      { attributes: { href: `/cards/${i}` }, tagName: "a", textContent: "Read more" },
    ],
    style: { ":hover": { boxShadow: "0 2px 4px #0003" }, borderRadius: "8px", padding: "1rem" },
    tagName: "article",
  })),
  tagName: "main",
};

const opts = { title: "Bench" };

describe("compiler/static", () => {
  bench("compileStaticPage examples index", () => {
    compileStaticPage(examplesPage, opts);
  });

  bench("compileStaticPage counter islands", () => {
    compileStaticPage(counterPage, opts);
  });

  bench("compileStaticPage 200 cards", () => {
    compileStaticPage(largePage, opts);
  });
});
