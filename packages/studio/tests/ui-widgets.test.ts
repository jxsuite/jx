import {
  installMockPlatform,
  pointer,
  renderInto,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { html } from "lit-html";
import { renderFieldRow } from "../src/ui/field-row";

beforeEach(() => {
  resetStudioState();
  resetWorkspaceWithTab();
  installMockPlatform();
});

// ─── renderFieldRow ──────────────────────────────────────────────────────────

describe("renderFieldRow", () => {
  test("renders label, widget slot, and data-prop", async () => {
    const container = await renderInto(
      renderFieldRow({
        hasValue: false,
        label: "Width",
        prop: "width",
        widget: html`<b class="the-widget"></b>`,
      }),
    );
    const row = container.querySelector(".style-row") as HTMLElement;
    expect(row.dataset.prop).toBe("width");
    expect(row.classList.contains("style-row--warning")).toBe(false);
    expect(row.querySelector("sp-field-label")?.textContent).toBe("Width");
    expect(row.querySelector("sp-field-label")?.getAttribute("title")).toBe("width");
    expect(row.querySelector(".the-widget")).not.toBeNull();
    expect(row.querySelector(".set-dot")).toBeNull();
  });

  test("set-dot appears only when hasValue and onClear are both present", async () => {
    const noClear = await renderInto(
      renderFieldRow({ hasValue: true, label: "W", prop: "w", widget: html`` }),
    );
    expect(noClear.querySelector(".set-dot")).toBeNull();

    let cleared = 0;
    const withClear = await renderInto(
      renderFieldRow({
        hasValue: true,
        label: "W",
        onClear: () => {
          cleared += 1;
        },
        prop: "w",
        widget: html``,
      }),
    );
    const dot = withClear.querySelector(".set-dot") as HTMLElement;
    expect(dot.getAttribute("title")).toBe("Clear w");

    let leaked = false;
    withClear.addEventListener("click", () => {
      leaked = true;
    });
    pointer(dot, "click");
    expect(cleared).toBe(1);
    expect(leaked).toBe(false); // StopPropagation
  });

  test("span 2 stretches across the grid and warning toggles the modifier class", async () => {
    const container = await renderInto(
      renderFieldRow({
        hasValue: false,
        label: "L",
        prop: "p",
        span: 2,
        warning: true,
        widget: html``,
      }),
    );
    const row = container.querySelector(".style-row") as HTMLElement;
    expect(row.getAttribute("style")).toContain("grid-column: 1 / -1");
    expect(row.classList.contains("style-row--warning")).toBe(true);
  });

  /* §7.1's third tier: the error slot. A bad value belongs AT its control. Before this slot the
     only place to say so was a three-second grey line at the bottom of the window, hundreds of
     pixels from the field that refused the value — by which time the field had snapped back and
     the reason was gone. */

  test("an error renders under the widget with role=alert and marks the row invalid", async () => {
    const container = await renderInto(
      renderFieldRow({
        error: "Enter a length, like 16px.",
        hasValue: false,
        label: "Width",
        prop: "width",
        widget: html`<b class="the-widget"></b>`,
      }),
    );
    const row = container.querySelector(".style-row") as HTMLElement;
    expect(row.classList.contains("style-row--invalid")).toBe(true);
    const error = row.querySelector(".style-row-error") as HTMLElement;
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toContain("Enter a length, like 16px.");
    // The error follows the widget: the message is about the control above it.
    expect(error.previousElementSibling?.classList.contains("the-widget")).toBe(true);
  });

  test("no error means no error line and no invalid class", async () => {
    for (const error of [undefined, ""]) {
      const container = await renderInto(
        renderFieldRow({ error, hasValue: false, label: "W", prop: "w", widget: html`` }),
      );
      const row = container.querySelector(".style-row") as HTMLElement;
      expect(row.classList.contains("style-row--invalid")).toBe(false);
      expect(row.querySelector(".style-row-error")).toBeNull();
    }
  });

  test("invalid wins over warning — refused is not the same as unusual", async () => {
    const container = await renderInto(
      renderFieldRow({
        error: "Refused.",
        hasValue: false,
        label: "W",
        prop: "w",
        warning: true,
        widget: html``,
      }),
    );
    const row = container.querySelector(".style-row") as HTMLElement;
    expect(row.classList.contains("style-row--invalid")).toBe(true);
    expect(row.classList.contains("style-row--warning")).toBe(false);
  });

  test("the repeat counter renders from 2 up, never at 1", async () => {
    const one = await renderInto(
      renderFieldRow({
        error: "Refused.",
        errorCount: 1,
        hasValue: false,
        label: "W",
        prop: "w",
        widget: html``,
      }),
    );
    expect(one.querySelector(".style-row-error-count")).toBeNull();

    const three = await renderInto(
      renderFieldRow({
        error: "Refused.",
        errorCount: 3,
        hasValue: false,
        label: "W",
        prop: "w",
        widget: html``,
      }),
    );
    expect(three.querySelector(".style-row-error-count")?.textContent).toBe("×3");
  });
});

// ─── renderFieldRow · provenance (§6.2) ──────────────────────────────────────

describe("renderFieldRow provenance", () => {
  test("an explicit provenance wins over the hasValue/onClear pair", async () => {
    const container = await renderInto(
      renderFieldRow({
        hasValue: true,
        label: "Padding",
        onClear: () => {
          throw new Error("the derived chip must not be used when provenance is given");
        },
        prop: "padding",
        provenance: { donor: "@md", state: "inherited" },
        widget: html``,
      }),
    );
    const chip = container.querySelector(".provenance-chip")!;
    expect(chip.classList.contains("provenance-chip--inherited")).toBe(true);
    expect(chip.textContent!.trim()).toBe("from @md");
    expect(container.querySelector(".set-dot")).toBeNull();
  });

  test("a default-state row draws no chip — absence IS the ghost", async () => {
    const container = await renderInto(
      renderFieldRow({
        hasValue: false,
        label: "Padding",
        prop: "padding",
        provenance: { state: "default" },
        widget: html``,
      }),
    );
    expect(container.querySelector(".provenance-chip")).toBeNull();
  });

  test("the derived chip keeps the old set-dot markup and its Clear tooltip", async () => {
    let cleared = 0;
    const container = await renderInto(
      renderFieldRow({
        hasValue: true,
        label: "W",
        onClear: () => {
          cleared += 1;
        },
        prop: "width",
        widget: html``,
      }),
    );
    const dot = container.querySelector(".set-dot")!;
    expect(dot.tagName.toLowerCase()).toBe("span");
    expect(dot.getAttribute("title")).toBe("Clear width");
    pointer(dot, "click");
    expect(cleared).toBe(1);
  });
});
