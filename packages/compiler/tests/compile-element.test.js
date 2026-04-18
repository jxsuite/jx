import { describe, test, expect } from "bun:test";
import { compileElement, compileElementPage } from "../src/compiler.js";
import { resolve } from "node:path";

const fixturesDir = import.meta.dir;
const examplesDir = resolve(fixturesDir, "../../../examples/custom-elements");

// ─── compileElement — basic output ──────────────────────────────────────────

describe("compileElement", () => {
  test("compiles a simple custom element from a raw object", async () => {
    const result = await compileElement({
      tagName: "test-basic",
      state: { count: 0 },
      children: [{ tagName: "span", textContent: "${state.count}" }],
    });

    expect(result.files).toHaveLength(1);
    const file = result.files[0];
    expect(file.tagName).toBe("test-basic");
    expect(file.content).toContain("class TestBasic extends HTMLElement");
    expect(file.content).toContain("customElements.define('test-basic'");
    expect(file.content).toContain("import { reactive, computed, effect } from '@vue/reactivity'");
    expect(file.content).toContain("import { render, html } from 'lit-html'");
  });

  test("reactive state from state", async () => {
    const result = await compileElement({
      tagName: "test-state",
      state: { label: "hello", count: 0, items: [1, 2, 3] },
      children: [],
    });

    const content = result.files[0].content;
    expect(content).toContain("this.state = reactive({");
    expect(content).toContain('label: "hello"');
    expect(content).toContain("count: 0");
    expect(content).toContain("items: [1,2,3]");
  });

  test("functions become methods on state", async () => {
    const result = await compileElement({
      tagName: "test-fn",
      state: {
        count: 0,
        increment: {
          $prototype: "Function",
          body: "state.count++",
        },
      },
      children: [],
    });

    const content = result.files[0].content;
    expect(content).toContain("this.state.increment = (state) => {");
    expect(content).toContain("state.count++");
  });

  test("signal functions become computed", async () => {
    const result = await compileElement({
      tagName: "test-computed",
      state: {
        items: [],
        total: {
          $prototype: "Function",
          body: "return state.items.length",
        },
      },
      children: [],
    });

    const content = result.files[0].content;
    expect(content).toContain("this.state.total = computed(() => {");
    expect(content).toContain("return this.state.items.length");
  });

  test("connectedCallback merges properties and starts effect", async () => {
    const result = await compileElement({
      tagName: "test-connect",
      state: { x: 1 },
      children: [],
    });

    const content = result.files[0].content;
    expect(content).toContain("connectedCallback()");
    expect(content).toContain("this.state[key] = this[key]");
    expect(content).toContain("this.#dispose = effect(() => render(this.template(), this))");
  });

  test("disconnectedCallback disposes effect", async () => {
    const result = await compileElement({
      tagName: "test-disconnect",
      state: {},
      children: [],
    });

    const content = result.files[0].content;
    expect(content).toContain("disconnectedCallback()");
    expect(content).toContain("#dispose");
  });

  test("throws for non-hyphenated tagName", async () => {
    try {
      await compileElement({ tagName: "nohyphen", state: {} });
      expect(true).toBe(false);
    } catch (e) {
      expect(/** @type {Error} */ (e).message).toContain("must contain a hyphen");
    }
  });

  test("tagName converts to PascalCase class name", async () => {
    const result = await compileElement({
      tagName: "my-cool-element",
      state: {},
      children: [],
    });

    expect(result.files[0].content).toContain("class MyCoolElement extends HTMLElement");
  });
});

// ─── compileElement — template generation ───────────────────────────────────

describe("compileElement — templates", () => {
  test("textContent with template string", async () => {
    const result = await compileElement({
      tagName: "test-text",
      state: { name: "world" },
      children: [{ tagName: "span", textContent: "${state.name}" }],
    });

    const content = result.files[0].content;
    expect(content).toContain("${s.name}");
  });

  test("static textContent", async () => {
    const result = await compileElement({
      tagName: "test-static-text",
      state: {},
      children: [{ tagName: "span", textContent: "Hello" }],
    });

    const content = result.files[0].content;
    expect(content).toContain(">Hello</span>");
  });

  test("inline style", async () => {
    const result = await compileElement({
      tagName: "test-style",
      state: {},
      children: [
        {
          tagName: "div",
          style: { display: "flex", gap: "1em", backgroundColor: "#fff" },
        },
      ],
    });

    const content = result.files[0].content;
    expect(content).toContain("display: flex");
    expect(content).toContain("gap: 1em");
    expect(content).toContain("background-color: #fff");
  });

  test("dynamic style with template expression", async () => {
    const result = await compileElement({
      tagName: "test-dyn-style",
      state: { active: true },
      children: [
        {
          tagName: "div",
          style: { color: "${state.active ? 'red' : 'gray'}" },
        },
      ],
    });

    const content = result.files[0].content;
    expect(content).toContain("color: ${s.active ? 'red' : 'gray'}");
  });

  test("event handlers from $ref", async () => {
    const result = await compileElement({
      tagName: "test-event",
      state: {
        handleClick: { $prototype: "Function", body: 'console.log("clicked")' },
      },
      children: [
        {
          tagName: "button",
          onclick: { $ref: "#/state/handleClick" },
          textContent: "Click",
        },
      ],
    });

    const content = result.files[0].content;
    expect(content).toContain("@click=");
    expect(content).toContain("s.handleClick");
  });

  test("inline event handler", async () => {
    const result = await compileElement({
      tagName: "test-inline-event",
      state: { count: 0 },
      children: [
        {
          tagName: "button",
          onclick: { $prototype: "Function", body: "state.count++" },
          textContent: "Inc",
        },
      ],
    });

    const content = result.files[0].content;
    expect(content).toContain("@click=");
    expect(content).toContain("s.count++");
  });

  test("$props on custom element child", async () => {
    const result = await compileElement({
      tagName: "test-props",
      state: { data: [] },
      children: [
        {
          tagName: "child-el",
          $props: {
            items: { $ref: "#/state/data" },
            label: "test",
          },
        },
      ],
    });

    const content = result.files[0].content;
    expect(content).toContain('.items="${s.data}"');
    expect(content).toContain('.label="${"test"}"');
  });

  test("mapped array", async () => {
    const result = await compileElement({
      tagName: "test-map",
      state: { items: [1, 2, 3] },
      children: {
        $prototype: "Array",
        items: { $ref: "#/state/items" },
        map: {
          tagName: "div",
          textContent: "${$map.item}",
        },
      },
    });

    const content = result.files[0].content;
    expect(content).toContain(".map((item, index)");
    expect(content).toContain("s.items");
  });

  test("attributes", async () => {
    const result = await compileElement({
      tagName: "test-attrs",
      state: {},
      children: [
        {
          tagName: "input",
          attributes: { type: "text", placeholder: "Enter..." },
        },
      ],
    });

    const content = result.files[0].content;
    expect(content).toContain('type="text"');
    expect(content).toContain('placeholder="Enter..."');
  });
});

// ─── compileElement — $elements dependencies ────────────────────────────────

describe("compileElement — $elements", () => {
  test("compiles task-item.json from file", async () => {
    const result = await compileElement(resolve(examplesDir, "components/task-item.json"));

    expect(result.files).toHaveLength(1);
    const file = result.files[0];
    expect(file.tagName).toBe("task-item");
    expect(file.content).toContain("class TaskItem extends HTMLElement");
    expect(file.content).toContain("this.state.toggleDone");
    expect(file.content).toContain("this.state.removeTask");
  });

  test("compiles task-stats.json with computed signals", async () => {
    const result = await compileElement(resolve(examplesDir, "components/task-stats.json"));

    const content = result.files[0].content;
    expect(content).toContain("class TaskStats extends HTMLElement");
    expect(content).toContain("this.state.total = computed(");
    expect(content).toContain("this.state.done = computed(");
    expect(content).toContain("this.state.remaining = computed(");
  });

  test("compiles task-manager.json with $elements deps", async () => {
    const result = await compileElement(resolve(examplesDir, "task-manager.json"));

    // Should have 3 files: task-item, task-stats, task-manager
    expect(result.files).toHaveLength(3);
    expect(result.files.map((f) => f.tagName)).toEqual(["task-item", "task-stats", "task-manager"]);

    // Root element (task-manager) should import the deps
    const root = result.files[2];
    expect(root.content).toContain("import './components/task-item.js'");
    expect(root.content).toContain("import './components/task-stats.js'");
  });

  test("does not duplicate visited elements from file", async () => {
    // task-manager.json references task-item and task-stats
    // Compiling it should not produce duplicates
    const result = await compileElement(resolve(examplesDir, "task-manager.json"));

    const tagNames = result.files.map((f) => f.tagName);
    // Each tag should appear exactly once
    const unique = [...new Set(tagNames)];
    expect(tagNames.length).toBe(unique.length);
  });
});

// ─── compileElementPage ─────────────────────────────────────────────────────

describe("compileElementPage", () => {
  test("generates HTML with import map", async () => {
    const result = await compileElementPage(
      {
        tagName: "test-page",
        state: { x: 1 },
        children: [{ tagName: "span", textContent: "${state.x}" }],
      },
      { title: "Test Page" },
    );

    expect(result.html).toContain("<!DOCTYPE html>");
    expect(result.html).toContain("<title>Test Page</title>");
    expect(result.html).toContain('"@vue/reactivity"');
    expect(result.html).toContain('"lit-html"');
    expect(result.html).toContain("<test-page></test-page>");
    expect(result.html).toContain('type="module"');
  });
});
