import { flush } from "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import { formatPreviewValue, previewExpression } from "../src/services/preview-eval";
import { mountExpressionEditor } from "../src/ui/expression-editor";

const ref = ($ref: string) => ({ $ref });

describe("previewExpression", () => {
  test("returns null without a scope snapshot or a valid node", () => {
    expect(previewExpression({ operator: "+", target: 1, value: 2 }, null)).toBeNull();
    expect(previewExpression({ operator: "+", target: 1, value: 2 })).toBeNull();
    expect(previewExpression(null, { a: 1 })).toBeNull();
    expect(previewExpression("${a}", { a: 1 })).toBeNull();
  });

  test("reports path-keyed values for a pure expression", () => {
    const preview = previewExpression(
      {
        operator: "+",
        target: ref("#/state/a"),
        value: { operator: "*", target: ref("#/state/b"), value: 2 },
      },
      { a: 1, b: 3 },
    );
    expect(preview).not.toBeNull();
    expect(preview!.error).toBeNull();
    expect(preview!.mutating).toBe(false);
    expect(preview!.values.get("")).toBe("7");
    expect(preview!.values.get("target")).toBe("1");
    expect(preview!.values.get("value")).toBe("6");
  });

  test("mutating expressions run against a clone — the live scope is untouched", () => {
    const scope = { items: [1, 2] };
    const preview = previewExpression(
      { operator: "push", target: ref("#/state/items"), value: 3 },
      scope,
    );
    expect(preview!.mutating).toBe(true);
    expect(scope.items).toEqual([1, 2]);
  });

  test("badge strings are captured at report time, before later mutation", () => {
    const preview = previewExpression(
      { operator: "push", target: ref("#/state/items"), value: 9 },
      { items: [1] },
    );
    // The receiver was reported before push appended to the clone.
    expect(preview!.values.get("target")).toBe("[1]");
  });

  test("evaluation errors surface as a message, not a throw", () => {
    const preview = previewExpression({ operator: "bogus", target: 1 }, { a: 1 });
    expect(preview!.error).toContain("unknown operator");
  });

  test("switch previews every branch", () => {
    const preview = previewExpression(
      {
        cases: { off: "Stopped", on: "Running" },
        default: "Unknown",
        operator: "switch",
        target: ref("#/state/mode"),
      },
      { mode: "on" },
    );
    expect(preview!.values.get("")).toBe('"Running"');
    expect(preview!.values.get("cases/off")).toBe('"Stopped"');
    expect(preview!.values.get("default")).toBe('"Unknown"');
  });
});

describe("formatPreviewValue", () => {
  test("formats scalars, arrays, and objects compactly", () => {
    expect(formatPreviewValue()).toBe("undefined");
    expect(formatPreviewValue(null)).toBe("null");
    expect(formatPreviewValue(42)).toBe("42");
    expect(formatPreviewValue("hi")).toBe('"hi"');
    expect(formatPreviewValue([1, 2])).toBe("[1,2]");
  });

  test("truncates long values with an ellipsis", () => {
    const long = "x".repeat(200);
    const text = formatPreviewValue(long);
    expect(text.length).toBeLessThanOrEqual(48);
    expect(text.endsWith("…")).toBe(true);
  });
});

/**
 * The editor is a MOUNTED DOCUMENT now, so these read `[part="badge"]` where they read
 * `.expr-live-badge`, and every mount is awaited. What they assert is unchanged: a preview's
 * path-keyed values reach the rows that stand for those paths.
 */
describe("the editor draws a preview's live values", () => {
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    for (const host of hosts.splice(0)) {
      host.remove();
    }
  });

  /** Mount the editor over a node and its own preview, into an attached host. */
  async function mount(node: unknown, opts: Record<string, unknown>): Promise<HTMLElement> {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    mountExpressionEditor(host, node, () => {}, {
      allowEventRef: false,
      ...opts,
    } as never);
    await flush(6);
    return host;
  }

  /** Every live value the editor's own rows show — the chip strip's badges excluded. */
  function rowBadges(host: HTMLElement): (string | null)[] {
    return [...host.querySelectorAll('[part="row"] [part="badge"]')].map((b) => b.textContent);
  }

  test("renders live value badges from a preview", async () => {
    const node = {
      operator: "+",
      target: ref("#/state/a"),
      value: ref("#/state/b"),
    };
    const host = await mount(node, {
      preview: previewExpression(node, { a: 2, b: 3 }),
      stateDefs: ["a", "b"],
    });
    const badges = rowBadges(host);
    expect(badges).toContain("5");
    expect(badges).toContain("2");
    expect(badges).toContain("3");
  });

  test("renders the switch cases with per-case badges", async () => {
    const node = {
      cases: { done: "Finished" },
      default: "Working",
      operator: "switch",
      target: ref("#/state/status"),
    };
    const host = await mount(node, {
      preview: previewExpression(node, { status: "done" }),
      stateDefs: ["status"],
    });
    expect(host.querySelector('[part="case-key"]')).not.toBeNull();
    const badges = rowBadges(host);
    expect(badges).toContain('"Finished"');
    expect(badges).toContain('"Working"');
  });

  test("renders ?: with If/Then/Else labels", async () => {
    const host = await mount(
      { initial: "no", operator: "?:", target: true, value: "yes" },
      { stateDefs: [] },
    );
    expect(host.textContent).toContain("If");
    expect(host.textContent).toContain("Then");
    expect(host.textContent).toContain("Else");
  });

  test("renders without badges when preview is null", async () => {
    const host = await mount(
      { operator: "!", target: ref("#/state/x") },
      {
        preview: null,
        stateDefs: ["x"],
      },
    );
    expect(host.querySelector('[part="badge"]')).toBeNull();
  });
});
