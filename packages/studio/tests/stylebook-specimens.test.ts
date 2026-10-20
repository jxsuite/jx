/**
 * What each component's Project Styles card is drawn with (src/style/stylebook-specimens.ts):
 * sample props when the definition renders with them, a list's first row, the bare instance, or
 * nothing.
 */
import "./with-dom.js";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ComponentEntry } from "../src/files/components";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";

let definition: JxDocument | null = { tagName: "x-card" };
let examples = new Map<string, JsonValue>();
let sample: { doc: JxDocument; file: string } | null = null;
/** Whether the definition renders, by how many props it is given. */
let renders = (_count: number): boolean => true;
let defines = true;

void mock.module("../src/browse/component-examples", () => ({
  componentExampleProps: () => Promise.resolve(examples),
  componentSampleRow: () => Promise.resolve(sample),
}));
void mock.module("../src/browse/library-preview", () => ({
  readDefinition: () => Promise.resolve(definition),
  rendersWith: (_d: JxDocument, _p: string, props: ReadonlyMap<string, JsonValue>) =>
    Promise.resolve(renders(props.size)),
}));
void mock.module("../src/panels/component-preview", () => ({
  defineComponent: () => Promise.resolve(defines),
}));

const { componentSpecimen, loadStylebookSpecimens } =
  await import("../src/style/stylebook-specimens");

const CARD: ComponentEntry = { path: "components/x-card.json", source: "local", tagName: "x-card" };

beforeEach(() => {
  definition = { tagName: "x-card" };
  examples = new Map();
  sample = null;
  renders = () => true;
  defines = true;
});

describe("componentSpecimen", () => {
  test("sample props a definition renders with draw the instance with them", async () => {
    examples = new Map([["date", "2026-06-20"]]);
    expect(await componentSpecimen(CARD)).toEqual({
      kind: "props",
      props: { date: "2026-06-20" },
    });
  });

  test("a list-only component is drawn as the list's first row", async () => {
    sample = { doc: { tagName: "div" }, file: "pages/index.json" };
    renders = (count) => count > 0;
    expect(await componentSpecimen(CARD)).toEqual({ kind: "row", sample });
  });

  test("a row whose component cannot be defined is not used", async () => {
    sample = { doc: { tagName: "div" }, file: "pages/index.json" };
    defines = false;
    expect(await componentSpecimen(CARD)).toEqual({ kind: "bare" });
  });

  test("a definition that renders with nothing it is offered gets no live instance", async () => {
    examples = new Map([["date", ""]]);
    renders = () => false;
    expect(await componentSpecimen(CARD)).toEqual({ kind: "none" });
  });

  test("npm components, non-JSON definitions and unreadable files are drawn bare", async () => {
    expect(await componentSpecimen({ source: "npm", tagName: "sl-button" })).toEqual({
      kind: "bare",
    });
    expect(await componentSpecimen({ path: "components/x.class.js", tagName: "x" })).toEqual({
      kind: "bare",
    });
    definition = null;
    expect(await componentSpecimen(CARD)).toEqual({ kind: "bare" });
  });
});

describe("loadStylebookSpecimens", () => {
  test("asks once per registry and component, and a failed answer is drawn bare", async () => {
    const registry: ComponentEntry[] = [CARD, { tagName: "x-broken" }];
    const ask = mock((component: ComponentEntry) =>
      component.tagName === "x-broken"
        ? Promise.reject(new Error("unreadable"))
        : Promise.resolve({ kind: "none" as const }),
    );
    const first = await loadStylebookSpecimens(registry, ask);
    expect(first.get("x-card")).toEqual({ kind: "none" });
    expect(first.get("x-broken")).toEqual({ kind: "bare" });
    await loadStylebookSpecimens(registry, ask);
    expect(ask).toHaveBeenCalledTimes(2);
    // A re-read registry is a new array, and is asked again.
    await loadStylebookSpecimens([CARD], ask);
    expect(ask).toHaveBeenCalledTimes(3);
  });

  test("the default question is componentSpecimen", async () => {
    const answers = await loadStylebookSpecimens([{ source: "npm", tagName: "sl-x" }]);
    expect(answers.get("sl-x")).toEqual({ kind: "bare" });
  });
});
