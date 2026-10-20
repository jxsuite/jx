/**
 * An `npm:` `$src` in the interpreter (spec.md §5.3, 4c).
 *
 * The build bundles a package specifier; the interpreter handed it to `import()` as written, and a
 * browser read `npm:` as a URL scheme it does not fetch: the Studio canvas logged a CORS refusal
 * for every page whose layout used the jxsuite.com search component. A host that renders live says
 * where its packages are served, through `setNpmModuleResolver`.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, describe, expect, test } from "bun:test";
import { buildScope, setNpmModuleResolver } from "../src/runtime";
import type { JxDocument } from "@jxsuite/schema/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const FIXTURE = new URL("_npm_module.ts", import.meta.url).href;

/** A document whose one Function entry names `$src`. */
function withSource(src: string): JxDocument {
  return {
    state: { greet: { $prototype: "Function", $src: src, parameters: ["state", "name"] } },
    tagName: "div",
  };
}

/** Why building a scope failed, as text, or "" when it did not. */
async function failureOf(doc: JxDocument): Promise<string> {
  try {
    await buildScope(doc);
    return "";
  } catch (error) {
    return String(error);
  }
}

afterEach(() => {
  setNpmModuleResolver(null);
});

describe("an npm: $src", () => {
  test("imports the package through the host's resolver", async () => {
    const asked: string[] = [];
    setNpmModuleResolver((specifier) => {
      asked.push(specifier);
      return FIXTURE;
    });
    const scope = await buildScope(withSource("npm:@acme/greeter/client"));
    expect(asked).toEqual(["@acme/greeter/client"]);
    // The entry IS the package's export, imported from where the resolver said.
    const fixture = await import(FIXTURE);
    expect(scope.greet).toBe(fixture.greet);
    expect(fixture.greet(scope, "Ada")).toBe("hello Ada");
  });

  test("with no resolver, the bare specifier is imported, which an import map can answer", async () => {
    // The package name, not the `npm:` URL, is what the import looked for.
    const failure = await failureOf(withSource("npm:@acme/not-installed/client"));
    expect(failure).toContain("@acme/not-installed");
    expect(failure).not.toContain("npm:");
  });
});
