/*
 * A definition that instantiates its own tag with the same props (#320).
 *
 * Before this the interpreter never settled: each level's `connectedCallback` awaited its scope,
 * rendered the definition's children, and so created the next level — a microtask loop with no
 * stack to overflow, measured at 60 s before the harness killed it. The compiler already refuses
 * the same shape at build (`renderComponentInstance`, compiler.md §8.1); these tests hold the
 * interpreter to the same rule and the same words (spec.md §16.9).
 *
 * The second block is the half the compiler cannot see: an instance an effect creates AFTER the
 * first paint — a `$switch` an `onMount` flips, a `$map` row that arrives with data — which
 * connects with no enclosing render on the stack and, before the chain was carried into those
 * re-runs, began a fresh chain at every level and hung exactly as the static shape had.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { defineElement, MAX_COMPONENT_NESTING, mount } from "../src/runtime";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

// Unique tags per test: `customElements.define` is one-shot for the life of the realm.
let uid = 0;
const uniqueTag = () => `si-test-${(uid += 1)}`;

/**
 * Wait until `done()` holds, or fail after `limit` ms. Bounded, because the bug under test is a
 * hang: a test that waited forever would reproduce it rather than detect it.
 */
async function settle(done: () => boolean, limit = 5000): Promise<void> {
  const start = Date.now();
  while (!done()) {
    if (Date.now() - start > limit) {
      throw new Error(`did not settle within ${limit}ms`);
    }
    await new Promise((r) => {
      setTimeout(r, 5);
    });
  }
}

/** A quiet moment: long enough for a few more levels to have rendered, had they been going to. */
const pause = (ms = 60) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

describe("self-instantiating definitions (spec.md §16.9)", () => {
  let errors: ReturnType<typeof spyOn<Console, "error">>;
  let host: HTMLElement;

  afterEach(() => {
    errors.mockRestore();
    host.remove();
  });

  const arm = () => {
    errors = spyOn(console, "error").mockImplementation(() => null);
    host = document.createElement("div");
    document.body.append(host);
  };

  test("a definition that renders its own tag with the same props is refused, and the page finishes", async () => {
    arm();
    const tag = uniqueTag();
    // The shape `examples/components/user-card.json` had before #317: the card wraps itself in
    // Its own tag as a styled block, forwarding the one prop it has.
    await defineElement({
      children: [
        { tagName: "h3", textContent: "${state.name}" },
        { $props: { name: { $ref: "#/state/name" } }, tagName: tag },
      ],
      state: { name: "Ada" },
      tagName: tag,
    });

    await mount(
      { children: [{ tagName: tag }, { tagName: "p", textContent: "after the card" }] },
      host,
    );
    await settle(() => errors.mock.calls.length > 0);
    await pause();

    // The diagnostic is the compiler's, word for word, with the chain it walked. The page-level
    // Instance has no props, the one it draws has `name`, and the one THAT draws has the same
    // `name` — so the cycle closes on the third, exactly where the build would close it.
    expect(errors).toHaveBeenCalledTimes(1);
    const [label, error] = errors.mock.calls[0] as [string, Error];
    expect(label).toBe(`Jx: <${tag}> was not rendered:`);
    expect(error.message).toBe(
      `Component <${tag}> renders itself: ${tag} → ${tag} → ${tag}. A component cannot appear ` +
        "inside its own definition with the same props — the expansion would never end.",
    );
    // Three hosts stand, the third empty; the recursion stopped there.
    const cards = host.querySelectorAll(tag);
    expect(cards.length).toBe(3);
    expect(cards[0]?.firstElementChild?.textContent).toBe("Ada");
    // The second level really received the prop — the identity that closed the cycle is a value
    // That was forwarded, not a null that fell through.
    expect(cards[1]?.firstElementChild?.textContent).toBe("Ada");
    expect(cards[2]?.childNodes.length).toBe(0);
    // And the sibling after the card rendered: the failure was the instance's, not the page's.
    expect(host.querySelector("p")?.textContent).toBe("after the card");
  });

  test("the refusal is an event the host can hold, dispatched at the refused element", async () => {
    arm();
    const tag = uniqueTag();
    await defineElement({
      children: [{ $props: { label: { $ref: "#/state/label" } }, tagName: tag }],
      state: { label: "x" },
      tagName: tag,
    });
    // The console line inside a canvas iframe reaches nobody; the event is what a page or the
    // Studio canvas can collect. It bubbles, so a listener on the host sees it; it is an
    // `ErrorEvent`, so the error and its message are where the platform puts them.
    const seen: ErrorEvent[] = [];
    host.addEventListener("jx-error", (event) => {
      seen.push(event as ErrorEvent);
    });

    await mount({ children: [{ tagName: tag }] }, host);
    await settle(() => seen.length > 0);
    await pause();

    expect(seen.length).toBe(1);
    const [event] = seen;
    if (!(event instanceof ErrorEvent)) {
      throw new Error("no jx-error event was dispatched");
    }
    expect(event.bubbles).toBe(true);
    expect(event.message).toContain(`renders itself: ${tag} → ${tag} → ${tag}.`);
    expect((event.error as Error).message).toBe(event.message);
    // Dispatched AT the refused instance: the third host, the empty one.
    const cards = [...host.querySelectorAll(tag)];
    expect(cards.indexOf(event.target as Element)).toBe(2);
    // And the console still says the same thing, for a page with nobody listening.
    expect(errors).toHaveBeenCalledTimes(1);
  });

  test("a refused host is emptied, what its definition wrote for its slots included", async () => {
    arm();
    const tag = uniqueTag();
    // The definition authors slot content INTO its self-instance. The refused level never
    // Distributes anything, so it must not stand there holding raw light DOM either: an empty host
    // Is what §16.9 promises, and `<b>slotted</b>` showing through it is not empty.
    await defineElement({
      children: [
        { tagName: "slot" },
        { children: [{ tagName: "b", textContent: "slotted" }], tagName: tag },
      ],
      state: {},
      tagName: tag,
    });

    await mount({ children: [{ tagName: tag }] }, host);
    await settle(() => errors.mock.calls.length > 0);
    await pause();

    expect(errors).toHaveBeenCalledTimes(1);
    const cards = host.querySelectorAll(tag);
    expect(cards.length).toBe(2);
    expect(cards[1]?.innerHTML).toBe("");
    expect(host.querySelector("b")).toBeNull();
  });

  test("a second, unrelated instance of the same tag on the page is unaffected", async () => {
    arm();
    const tag = uniqueTag();
    await defineElement({
      children: [{ $props: { label: { $ref: "#/state/label" } }, tagName: tag }],
      state: { label: "x" },
      tagName: tag,
    });

    // Two page-level instances: the chain is per instantiation, not per tag, so the second one
    // Starts from nothing and fails on its own terms rather than inheriting the first's chain.
    await mount({ children: [{ tagName: tag }, { tagName: tag }] }, host);
    await settle(() => errors.mock.calls.length >= 2);
    await pause();

    expect(errors).toHaveBeenCalledTimes(2);
    for (const call of errors.mock.calls) {
      expect((call[1] as Error).message).toContain(`${tag} → ${tag} → ${tag}.`);
    }
    // Each page-level instance grew exactly two levels before its third was refused.
    expect(host.querySelectorAll(tag).length).toBe(6);
  });

  test("changing props are data-driven recursion and render to their natural depth", async () => {
    arm();
    const tag = uniqueTag();
    // A tree node: draws itself one level deeper until a `$switch` on its depth says stop. The
    // Props differ at every level, so no frame repeats and the chain never closes.
    await defineElement({
      children: [
        {
          $switch: { $ref: "#/state/deeper" },
          cases: {
            false: { tagName: "span", textContent: "leaf ${state.depth}" },
            true: { $props: { depth: "${Number(state.depth) + 1}" }, tagName: tag },
          },
        },
      ],
      state: { deeper: "${Number(state.depth) < 3}", depth: 0 },
      tagName: tag,
    });

    await mount({ children: [{ tagName: tag }] }, host);
    await settle(() => host.querySelector("span") !== null);

    expect(errors).not.toHaveBeenCalled();
    expect(host.querySelectorAll(tag).length).toBe(4);
    expect(host.querySelector("span")?.textContent).toBe("leaf 3");
  });

  test("a self-reference whose stop case never comes is cut at the nesting cap", async () => {
    arm();
    const tag = uniqueTag();
    // The same tree node with its stop case written wrong: every level is a new frame, so only
    // The cap can end it — with its own message, and the chain it walked. Through a `$switch`, so
    // The test also proves the chain travels into a case container and not only a direct child.
    await defineElement({
      children: [
        {
          $switch: { $ref: "#/state/deeper" },
          cases: { true: { $props: { n: "${Number(state.n) + 1}" }, tagName: tag } },
        },
      ],
      state: { deeper: "${Number(state.n) >= 0}", n: 0 },
      tagName: tag,
    });

    await mount({ children: [{ tagName: tag }] }, host);
    await settle(() => errors.mock.calls.length > 0);
    await pause();

    expect(errors).toHaveBeenCalledTimes(1);
    const error = errors.mock.calls[0]?.[1] as Error;
    expect(error.message).toStartWith(
      `Component nesting exceeds ${MAX_COMPONENT_NESTING} levels: ${tag} → `,
    );
    expect(error.message).toEndWith(
      "A component that renders itself with changing props needs a case that stops.",
    );
    // The chain names every level it walked, the refused one included.
    expect(error.message.split(" → ").length).toBe(MAX_COMPONENT_NESTING + 1);
    // Thirty-two rendered; the thirty-third is the empty host the diagnostic names.
    expect(host.querySelectorAll(tag).length).toBe(MAX_COMPONENT_NESTING + 1);
  });

  test("every route a prop arrives by counts toward the identity", async () => {
    arm();
    // The three routes besides a JS property: an observed attribute, a `props.*` attribute, and
    // The `data-jx-props` payload a prerendered instance upgrades with. Each definition forwards
    // Its own value by that route, so each closes the cycle on its SECOND level — and would run
    // Forever if that route were left out of the frame. The payload route is taken twice, once
    // With an object and once with an array, because those are the two plain-data shapes a
    // Payload parses to and each is its own branch of the structural comparison.
    const byAttribute = uniqueTag();
    await defineElement({
      children: [{ attributes: { tone: "${state.tone}" }, tagName: byAttribute }],
      observedAttributes: ["tone"],
      state: { tone: "plain" },
      tagName: byAttribute,
    });
    const byPropsAttribute = uniqueTag();
    await defineElement({
      children: [{ attributes: { "props.tone": "${state.tone}" }, tagName: byPropsAttribute }],
      state: { tone: "plain" },
      tagName: byPropsAttribute,
    });
    const byPayload = uniqueTag();
    await defineElement({
      children: [{ $props: { user: { $ref: "#/state/user" } }, tagName: byPayload }],
      state: { user: { name: "Guest" } },
      tagName: byPayload,
    });
    const byArrayPayload = uniqueTag();
    await defineElement({
      children: [{ $props: { tags: { $ref: "#/state/tags" } }, tagName: byArrayPayload }],
      state: { tags: ["none"] },
      tagName: byArrayPayload,
    });

    await mount(
      {
        children: [
          { attributes: { tone: "warm" }, tagName: byAttribute },
          { attributes: { "props.tone": "warm" }, tagName: byPropsAttribute },
        ],
      },
      host,
    );
    // The payload route is what a compiled page upgrades with, so it arrives as HTML. The object
    // The page parsed and the reactive proxy the definition forwards are two references with one
    // Meaning, which is the structural half of the identity.
    host.insertAdjacentHTML(
      "beforeend",
      `<${byPayload} data-jx-props='{"user":{"name":"Ada"}}'></${byPayload}>` +
        `<${byArrayPayload} data-jx-props='{"tags":["a","b"]}'></${byArrayPayload}>`,
    );
    await settle(() => errors.mock.calls.length >= 4);
    await pause();

    expect(errors).toHaveBeenCalledTimes(4);
    const messages = errors.mock.calls.map((call) => (call[1] as Error).message);
    for (const tag of [byAttribute, byPropsAttribute, byPayload, byArrayPayload]) {
      expect(messages.some((m) => m.includes(`renders itself: ${tag} → ${tag}.`))).toBe(true);
      expect(host.querySelectorAll(tag).length).toBe(2);
    }
  });

  test("a prop JSON cannot describe is compared by reference alone", async () => {
    arm();
    const tag = uniqueTag();
    // A ladder whose rungs are class instances: the depth is a non-enumerable field, so every rung
    // Serialises as `{}`, and a comparison by JSON form would have called the second and third
    // Levels one input and refused a page that ends on its own after four. A value that is not
    // Plain data is only ever itself. The next rung is read through a deep `$ref` because a
    // `$props` template is text and could not carry one.
    class Rung {
      declare readonly depth: number;
      constructor(depth: number) {
        Object.defineProperty(this, "depth", { value: depth });
      }
      get more(): boolean {
        return this.depth < 3;
      }
      get next(): Rung {
        return new Rung(this.depth + 1);
      }
    }
    await defineElement({
      children: [
        {
          $switch: { $ref: "#/state/rung/more" },
          cases: {
            false: { tagName: "span", textContent: "rung ${state.rung.depth}" },
            true: { $props: { rung: { $ref: "#/state/rung/next" } }, tagName: tag },
          },
        },
      ],
      state: { rung: null },
      tagName: tag,
    });

    const el = document.createElement(tag) as HTMLElement & { rung?: unknown };
    el.rung = new Rung(0);
    host.append(el);
    await settle(() => host.querySelector("span") !== null);
    await pause();

    expect(errors).not.toHaveBeenCalled();
    expect(host.querySelectorAll(tag).length).toBe(4);
    expect(host.querySelector("span")?.textContent).toBe("rung 3");
  });

  test("a circular prop is compared by reference alone", async () => {
    arm();
    const tag = uniqueTag();
    await defineElement({
      children: [{ $props: { node: { $ref: "#/state/node" } }, tagName: tag }],
      state: { node: null },
      tagName: tag,
    });
    // A circular object, forwarded by reference. The page holds the raw object and the definition
    // Forwards its reactive proxy: two references, and `JSON.stringify` throws on both, so the
    // First two levels are different by policy — a false diagnostic would block a page that might
    // End. The proxy is then forwarded as itself, so the third level closes on the second by
    // Reference, which is where the diagnostic lands.
    const node: Record<string, unknown> = {};
    node.self = node;
    const el = document.createElement(tag) as HTMLElement & { node?: unknown };
    el.node = node;
    host.append(el);
    await settle(() => errors.mock.calls.length > 0);
    await pause();

    expect(errors).toHaveBeenCalledTimes(1);
    const error = errors.mock.calls[0]?.[1] as Error;
    expect(error.message).toContain(`renders itself: ${tag} → ${tag} → ${tag}.`);
    expect(host.querySelectorAll(tag).length).toBe(3);
  });

  test("a prerendered host discarded by an enclosing upgrade reports nothing", async () => {
    arm();
    const tag = uniqueTag();
    await defineElement({
      children: [{ $props: { label: { $ref: "#/state/label" } }, tagName: tag }],
      state: { label: "x" },
      tagName: tag,
    });
    // Two prerendered hosts of the tag, one inside the other, each carrying the payload — the
    // Markup a build other than this compiler could write for the refused shape. The outer one
    // Upgrades by capturing the inner as slot content and drawing the definition afresh, so the
    // Inner host and whatever it drew are discarded mid-callback. One defect, one report: the
    // Instance the outer upgrade draws is refused and says so; the discarded copy, refused in a
    // Subtree that is no longer in the document, says nothing.
    host.insertAdjacentHTML(
      "beforeend",
      `<${tag} data-jx-prerendered data-jx-props='{"label":"x"}'>` +
        `<${tag} data-jx-prerendered data-jx-props='{"label":"x"}'></${tag}></${tag}>`,
    );
    const seen: Event[] = [];
    host.addEventListener("jx-error", (event) => {
      seen.push(event);
    });
    await settle(() => errors.mock.calls.length > 0);
    await pause();

    expect(errors).toHaveBeenCalledTimes(1);
    expect(seen.length).toBe(1);
    const error = errors.mock.calls[0]?.[1] as Error;
    expect(error.message).toContain(`renders itself: ${tag} → ${tag}.`);
    // The page-level host, given the same label its definition forwards, is refused at its
    // Second level: two hosts stand, both in the document.
    const hosts = [...host.querySelectorAll(tag)];
    expect(hosts.length).toBe(2);
    expect(seen.map((event) => hosts.indexOf(event.target as Element))).toEqual([1]);
  });

  test("an instance slotted inside the same tag at the call site is not a cycle", async () => {
    arm();
    const tag = uniqueTag();
    // A box in a box, written by the page: the inner one is the PAGE'S node, rendered under the
    // Page's chain and merely distributed into the outer's slot — it is not the definition
    // Rendering itself, and the compiler treats slot content the same way.
    await defineElement({
      children: [{ tagName: "slot" }],
      state: { tone: "plain" },
      tagName: tag,
    });

    await mount(
      {
        children: [
          {
            children: [{ children: [{ tagName: "i", textContent: "inner" }], tagName: tag }],
            tagName: tag,
          },
        ],
      },
      host,
    );
    await settle(() => host.querySelector(`${tag} ${tag} i`) !== null);
    await pause();

    expect(errors).not.toHaveBeenCalled();
    expect(host.querySelector("i")?.textContent).toBe("inner");
  });
});

describe("instances created after the first paint (spec.md §16.9, re-expansion)", () => {
  let errors: ReturnType<typeof spyOn<Console, "error">>;
  let host: HTMLElement;

  afterEach(() => {
    errors.mockRestore();
    host.remove();
  });

  const arm = () => {
    errors = spyOn(console, "error").mockImplementation(() => null);
    host = document.createElement("div");
    document.body.append(host);
  };

  /** A node that starts closed and, open, draws one more of itself: the accordion shape. */
  const opener = (tag: string, state: Record<string, unknown> = {}) =>
    defineElement({
      children: [
        {
          $switch: { $ref: "#/state/open" },
          cases: {
            false: { tagName: "span", textContent: "closed" },
            true: { tagName: tag },
          },
        },
      ],
      state: { open: false, ...state },
      tagName: tag,
    });

  test("a switch that onMount flips into the same tag is ended by the cap, not by time", async () => {
    arm();
    const tag = uniqueTag();
    // Every level's initial expansion is the leaf; the recursion lives entirely in the effect
    // Re-run the `onMount` write triggers. Nothing is on the stack when that runs, so before the
    // Switch carried its chain into the re-run every level began from nothing — and this shape
    // Hung the interpreter exactly as the static one had, with no diagnostic at all.
    await opener(tag, {
      onMount: { $prototype: "Function", arguments: ["s"], body: "s.open = true" },
    });

    await mount({ children: [{ tagName: tag }] }, host);
    await settle(() => errors.mock.calls.length > 0);
    await pause();

    // The frames repeat, but each repeat is a re-run: the runtime cannot tell an `onMount` that
    // Flips from a click that opens, so the cycle check is not asked across that boundary and the
    // Cap is what ends it — with the advice that fits, since a case that stops is what is missing.
    expect(errors).toHaveBeenCalledTimes(1);
    const error = errors.mock.calls[0]?.[1] as Error;
    expect(error.message).toStartWith(
      `Component nesting exceeds ${MAX_COMPONENT_NESTING} levels: ${tag} → `,
    );
    expect(error.message.split(" → ").length).toBe(MAX_COMPONENT_NESTING + 1);
    expect(host.querySelectorAll(tag).length).toBe(MAX_COMPONENT_NESTING + 1);
  });

  test("the same flip made by the page is one more level, not a cycle", async () => {
    arm();
    const tag = uniqueTag();
    await opener(tag);

    await mount({ children: [{ tagName: tag }] }, host);
    await settle(() => host.querySelector("span") !== null);
    // The page opens the first node, then the one it revealed: the frames on the chain are
    // Identical, and neither is a definition rendering itself — it is a page asking for one more.
    const openLevel = async (level: number): Promise<void> => {
      const want = level + 2;
      const nodes = host.querySelectorAll(tag);
      expect(nodes.length).toBe(level + 1);
      (nodes[level] as HTMLElement & { open: boolean }).open = true;
      await settle(() => host.querySelectorAll(tag).length === want);
      const leaf = `${`${tag} `.repeat(want)}span`;
      await settle(() => host.querySelector(leaf) !== null);
    };
    await openLevel(0);
    await openLevel(1);
    await pause();

    expect(errors).not.toHaveBeenCalled();
    expect(host.querySelectorAll(tag).length).toBe(3);
  });

  test("a self-instantiating definition reached through a page switch is refused where its own expansion repeats", async () => {
    arm();
    const tag = uniqueTag();
    // The static shape of #320, but the page shows it only after a state change. The instance the
    // Re-run creates begins a new expansion on the page's (empty) chain, and its OWN expansion is
    // Where the frame repeats — so rule 1 is the one that answers, one level deeper than the page.
    await defineElement({
      children: [{ $props: { name: { $ref: "#/state/name" } }, tagName: tag }],
      state: { name: "Ada" },
      tagName: tag,
    });

    const handle = await mount(
      {
        children: [
          {
            $switch: { $ref: "#/state/show" },
            cases: { false: { tagName: "span", textContent: "hidden" }, true: { tagName: tag } },
          },
        ],
        state: { show: false },
      },
      host,
    );
    await settle(() => host.querySelector("span") !== null);
    expect(host.querySelector(tag)).toBeNull();
    handle.scope.show = true;
    await settle(() => errors.mock.calls.length > 0);
    await pause();

    expect(errors).toHaveBeenCalledTimes(1);
    const error = errors.mock.calls[0]?.[1] as Error;
    expect(error.message).toContain(`renders itself: ${tag} → ${tag} → ${tag}.`);
    expect(host.querySelectorAll(tag).length).toBe(3);
  });

  test("a mapped row that arrives with data connects under the list's chain", async () => {
    arm();
    const tag = uniqueTag();
    // A list that is empty at first paint and gains one row of itself from `onMount`. The row is
    // Inserted by the list's re-run, so the chain has to travel through `$map` as it does through
    // `$switch` — or every row's instance began from nothing, and this hung too.
    await defineElement({
      children: [
        {
          children: [
            { $prototype: "Array", items: { $ref: "#/state/rows" }, map: { tagName: tag } },
          ],
          tagName: "ul",
        },
      ],
      state: {
        onMount: { $prototype: "Function", arguments: ["s"], body: "s.rows = [1]" },
        rows: [],
      },
      tagName: tag,
    });

    await mount({ children: [{ tagName: tag }] }, host);
    await settle(() => errors.mock.calls.length > 0);
    await pause();

    expect(errors).toHaveBeenCalledTimes(1);
    const error = errors.mock.calls[0]?.[1] as Error;
    expect(error.message).toStartWith(
      `Component nesting exceeds ${MAX_COMPONENT_NESTING} levels: ${tag} → `,
    );
    expect(host.querySelectorAll(tag).length).toBe(MAX_COMPONENT_NESTING + 1);
  });
});
