// packages/studio/icons.js
// SVG icon strings for style sidebar button groups.
// Lucide-derived (MIT) icons for arrows and text-align; custom icons for flex alignment.
// Each value is a complete <svg> string at 16×16 rendered size with 24×24 viewBox.

const S = (d) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

// Helper for filled-rect icons (alignment/justify diagrams)
const R = (d) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">${d}</svg>`;

const icons = {
  // ─── Arrows (Lucide) — flexDirection ───
  'arrow-right':  S('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
  'arrow-left':   S('<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>'),
  'arrow-down':   S('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'),
  'arrow-up':     S('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>'),

  // ─── Text align (Lucide) — textAlign ───
  'align-left':    S('<line x1="21" x2="3" y1="6" y2="6"/><line x1="15" x2="3" y1="12" y2="12"/><line x1="17" x2="3" y1="18" y2="18"/>'),
  'align-center':  S('<line x1="21" x2="3" y1="6" y2="6"/><line x1="17" x2="7" y1="12" y2="12"/><line x1="19" x2="5" y1="18" y2="18"/>'),
  'align-right':   S('<line x1="21" x2="3" y1="6" y2="6"/><line x1="21" x2="9" y1="12" y2="12"/><line x1="21" x2="7" y1="18" y2="18"/>'),
  'align-justify': S('<line x1="21" x2="3" y1="6" y2="6"/><line x1="21" x2="3" y1="12" y2="12"/><line x1="21" x2="3" y1="18" y2="18"/>'),

  // ─── Wrap (Lucide wrap-text + custom) — flexWrap ───
  'wrap-text': S('<line x1="3" x2="21" y1="6" y2="6"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="16 16 14 18 16 20"/><line x1="3" x2="10" y1="18" y2="18"/>'),

  // ─── alignItems — 3 bars (width=3) inside a container outline ───
  // Container: rect outline 2,2 → 22,22. Bars at x=5,10,15 width=3.
  // start: bars top-aligned
  'align-start-v': R(
    '<rect x="2" y="2" width="20" height="20" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<rect x="5" y="4" width="3" height="8" rx="0.5"/>' +
    '<rect x="10.5" y="4" width="3" height="12" rx="0.5"/>' +
    '<rect x="16" y="4" width="3" height="6" rx="0.5"/>'
  ),
  // end: bars bottom-aligned
  'align-end-v': R(
    '<rect x="2" y="2" width="20" height="20" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<rect x="5" y="12" width="3" height="8" rx="0.5"/>' +
    '<rect x="10.5" y="8" width="3" height="12" rx="0.5"/>' +
    '<rect x="16" y="14" width="3" height="6" rx="0.5"/>'
  ),
  // center: bars center-aligned
  'align-center-v': R(
    '<rect x="2" y="2" width="20" height="20" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<rect x="5" y="8" width="3" height="8" rx="0.5"/>' +
    '<rect x="10.5" y="6" width="3" height="12" rx="0.5"/>' +
    '<rect x="16" y="9" width="3" height="6" rx="0.5"/>'
  ),
  // stretch: bars full height
  'align-stretch-v': R(
    '<rect x="2" y="2" width="20" height="20" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<rect x="5" y="4" width="3" height="16" rx="0.5"/>' +
    '<rect x="10.5" y="4" width="3" height="16" rx="0.5"/>' +
    '<rect x="16" y="4" width="3" height="16" rx="0.5"/>'
  ),
  // baseline: bars bottom-aligned to a baseline
  'align-baseline': R(
    '<rect x="2" y="2" width="20" height="20" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<rect x="5" y="6" width="3" height="8" rx="0.5"/>' +
    '<rect x="10.5" y="4" width="3" height="10" rx="0.5"/>' +
    '<rect x="16" y="8" width="3" height="6" rx="0.5"/>' +
    '<line x1="4" y1="14" x2="20" y2="14" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1"/>'
  ),

  // ─── justifyContent — 3 bars (horizontal layout) inside container ───
  // Bars are height=14 at y=5, varying x positions, width=3
  // start: packed left
  'justify-start': R(
    '<rect x="2" y="2" width="20" height="20" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<rect x="4" y="5" width="3" height="14" rx="0.5"/>' +
    '<rect x="8" y="5" width="3" height="14" rx="0.5"/>' +
    '<rect x="12" y="5" width="3" height="14" rx="0.5"/>'
  ),
  // end: packed right
  'justify-end': R(
    '<rect x="2" y="2" width="20" height="20" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<rect x="9" y="5" width="3" height="14" rx="0.5"/>' +
    '<rect x="13" y="5" width="3" height="14" rx="0.5"/>' +
    '<rect x="17" y="5" width="3" height="14" rx="0.5"/>'
  ),
  // center: centered
  'justify-center': R(
    '<rect x="2" y="2" width="20" height="20" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<rect x="6.5" y="5" width="3" height="14" rx="0.5"/>' +
    '<rect x="10.5" y="5" width="3" height="14" rx="0.5"/>' +
    '<rect x="14.5" y="5" width="3" height="14" rx="0.5"/>'
  ),
  // space-between: edges + center
  'justify-between': R(
    '<rect x="2" y="2" width="20" height="20" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<rect x="4" y="5" width="3" height="14" rx="0.5"/>' +
    '<rect x="10.5" y="5" width="3" height="14" rx="0.5"/>' +
    '<rect x="17" y="5" width="3" height="14" rx="0.5"/>'
  ),
  // space-around: equal surrounding space
  'justify-around': R(
    '<rect x="2" y="2" width="20" height="20" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<rect x="4.5" y="5" width="3" height="14" rx="0.5"/>' +
    '<rect x="10.5" y="5" width="3" height="14" rx="0.5"/>' +
    '<rect x="16.5" y="5" width="3" height="14" rx="0.5"/>'
  ),
  // space-evenly: equal gaps
  'justify-evenly': R(
    '<rect x="2" y="2" width="20" height="20" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<rect x="5" y="5" width="3" height="14" rx="0.5"/>' +
    '<rect x="10.5" y="5" width="3" height="14" rx="0.5"/>' +
    '<rect x="16" y="5" width="3" height="14" rx="0.5"/>'
  ),
};

export default icons;
