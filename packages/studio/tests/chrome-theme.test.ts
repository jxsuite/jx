/**
 * The chrome theme, end to end — Preferences → Appearance → Light used to be a setting that did
 * nothing, and this file is the reason it could.
 *
 * The mechanism it was written against is gone. It was `<sp-theme>`, which adopted the colour
 * fragment REGISTERED UNDER the `color` it was given and adopted none at all for a name it did not
 * know: only "dark" was registered, so `color="light"` was a valid attribute over an empty palette
 * — every `--spectrum-*` colour went undefined, Studio's semantic layer fell through to its dark
 * hex fallbacks, and the chrome did not move.
 *
 * **The defect class survived the mechanism, so these tests were re-aimed rather than deleted.**
 * The kit declares every colour as a `light-dark()` pair on `:root` and picks a side from the
 * `color-scheme` its own theme sets under `[data-theme]`. A theme name the kit's block has no rule
 * for gets no `color-scheme` of its own, falls back to `light dark`, and the OS chooses — which is
 * the same bug with a different owner: a valid stamp, a silent absence, and a palette the user did
 * not pick. So the first test still counts what each declared theme actually GETS, and still pins
 * an undeclared name as the negative control.
 *
 * Monaco paints from its own registry and cannot read a CSS custom property, so it is the one
 * surface the chrome theme does not reach: both editors were created with a literal "vs-dark". The
 * rest of the file covers the projection that now carries the record to it.
 */
import "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { themeCSS, themeTokens } from "@jxsuite/ui";

/** What `applyChromeTheme` asked Monaco to paint, in call order. */
const setThemeCalls: string[] = [];
let editorLoaded = true;

const fakeMonaco = {
  editor: {
    setTheme: (id: string) => {
      setThemeCalls.push(id);
    },
  },
};

void mock.module("../src/services/monaco-lazy", () => ({
  isMonacoLoaded: () => editorLoaded,
  loadedMonaco: () => (editorLoaded ? fakeMonaco : null),
  loadMonaco: async () => fakeMonaco,
  mountStillWanted: () => false,
  resetMonacoLazy: () => {},
  setProjectSchemasForMonaco: () => {},
}));

const { applyChromeTheme, CHROME_THEMES, monacoTheme, setChromeTheme, shell } =
  await import("../src/shell");

/**
 * The `color-scheme` the kit's theme gives a `data-theme` name, or `null` if it declares no rule
 * for it.
 *
 * Read off the theme's own block rather than out of a live computed style, because the block is
 * what ships: happy-dom resolves neither `light-dark()` nor a cascaded `color-scheme`, so a
 * computed-style assertion here would agree with every possible answer.
 */
function schemeFor(name: string): string | null {
  const rule = themeTokens[`&[data-theme="${name}"]`] as Record<string, unknown> | undefined;
  const scheme = rule?.["colorScheme"] ?? rule?.["color-scheme"];
  return scheme === undefined ? null : String(scheme);
}

beforeEach(() => {
  setThemeCalls.length = 0;
  editorLoaded = true;
  shell.theme = "dark";
  delete document.documentElement.dataset.theme;
});

describe("every declared chrome theme is one the kit's theme knows", () => {
  test("each of CHROME_THEMES pins its own color-scheme", () => {
    /* A theme with no rule of its own inherits `color-scheme: light dark` from the root block, and
       the OS picks — which is what `color="light"` over an unregistered fragment amounted to. */
    for (const name of CHROME_THEMES) {
      expect(schemeFor(name), name).toBe(name);
    }
  });

  test("a name Studio does not declare gets nothing — the failure mode itself", () => {
    /* "lightest" was a colour `<sp-theme>` ACCEPTED and Studio had no fragment for. Nothing rejects
       an arbitrary `data-theme` value either, so it reproduces the bug on demand. Without this the
       test above would pass over a kit that declared no per-theme rule at all. */
    expect(schemeFor("lightest")).toBeNull();
    expect(themeCSS()).not.toContain('[data-theme="lightest"]');
  });

  test("both themes are actually in the sheet the kit adopts", () => {
    /* `themeTokens` reads the authored block; this reads what the builder emits from it. A rule
       authored under a key the builder does not understand would satisfy the first test and reach
       no document. */
    const css = themeCSS();
    for (const name of CHROME_THEMES) {
      expect(css, name).toContain(`[data-theme="${name}"]`);
    }
  });
});

describe("the palette moves with the stamp", () => {
  /** The declaration behind a kit token, as authored. */
  const valueOf = (token: string) => String(themeTokens[token] ?? "");

  test("every chrome colour is a light-dark() pair, so one stamp repaints all of it", () => {
    /* The Spectrum arrangement needed a whole second ramp registered under the other name, and a
       stop overridden in one and forgotten in the other painted the wrong theme's value. A pair
       cannot be half-written: the syntax carries both sides or it is not a pair. */
    for (const token of ["--jx-bg", "--jx-bg-panel", "--jx-fg", "--jx-fg-dim", "--jx-accent"]) {
      expect(valueOf(token), token).toStartWith("light-dark(");
    }
  });

  test("the two sides of a pair disagree, or it is not a theme", () => {
    const [light, dark] = valueOf("--jx-bg")
      .replaceAll(/^light-dark\(|\)$/g, "")
      .split(",")
      .map((part) => part.trim());
    expect(light).not.toBe(dark);
  });
});

describe("monacoTheme", () => {
  test("maps each chrome theme to Monaco's own counterpart", () => {
    expect(monacoTheme("dark")).toBe("vs-dark");
    expect(monacoTheme("light")).toBe("vs");
  });

  test("reads the shell record when asked for no theme in particular", () => {
    setChromeTheme("light");
    expect(monacoTheme()).toBe("vs");
    setChromeTheme("dark");
    expect(monacoTheme()).toBe("vs-dark");
  });

  test("covers every declared theme — a new one cannot default to the dark editor by omission", () => {
    for (const theme of CHROME_THEMES) {
      expect(["vs", "vs-dark"]).toContain(monacoTheme(theme));
    }
    expect(new Set(CHROME_THEMES.map((t) => monacoTheme(t))).size).toBe(CHROME_THEMES.length);
  });
});

describe("applyChromeTheme projects the record", () => {
  test("stamps <html> and repaints a live editor", () => {
    shell.theme = "light";
    applyChromeTheme();

    /* The ONE channel now, and that is the removal rather than a simplification. There were two —
       this stamp and a `color` attribute on the theme element the frame was wrapped in — so a
       theme could half-apply, which is exactly how Light shipped as a switch that moved the
       backdrop and nothing else. */
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(setThemeCalls).toEqual(["vs"]);

    shell.theme = "dark";
    applyChromeTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(setThemeCalls).toEqual(["vs", "vs-dark"]);
  });

  test("writes a name the kit has a rule for, whatever the record says", () => {
    /* The stamp is unvalidated by the DOM, so the record is the only thing keeping it inside the
       set the kit draws. Every value `setChromeTheme` accepts must land on a declared rule. */
    for (const name of CHROME_THEMES) {
      setChromeTheme(name);
      applyChromeTheme();
      expect(schemeFor(document.documentElement.dataset.theme as string)).not.toBeNull();
    }
  });

  test("does not reach for Monaco when no code surface has opened it", () => {
    /* The theme is not allowed to be the thing that pulls 12.6 MB of editor into a session that
       never opened one — `loadedMonaco()`, never `loadMonaco()`. */
    editorLoaded = false;
    shell.theme = "light";
    expect(() => applyChromeTheme()).not.toThrow();
    expect(setThemeCalls).toEqual([]);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
