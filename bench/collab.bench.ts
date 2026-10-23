import { bench, describe } from "vitest";
import { deepEqual, diffDocs } from "@jxsuite/collab/diff-core";
import type { JxMutableNode } from "@jxsuite/schema/types";

const section = (i: number, text: string): JxMutableNode => ({
  children: [
    { tagName: "h3", textContent: `Item ${i}` },
    { tagName: "p", textContent: text },
  ],
  style: { padding: "1rem" },
  tagName: "section",
});

const makeDoc = (count: number, edit: (i: number) => string): JxMutableNode => ({
  children: Array.from({ length: count }, (_, i) => section(i, edit(i))),
  tagName: "main",
});

const base = makeDoc(200, (i) => `Paragraph ${i}`);
const same = makeDoc(200, (i) => `Paragraph ${i}`);
const edited = makeDoc(200, (i) => (i % 10 === 0 ? `Edited ${i}` : `Paragraph ${i}`));
const inserted: JxMutableNode = {
  children: [
    ...Array.from({ length: 100 }, (_, i) => section(i, `Paragraph ${i}`)),
    { tagName: "hr" },
    ...Array.from({ length: 100 }, (_, i) => section(i + 100, `Paragraph ${i + 100}`)),
  ],
  tagName: "main",
};

describe("collab/diff", () => {
  bench("deepEqual identical 200-section docs", () => {
    deepEqual(base, same);
  });

  bench("diffDocs text edits in 200 sections", () => {
    diffDocs(base, edited, { maxOps: 10_000 });
  });

  bench("diffDocs single insertion in 200 sections", () => {
    diffDocs(base, inserted, { maxOps: 10_000 });
  });
});
