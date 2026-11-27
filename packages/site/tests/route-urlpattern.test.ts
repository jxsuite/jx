/**
 * Route patterns against the standard they claim to follow (spec `site-architecture.md` §4).
 *
 * The build checks page names with string rules (`routePatternProblem`) because not every Node
 * release ships `URLPattern`; this suite is where the rules are proven against the real thing.
 */
import { describe, expect, test } from "bun:test";
import { fileToRoute, matchRoute, routeHref, routePatternProblem } from "../src/routes.ts";

interface PathnameInput {
  pathname: string;
}
interface URLPatternLike {
  hasRegExpGroups: boolean;
  exec: (
    input: PathnameInput,
  ) => { pathname: { groups: Record<string, string | undefined> } } | null;
  test: (input: PathnameInput) => boolean;
}
type URLPatternCtor = new (init: PathnameInput) => URLPatternLike;

// SAFETY: `bun-types` declares no URLPattern, so the global is read through the shape used below.
const URLPatternImpl = (globalThis as { URLPattern?: URLPatternCtor }).URLPattern!;

const SOUND = [
  "index.json",
  "about/index.json",
  "v1.2/index.json",
  "blog/[slug].json",
  "[category]/[id].json",
  "docs/[...path].json",
  "[...all].json",
  "blog/[slug]/comments.json",
  "café.json",
];

describe("URLPattern parity", () => {
  test("URLPattern is available to this suite", () => {
    expect(URLPatternImpl).toBeInstanceOf(Function);
  });

  test("a sound page path parses to exactly the groups its name declares", () => {
    for (const path of SOUND) {
      expect(routePatternProblem(path)).toBeNull();
      const route = fileToRoute(path);
      const pattern = new URLPatternImpl({ pathname: route.urlPattern });
      expect(pattern.hasRegExpGroups).toBe(false);
      const sample: Record<string, string> = {};
      for (const name of route.params) {
        sample[name] = "x";
      }
      sample["*"] = "x/y";
      const groups = pattern.exec({ pathname: routeHref(route.urlPattern, sample, "never") })
        ?.pathname.groups;
      const expected = route.params.map((name) =>
        route.isCatchAll && name === route.params.at(-1) ? "0" : name,
      );
      expect(Object.keys(groups ?? {}).toSorted()).toEqual(expected.toSorted());
    }
  });

  test("a refused name is one URLPattern rejects or reads differently", () => {
    for (const path of ["[1st]", "[id]/[id]", "c++", "what?"]) {
      expect(routePatternProblem(`${path}.json`)).not.toBeNull();
      expect(
        () => new URLPatternImpl({ pathname: fileToRoute(`${path}.json`).urlPattern }),
      ).toThrow();
    }
    const group = new URLPatternImpl({
      pathname: fileToRoute("(marketing)/about.json").urlPattern,
    });
    expect(group.hasRegExpGroups).toBe(true);
    expect(group.test({ pathname: "/marketing/about" })).toBe(true);
    expect(
      new URLPatternImpl({ pathname: fileToRoute("foo:bar.json").urlPattern }).exec({
        pathname: "/fooX",
      })?.pathname.groups.bar,
    ).toBe("X");
    expect(
      new URLPatternImpl({ pathname: fileToRoute("a*b.json").urlPattern }).exec({
        pathname: "/axyzb",
      })?.pathname.groups["0"],
    ).toBeDefined();
    expect(
      new URLPatternImpl({ pathname: fileToRoute("faq{old}.json").urlPattern }).test({
        pathname: "/faqold",
      }),
    ).toBe(true);
  });

  test("a refused shape URLPattern accepts is one matchRoute cannot read", () => {
    const post = fileToRoute("post-[id].json");
    expect(new URLPatternImpl({ pathname: post.urlPattern }).test({ pathname: "/post-42" })).toBe(
      true,
    );
    expect(matchRoute([post], "/post-42")).toBeNull();

    const edit = fileToRoute("[...path]/edit.json");
    expect(new URLPatternImpl({ pathname: edit.urlPattern }).test({ pathname: "/a/b" })).toBe(
      false,
    );
    expect(matchRoute([edit], "/a/b")).not.toBeNull();
  });

  test("matchRoute agrees with URLPattern on every sound pattern", () => {
    const paths = [
      "/",
      "/about",
      "/about/",
      "/blog",
      "/blog/",
      "/blog/hello",
      "/blog/hello/",
      "/blog/a%20b",
      "/blog/a/b",
      "/products/42",
      "/docs",
      "/docs/",
      "/docs/a",
      "/docs/a/b/",
      "/v1.2",
      "/v1.2/",
      "/blog/x/comments",
      "/blog/x/comments/",
      "/x",
      "/caf%C3%A9",
    ];
    for (const file of SOUND) {
      const route = fileToRoute(file);
      const pattern = new URLPatternImpl({ pathname: route.urlPattern });
      for (const path of paths) {
        const stripped = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
        const exec =
          pattern.exec({ pathname: stripped }) ?? pattern.exec({ pathname: `${stripped}/` });
        const match = matchRoute([route], path);
        expect(match !== null).toBe(exec !== null);
        if (match && exec) {
          for (const name of route.params) {
            const key =
              match.params["*"] !== undefined && name === route.params.at(-1) && route.isCatchAll
                ? "0"
                : name;
            const want = exec.pathname.groups[key] ?? "";
            const got = route.isCatchAll && key === "0" ? match.params["*"] : match.params[name];
            expect(got).toBe(key === "0" ? want : decodeURIComponent(want));
          }
        }
      }
    }
  });
});
