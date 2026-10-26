import { test } from "vitest";
import { htmlToJx, markdownToHtml } from "@jxsuite/markup";

const markdown = Array.from(
  { length: 5 },
  (_, i) => `## Section ${i}

Some **bold** and _italic_ text with a [link](https://example.com/${i}) and \`inline code\`.

- first item
- second item with ~~strike~~
- [x] done task

| a | b |
| - | - |
| ${i} | ${i * 2} |
`,
).join("\n");

const html = Array.from(
  { length: 50 },
  (_, i) =>
    `<section class="card" data-i="${i}"><h2>Title ${i}</h2><p>Text <strong>bold</strong> <a href="/x/${i}">link</a></p><ul><li>a</li><li>b</li></ul></section>`,
).join("\n");

test("markup", async ({ bench }) => {
  await bench.compare(
    bench("markdownToHtml 5 sections", () => {
      markdownToHtml(markdown);
    }),

    bench("htmlToJx 50 cards", () => {
      htmlToJx(html);
    }),
  );
});
