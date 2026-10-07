import { describe, expect, test } from "bun:test";
import { htmlDeclaresNoindex, isNotFoundRoute, servedRoute } from "../src/site/static-host.ts";

describe("servedRoute", () => {
  test('"always" serves a route as a directory: one trailing slash', () => {
    expect(servedRoute("/about", "always")).toBe("/about/");
    expect(servedRoute("/kb/a/b", "always")).toBe("/kb/a/b/");
    expect(servedRoute("/about/", "always")).toBe("/about/");
  });

  test('"never" serves a route as a file: no trailing slash', () => {
    expect(servedRoute("/about/", "never")).toBe("/about");
    expect(servedRoute("/about//", "never")).toBe("/about");
    expect(servedRoute("/about", "never")).toBe("/about");
  });

  test("the root is / under every setting", () => {
    for (const setting of ["always", "never", "preserve"]) {
      expect(servedRoute("/", setting)).toBe("/");
    }
    expect(servedRoute("/")).toBe("/");
    expect(servedRoute("//", "never")).toBe("/");
  });

  test("an unset or unknown setting leaves the route as written", () => {
    expect(servedRoute("/about")).toBe("/about");
    expect(servedRoute("/about/", "preserve")).toBe("/about/");
  });
});

describe("isNotFoundRoute", () => {
  test("is the /404 route and nothing else", () => {
    expect(isNotFoundRoute("/404")).toBe(true);
    expect(isNotFoundRoute("/404/")).toBe(false);
    expect(isNotFoundRoute("/docs/404")).toBe(false);
    expect(isNotFoundRoute("/")).toBe(false);
  });
});

describe("htmlDeclaresNoindex", () => {
  const page = (head: string) => `<!doctype html><html><head>${head}</head><body></body></html>`;

  test("reads noindex from the robots meta, in either attribute order", () => {
    expect(htmlDeclaresNoindex(page('<meta name="robots" content="noindex">'))).toBe(true);
    expect(htmlDeclaresNoindex(page('<meta content="noindex" name="robots">'))).toBe(true);
  });

  test("finds noindex among other directives, with any case and spacing", () => {
    expect(htmlDeclaresNoindex(page('<meta name="ROBOTS" content="Follow , NoIndex">'))).toBe(true);
    expect(htmlDeclaresNoindex(page("<meta name='robots' content='noarchive,noindex'>"))).toBe(
      true,
    );
    expect(htmlDeclaresNoindex(page("<meta name=robots content=noindex>"))).toBe(true);
  });

  test("`none` means noindex and nofollow", () => {
    expect(htmlDeclaresNoindex(page('<meta name="robots" content="none">'))).toBe(true);
  });

  test("a page that allows indexing is not flagged", () => {
    expect(htmlDeclaresNoindex(page('<meta name="robots" content="index, follow">'))).toBe(false);
    expect(htmlDeclaresNoindex(page('<meta name="robots" content="nofollow">'))).toBe(false);
    expect(htmlDeclaresNoindex(page(""))).toBe(false);
  });

  test("only the generic robots tag counts, not other names that mention noindex", () => {
    expect(htmlDeclaresNoindex(page('<meta name="googlebot" content="noindex">'))).toBe(false);
    expect(htmlDeclaresNoindex(page('<meta name="description" content="noindex">'))).toBe(false);
    expect(htmlDeclaresNoindex(page('<meta property="robots" content="noindex">'))).toBe(false);
  });

  test("looks in the head only: the word in the body is not a directive", () => {
    const html = `<html><head><title>t</title></head><body><meta name="robots" content="noindex"></body></html>`;
    expect(htmlDeclaresNoindex(html)).toBe(false);
    expect(htmlDeclaresNoindex('<meta name="robots" content="noindex">')).toBe(true);
  });

  test("a tag without a content attribute allows indexing", () => {
    expect(htmlDeclaresNoindex(page('<meta name="robots">'))).toBe(false);
  });
});
