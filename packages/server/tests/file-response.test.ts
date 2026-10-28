import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileResponse, HOST_MEDIA_TYPES, hostMediaType, openFile } from "../src/file-response.ts";

/** Every extension checked against Bun, including ones Bun answers with the fallback. */
const EXTENSIONS =
  ".7z .aac .ai .apng .astro .atom .avif .bin .bmp .br .cjs .class .css .csv .dmg .doc .docx .env .eot .eps .epub .exe .flac .gif .gitignore .glb .gltf .gz .hbs .heic .htm .html .ico .ics .iso .jpeg .jpg .js .json .jsonld .jsx .jx .jxl .liquid .lock .log .m4a .map .markdown .md .mdx .mjs .mov .mp3 .mp4 .mts .mustache .njk .oga .ogg .ogv .opus .otf .pdf .php .png .ppt .pptx .psd .pug .py .rar .rss .rtf .sh .srt .svelte .svg .tar .tif .tiff .toml .ts .tsv .tsx .ttf .twig .txt .vtt .vue .wasm .wav .weba .webm .webmanifest .webp .woff .woff2 .xls .xlsx .xml .yaml .yml .zip .zst".split(
    " ",
  );

const root = mkdtempSync(join(tmpdir(), "jx-file-response-"));
writeFileSync(join(root, "style.css"), "body{}");
mkdirSync(join(root, "dir.css"));

afterAll(() => rmSync(root, { force: true, recursive: true }));

describe("hostMediaType answers what Bun.file inferred", () => {
  test.each([...EXTENSIONS, ...HOST_MEDIA_TYPES.keys(), ".unknownext", ""])("%s", (ext) => {
    expect(hostMediaType(`file${ext}`)).toBe(Bun.file(`file${ext}`).type);
  });

  test("the extension is matched case-insensitively", () => {
    expect(hostMediaType("PHOTO.PNG")).toBe(Bun.file("PHOTO.PNG").type);
  });
});

describe("fileResponse", () => {
  test("streams the file with Bun's Content-Type", async () => {
    const path = join(root, "style.css");
    const ours = await fileResponse(path, { headers: { "Cache-Control": "no-store" } });
    const bun = new Response(Bun.file(path));
    expect(ours!.headers.get("content-type")).toBe(bun.headers.get("content-type"));
    expect(ours!.headers.get("cache-control")).toBe("no-store");
    expect(await ours!.text()).toBe("body{}");
  });

  test("a directory or a missing path is no file, as Bun's exists() said", async () => {
    for (const path of [join(root, "dir.css"), join(root, "missing.css")]) {
      expect(await Bun.file(path).exists()).toBe(false);
      expect(await fileResponse(path)).toBeNull();
      expect(await openFile(path)).toBeNull();
    }
  });
});
