/**
 * Jx brand theme fragment.
 *
 * Registered as the Spectrum 'app' fragment (see spectrum.ts), so it is adopted into every
 * <sp-theme> shadow root _after_ the system/color/scale fragments and wins the :host cascade. It
 * rebrands the stock Spectrum themes by overriding only the palette `-rgb` triplets: every derived
 * token in the published theme CSS (accent, focus ring, background layers, alpha-composed tints)
 * resolves through `rgba(var(--spectrum-*-rgb))`, so the whole theme follows coherently.
 *
 * **The values are the UI kit's ramp** (`packages/ui/project.json`, specs/ui.md §4). Studio's own
 * chrome now reads the kit's tokens directly from `:root` (styles/tokens.css); the Spectrum
 * controls that remain until their surfaces migrate read these triplets. Re-valuing them from the
 * same ramp is what keeps a Spectrum control and a kit element on one screen from painting two
 * palettes. `tests/kit-tokens.test.ts` holds the two in agreement stop for stop.
 *
 * **One fragment, two ramps.** The 'app' kind is registered once and adopted whatever `color` is,
 * so the brand values have to say which theme they are for or they re-invert the theme they were
 * adopted into. The dark ramp stays on `:host` because it is the default the app boots in
 * (`index.html`, `DEFAULT_THEME`); light overrides it under `:host([color="light"])`, which
 * `<sp-theme>` reflects. Every stop overridden below is overridden in BOTH ramps — a stop present
 * in one and missing from the other reads the other theme's brand value.
 *
 * A Spectrum ramp is ordered by the theme's own background, not by luminance: in dark, gray 50 is
 * the darkest surface and 900 the lightest ink; in light the two ends swap. The kit's ramp is
 * luminance-ordered, so each Spectrum stop below names the kit step it maps to.
 */

import { css } from "@spectrum-web-components/base";

export const jxTheme = css`
  :host {
    /* Neutral ramp — kit gray steps, darkest surface first */
    --spectrum-gray-50-rgb: 11, 11, 13; /* kit gray-975 #0b0b0d */
    --spectrum-gray-75-rgb: 17, 17, 20; /* kit gray-950 #111114 --jx-bg */
    --spectrum-gray-100-rgb: 23, 23, 27; /* kit gray-925 #17171b --jx-bg-panel */
    --spectrum-gray-200-rgb: 29, 29, 34; /* kit gray-900 #1d1d22 --jx-bg-input */
    --spectrum-gray-300-rgb: 38, 38, 44; /* kit gray-850 #26262c --jx-bg-overlay */
    --spectrum-gray-400-rgb: 47, 47, 54; /* kit gray-800 #2f2f36 --jx-border */
    --spectrum-gray-500-rgb: 69, 69, 79; /* kit gray-700 #45454f --jx-border-strong */
    --spectrum-gray-600-rgb: 124, 124, 139; /* kit gray-500 #7c7c8b --jx-fg-muted */
    --spectrum-gray-700-rgb: 162, 162, 175; /* kit gray-400 #a2a2af --jx-fg-dim */
    --spectrum-gray-800-rgb: 225, 225, 231; /* kit gray-200 #e1e1e7 */
    --spectrum-gray-900-rgb: 238, 238, 242; /* kit gray-100 #eeeef2 --jx-fg */

    /* Blue ramp — drives accent, informative, and the focus indicator */
    --spectrum-blue-100-rgb: 15, 23, 46; /* kit blue-950 #0f172e */
    --spectrum-blue-200-rgb: 23, 37, 84; /* kit blue-900 #172554 */
    --spectrum-blue-300-rgb: 30, 64, 175; /* kit blue-800 #1e40af */
    --spectrum-blue-400-rgb: 29, 78, 216; /* kit blue-700 #1d4ed8 */
    --spectrum-blue-500-rgb: 37, 99, 235; /* kit blue-600 #2563eb --jx-accent-solid */
    --spectrum-blue-600-rgb: 48, 112, 241; /* #3070f1 between two kit steps */
    --spectrum-blue-700-rgb: 59, 130, 246; /* kit blue-500 #3b82f6 --jx-accent */
    --spectrum-blue-800-rgb: 95, 149, 247; /* kit blue-400 #5f95f7 --jx-accent-hover */
    --spectrum-blue-900-rgb: 143, 181, 251; /* kit blue-300 #8fb5fb --jx-tag */
    --spectrum-blue-1000-rgb: 188, 211, 253; /* kit blue-200 #bcd3fd */
    --spectrum-blue-1100-rgb: 219, 231, 254; /* kit blue-100 #dbe7fe */
    --spectrum-blue-1200-rgb: 238, 244, 255; /* kit blue-50 #eef4ff */
    --spectrum-blue-1300-rgb: 248, 250, 252; /* #f8fafc */
    --spectrum-blue-1400-rgb: 255, 255, 255; /* #ffffff */

    /* Font stacks, the kit's (--jx-font-sans / --jx-font-mono). Theme-independent — they stay
       outside the per-colour blocks below. */
    --spectrum-sans-font-family-stack:
      "Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
    --spectrum-code-font-family-stack:
      "JetBrains Mono", "SF Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, monospace;
  }

  /*
   * Light-theme stop order: gray 50 (lightest) -> 900 (darkest); blue 100 (lightest) -> 1400
   * (darkest). Spectrum's light theme maps its layers the other way up from its dark one — a panel
   * is LIGHTER than the app behind it here and darker there — which is why gray-50 is white and
   * gray-75 the kit's lightest step. The accent is one step down the ramp from the dark theme's
   * (#2563eb, not #3b82f6): the exact brand blue is 3.1:1 on the light background, short of the
   * 4.5:1 SC 1.4.3 asks of the label on an accent button; #2563eb carries white text at 5.2:1.
   */
  :host([color="light"]) {
    --spectrum-gray-50-rgb: 255, 255, 255; /* #ffffff --jx-bg-panel */
    --spectrum-gray-75-rgb: 247, 247, 249; /* kit gray-50 #f7f7f9 --jx-bg */
    --spectrum-gray-100-rgb: 238, 238, 242; /* kit gray-100 #eeeef2 */
    --spectrum-gray-200-rgb: 225, 225, 231; /* kit gray-200 #e1e1e7 --jx-border */
    --spectrum-gray-300-rgb: 201, 201, 210; /* kit gray-300 #c9c9d2 --jx-border-strong */
    --spectrum-gray-400-rgb: 162, 162, 175; /* kit gray-400 #a2a2af */
    --spectrum-gray-500-rgb: 124, 124, 139; /* kit gray-500 #7c7c8b --jx-fg-muted */
    --spectrum-gray-600-rgb: 94, 94, 108; /* kit gray-600 #5e5e6c --jx-fg-dim */
    --spectrum-gray-700-rgb: 69, 69, 79; /* kit gray-700 #45454f */
    --spectrum-gray-800-rgb: 29, 29, 34; /* kit gray-900 #1d1d22 --jx-fg */
    --spectrum-gray-900-rgb: 11, 11, 13; /* kit gray-975 #0b0b0d */

    --spectrum-blue-100-rgb: 238, 244, 255; /* kit blue-50 #eef4ff */
    --spectrum-blue-200-rgb: 219, 231, 254; /* kit blue-100 #dbe7fe */
    --spectrum-blue-300-rgb: 188, 211, 253; /* kit blue-200 #bcd3fd */
    --spectrum-blue-400-rgb: 143, 181, 251; /* kit blue-300 #8fb5fb */
    --spectrum-blue-500-rgb: 95, 149, 247; /* kit blue-400 #5f95f7 */
    --spectrum-blue-600-rgb: 59, 130, 246; /* kit blue-500 #3b82f6 */
    --spectrum-blue-700-rgb: 37, 99, 235; /* kit blue-600 #2563eb --jx-accent */
    --spectrum-blue-800-rgb: 29, 78, 216; /* kit blue-700 #1d4ed8 --jx-accent-hover */
    --spectrum-blue-900-rgb: 30, 64, 175; /* kit blue-800 #1e40af --jx-tag */
    --spectrum-blue-1000-rgb: 23, 37, 84; /* kit blue-900 #172554 */
    --spectrum-blue-1100-rgb: 15, 23, 46; /* kit blue-950 #0f172e */
    --spectrum-blue-1200-rgb: 16, 26, 60; /* #101a3c */
    --spectrum-blue-1300-rgb: 10, 17, 38; /* #0a1126 */
    --spectrum-blue-1400-rgb: 5, 8, 19; /* #050813 */
  }
`;
