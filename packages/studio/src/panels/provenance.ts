/**
 * Provenance — where the value in a field came from, as one chip (plan §6.2).
 *
 * Four states, and the two that carry information NAME THEIR SOURCE:
 *
 * | State     | Rendering                         | Click             |
 * | --------- | --------------------------------- | ----------------- |
 * | set       | accent dot                        | clear the value   |
 * | inherited | amber, "from Base" / "from Md"    | jump to the donor |
 * | default   | nothing — absence IS the ghost    | —                 |
 * | bound     | violet, naming the signal/formula | open the source   |
 * | mixed     | neutral, "mixed (3)" — see below  | clear across all  |
 *
 * **Mixed** is what a multi-selection says when the selected elements disagree about a field
 * (§6.5). It is a fifth state of THIS chip rather than a fifth widget, because it answers the same
 * question the other four answer — _where did the value in this box come from?_ — and the honest
 * answer is "from several places, and they differ". It names how many elements are involved, so
 * "mixed" never has to mean "some unknown number of things". Typing into a Mixed field commits the
 * new value to every selected element in one transaction; the chip's click clears it from all of
 * them, which is the same verb `set` has, applied to the same set.
 *
 * `set` and `default` are the only two the inspector could previously express, and it expressed
 * them as a dot or the absence of one. The other two were known at render time and thrown away: an
 * inherited style value arrived as an input placeholder, visually indistinguishable from the CSS
 * initial value `style-inputs.ts` renders into the same slot, and a `${…}`-bound value looked like
 * a literal that happened to contain braces.
 *
 * **One module, two cascades.** The Style tab reads provenance against the breakpoint / scheme /
 * site-token cascade; Component Props reads it against the component's declared defaults. Same
 * question, same words, same chip — so the two surfaces cannot drift into two vocabularies for one
 * idea.
 *
 * **This module is the vocabulary, not the drawing.** It used to hold the chip's lit template as
 * well, and the `.provenance-chip*` / `.set-dot` rules in `styles/inspector.css` were what styled
 * it. Both cascades are documents now and each draws its own `[part="provenance-chip"]` from the
 * words below, so what is left here is the ANSWER — which state a value is in, what the chip reads,
 * what its tooltip says, and how a section tallies a group of them — and nothing about how it
 * looks. That is the split the header above always described; it is now the whole file.
 */

/** The states of §6.2 (four) plus §6.5's `mixed`, in the order the table lists them. */
export type ProvenanceState = "set" | "inherited" | "default" | "bound" | "mixed";

/** Where one field's value came from, and what clicking the chip does about it. */
export interface FieldProvenance {
  state: ProvenanceState;
  /**
   * Who supplied the value, in the words a reader would use — `"Base"`, `"Md"`, `"site tokens"`,
   * `"the component default"`, or a signal name. Rendered verbatim after the word "from" for
   * `inherited`, and on its own for `bound`, so a caller passes the noun and never the preposition.
   * For `mixed` it is the COUNT of disagreeing elements, as a string.
   */
  donor?: string | undefined;
  /**
   * Clear (`set`), jump to the donor (`inherited`), open the source (`bound`). A chip with no
   * handler renders as a `<span>`, never a `<button>`: a control that looks pressable and does
   * nothing is the defect this phase exists to remove.
   */
  onClick?: (() => void) | undefined;
  /** Overrides the derived tooltip. */
  title?: string | undefined;
}

/** The lead word of the derived tooltip, per state. */
const PROVENANCE_TITLES: Readonly<Record<ProvenanceState, string>> = {
  bound: "Bound",
  default: "Not set",
  inherited: "Inherited",
  mixed: "Mixed",
  set: "Set here",
};

/**
 * The chip's own text. The dots say nothing; the two informative states name a donor.
 *
 * Exported because the drawing of the chip is no longer only this module's: the Style tab is a Jx
 * document (`surfaces/style-panel.json`) and projects the words rather than calling a lit helper. A
 * second copy of them there is exactly the two-vocabularies-for-one-idea this module exists to
 * stop.
 */
export function provenanceText(p: FieldProvenance): string {
  if (p.state === "inherited") {
    return p.donor ? `from ${p.donor}` : "inherited";
  }
  if (p.state === "bound") {
    return p.donor ?? "bound";
  }
  if (p.state === "mixed") {
    return p.donor ? `mixed (${p.donor})` : "mixed";
  }
  return "";
}

/** The tooltip a chip carries when the caller does not supply one. */
export function provenanceTitle(prop: string, p: FieldProvenance): string {
  if (p.title) {
    return p.title;
  }
  const lead = PROVENANCE_TITLES[p.state];
  if (p.state === "inherited") {
    return `${lead} from ${p.donor ?? "the cascade"} — click to go there`;
  }
  if (p.state === "bound") {
    return p.donor ? `${lead} to ${p.donor} — click to open it` : lead;
  }
  if (p.state === "set") {
    return `${lead} — click to clear ${prop}`;
  }
  if (p.state === "mixed") {
    const count = p.donor ? `${p.donor} selected elements` : "the selected elements";
    return `${lead} — ${count} have different values for ${prop}; typing sets them all`;
  }
  return `${lead} — ${prop} falls back to the browser default`;
}

/*
 * `renderProvenanceChip` was here, and it is GONE rather than converted.
 *
 * It drew the chip as a lit template, and its only caller was `ui/field-row.ts`, whose only caller
 * was `ui/expression-editor.ts` — a document now, like the Style tab and Component Props before it.
 * So the last reader of the template went with that conversion and the function was three lit
 * branches nothing could reach.
 *
 * **What it stood for did not go with it.** The chip is drawn by the surfaces that own the fields:
 * `surfaces/style-panel.json` and `surfaces/properties-panel.json` each draw a
 * `[part="provenance-chip"]` from the words below, which is why {@link provenanceText} and
 * {@link provenanceTitle} are exported and why they are still the ONE place either sentence is
 * written. The two decisions the template carried are theirs now and are stated in their own
 * documents: `default` draws nothing, because a dot on every unset row is 138 dots on the Style tab
 * and says less than silence; and a chip that acts is a `button` rather than a 6px circle, because
 * a circle that clears a property was reachable by mouse alone.
 */

// ─── Section summaries ────────────────────────────────────────────────────────

/** How many fields in a group are in each informative state. */
export interface ProvenanceCounts {
  set: number;
  inherited: number;
  bound: number;
  mixed: number;
}

/**
 * Tally a group of states.
 *
 * @param {Iterable<ProvenanceState>} states
 * @returns {ProvenanceCounts}
 */
export function countProvenance(states: Iterable<ProvenanceState>): ProvenanceCounts {
  const counts: ProvenanceCounts = { bound: 0, inherited: 0, mixed: 0, set: 0 };
  for (const state of states) {
    if (state !== "default") {
      counts[state] += 1;
    }
  }
  return counts;
}

/** "3 set here · 2 inherited · 1 bound" — the summary a collapsed section states on hover. */
export function provenanceSummaryText(counts: ProvenanceCounts): string {
  const parts: string[] = [];
  if (counts.set > 0) {
    parts.push(`${counts.set} set here`);
  }
  if (counts.inherited > 0) {
    parts.push(`${counts.inherited} inherited`);
  }
  if (counts.bound > 0) {
    parts.push(`${counts.bound} bound`);
  }
  if (counts.mixed > 0) {
    parts.push(`${counts.mixed} mixed`);
  }
  return parts.length > 0 ? parts.join(" · ") : "nothing set";
}
