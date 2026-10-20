/**
 * Tests for src/files/media-types.ts — which files are project media, by extension, and that the
 * upload core re-exports the same classification rather than a second one.
 */
import "./with-dom.js";
import { describe, expect, test } from "bun:test";
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MEDIA_EXTENSIONS,
  VIDEO_EXTENSIONS,
  extensionOf,
  isImage,
} from "../src/files/media-types";
import * as upload from "../src/files/media-upload";

describe("the classification", () => {
  test("media is every image, video and audio extension, plus documents and fonts", () => {
    for (const ext of [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]) {
      expect([ext, MEDIA_EXTENSIONS.has(ext)]).toEqual([ext, true]);
    }
    expect([".pdf", ".woff2", ".otf"].every((ext) => MEDIA_EXTENSIONS.has(ext))).toBe(true);
    expect(MEDIA_EXTENSIONS.has(".md")).toBe(false);
  });

  test("an extension is lowercased with its dot, and a dotfile or a bare name has none", () => {
    expect([extensionOf("Hero.PNG"), extensionOf(".gitignore"), extensionOf("Makefile")]).toEqual([
      ".png",
      "",
      "",
    ]);
  });

  test("isImage takes an extension with or without its dot, in any case", () => {
    expect([isImage(".JPG"), isImage("webp"), isImage(".pdf")]).toEqual([true, true, false]);
  });

  test("the upload core re-exports these, so there is one answer", () => {
    expect(upload.MEDIA_EXTENSIONS).toBe(MEDIA_EXTENSIONS);
    expect(upload.IMAGE_EXTENSIONS).toBe(IMAGE_EXTENSIONS);
    expect(upload.extensionOf).toBe(extensionOf);
    expect(upload.isImage).toBe(isImage);
  });
});
